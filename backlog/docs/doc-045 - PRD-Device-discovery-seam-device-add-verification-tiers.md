---
id: doc-045
title: 'PRD: Device discovery seam + device add verification tiers'
type: specification
created_date: '2026-06-21 09:21'
tags:
  - device-add
  - device-discovery
  - core-refactor
  - ux
  - testing
  - m-18
---
## Problem Statement

As a podkit user adding a device, I am always forced through a host-wide device *scan*, even when I already know what I am adding. The scan is the wrong tool for several of the situations I am actually in:

- **I just plugged in an iPod and want podkit to find it.** This is the only case the scan was designed for, and it works.
- **I know exactly what my device is** (e.g. "an iPod 5th gen named TERAPOD" or "an Echo Mini at /mnt/echo"). I should be able to tell podkit and have it *validate my claim and fill the gaps*, not rediscover the device from scratch.
- **I am on a headless server, in Docker, or running automated tests.** The device may be mounted at a known path that the host's discovery pipeline (`diskutil` on macOS, `lsblk` on Linux) cannot usefully surface, or I want to provision config *before* the device is even attached. Today this is a second-class path held together by a test-only environment-variable escape hatch (`PODKIT_TEST_SYNTHETIC_VOLUME_UUID`).

Two distinct costs flow from "always scan":

1. **Add-time waste.** `podkit device add --path <mount>` still runs *two* full host enumerations to fetch a volume UUID and filesystem — even for a temp directory the OS cannot see. The e2e dummy-iPod tests pay this on every add.
2. **Resolution-time waste.** Every later `sync -d <name>`, `device info`, `doctor`, and `mount` re-enumerates *all* disks to resolve a device by its volume UUID. There is no direct single-target lookup anywhere in the codebase — even the helpers named like direct lookups (`findByVolumeUuid`, `getUuidForMountPoint`) internally enumerate-and-filter.

Separately, the genuinely slow operation — the SCSI/USB firmware inquiry used to read and write an iPod's `SysInfoExtended` — is run as part of discovery in places where the user has not asked for that level of checking, and is hard to opt out of cleanly. And the CLI is riddled with `if (isMassStorageDevice(type))` branches, leaking the iPod-vs-mass-storage distinction into code that should operate on a device abstraction.

## Solution

Two coordinated changes.

**1. A clean core discovery seam.** Replace the four enumerate-and-filter methods (`listDevices`, `findIpodDevices`, `findByVolumeUuid`, `getUuidForMountPoint`) on `DeviceManager` with two verbs:

- `scan({ kinds? })` — enumerate many. The one expensive block-side operation; the optional `kinds` hint expresses the cost asymmetry (mass-storage ≈ cheap vendor enumeration; iPod ≈ heavier classification, and on Linux a `/sys` USB-fingerprint attach).
- `locate({ volumeUuid | path })` — retrieve **one** device directly, using the cheapest OS query (`diskutil info` on macOS; `findmnt` / `blkid -U` on Linux), with **no** full enumeration.

Every command then makes a conscious *search-many vs retrieve-one* choice. Sync/info/mount/doctor resolution stops enumerating; the discovery orchestrators (`discoverConnectedDevices`, `suggestAddIntents`, `checkReadiness`) rebase onto `scan()`. Deprecated methods are deleted outright — no backwards-compatibility shims.

**2. Three verification tiers for `device add`,** controlling how hard podkit checks a device against reality before persisting it:

| Tier | Flag | Live SCSI cross-check | On-disk SysInfo | Reads device | For |
|---|---|---|---|---|---|
| **Verify** | (default) | yes — reuse the existing `sysinfo-consistency` / `sysinfo-modelnum-mismatch` diagnostics; error on mismatch | required (offer to write SysInfoExtended if absent) | yes | normal interactive add |
| **Trust-disk** | `--no-verify` | no | **required + ready** (else error: "run `podkit doctor`") | on-disk only | Docker / headless where SCSI is unavailable but the device is validly mounted |
| **Config-inject** | `--no-validate` | no | not required | no — pure config write from complete args | e2e tests, offline provisioning |

`--no-validate` implies `--no-verify`. The existing `--no-firmware-inquiry` flag is **renamed to `--no-verify`**, absorbing its old "skip the SysInfoExtended write" behaviour as a subset. Adding a device is the user's first opportunity to confirm the device is configured correctly, so the default is cautious (verify); the skip-tiers are explicit opt-outs where the user takes responsibility.

The trigger for "validate my claim" vs "discover the device" is simply **whether the user passed `--type`** — not a mode flag. `--path` / `--volume-uuid` become plain identity inputs feeding `locate`, not mode selectors.

## User Stories

1. As a user with an iPod freshly plugged in, I want `podkit device add -d myipod` to scan, identify it, and add it, so that the simplest case needs no extra knowledge from me.
2. As a user who knows my device's type, I want `podkit device add -d myipod --type ipod-video-5g` to locate the connected device and confirm it matches what I declared, so that a mismatch (I plugged in the wrong device) is caught at add time.
3. As a user adding a mass-storage device, I want `podkit device add -d echo --type echo-mini --path /mnt/echo` to validate the path and preset without any iPod-specific probing, so that non-iPod devices are first-class.
4. As a user adding an iPod that has no `SysInfoExtended` on disk, I want podkit to offer to write it via firmware inquiry during add, so that my device is sync-ready immediately.
5. As a user whose on-disk `SysInfo` disagrees with what the connected device reports, I want add to refuse with a clear message pointing me at `podkit doctor --repair sysinfo-modelnum-mismatch`, so that I do not persist a misconfigured device.
6. As a Docker / headless user whose container cannot perform SCSI inquiry, I want `podkit device add --no-verify` to add the device by trusting valid on-disk `SysInfo`, so that I am not blocked by an unavailable transport.
7. As a Docker / headless user whose mounted iPod has no on-disk `SysInfo`, I want `--no-verify` to refuse with a remediation hint ("run `podkit doctor`"), so that I understand the device is not yet sync-ready rather than silently adding a broken entry.
8. As an operator running e2e tests or baking a config image, I want `podkit device add --no-validate --volume-uuid <uuid>` (or path-only) to write the config from my arguments without touching any device, so that setup is instant and works with no device attached.
9. As an operator using `--no-validate`, I want podkit to validate that I supplied a *complete* identity (a uuid or a path, plus `--type` for capabilities) and error on a missing field, so that I do not persist an unusable config row.
10. As a user adding a device without a stable volume UUID, I want a warning that the device will not be re-found if its mount path changes (with a pointer to pass `--volume-uuid`), so that I understand the replug trade-off — but I am not blocked.
11. As a Linux user, I want add to still refuse an HFS+ iPod (which Linux cannot safely write) in the Verify and Trust-disk tiers, so that the existing safety holds; under `--no-validate` I accept responsibility and it is skipped.
12. As a user syncing to a configured device, I want `sync -d <name>` to resolve the device with a single direct OS lookup instead of enumerating every disk, so that sync starts faster.
13. As a user with a path-only device (no UUID), I want sync/info to resolve straight from the configured path with zero device I/O, so that headless setups never pay for discovery.
14. As a user running `device info` / `doctor` / `mount`, I want device resolution to use the direct `locate` path, so that every device-targeted command is faster and more predictable.
15. As a power user, I want `--no-firmware-inquiry`'s capability (skip the SysInfoExtended write) preserved under the clearer name `--no-verify`, so that the rename does not cost me functionality.
16. As a consumer of `podkit device add --format json`, I want a `verification` field (`verified` | `trusted-disk` | `config-only`) in the success envelope, so that I can tell which tier ran.
17. As a developer of the CLI, I want the command layer to operate on a device abstraction rather than branching on `isMassStorageDevice(type)` for labels and behaviour, so that adding a new device kind does not require touching scattered conditionals.
18. As a maintainer, I want the four enumerate-and-filter `DeviceManager` methods removed and replaced by `scan` / `locate`, so that the discovery contract is small, direct, and has one obvious way to do each thing.
19. As a maintainer of the e2e suite, I want the `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` env-var hatch and `synthesizeTestVolumeUuid` deleted and the suites migrated to `--no-validate`, so that test setup is explicit, fast, and not a hidden production side-door.
20. As a documentation reader, I want a "headless / automation" section in the device-adding guide covering when to use `--no-verify` vs `--no-validate`, the replug trade-off, and a worked Docker example, so that I can set up a server without reverse-engineering flags.
21. As a shell user, I want `--no-verify` and `--no-validate` to appear in bash/zsh/fish completions, so that the new flags are discoverable.
22. As a user whose device is a known-unsupported generation (iOS device, refused vendor), I want add to surface the canonical unsupported message in every tier where the device is actually read, so that the refusal behaviour is consistent.

## Implementation Decisions

### Core discovery seam (`@podkit/core`)
- `DeviceManager` gains `scan(options?: { kinds?: ReadonlyArray<'ipod' | 'mass-storage'> }): Promise<PlatformDeviceInfo[]>` and `locate(target: { volumeUuid: string } | { path: string }): Promise<PlatformDeviceInfo | null>`. `mount`, `eject`, `assessDevice`, `getSiblingVolumes`, `getManualInstructions`, `requiresPrivileges` are unchanged.
- **Deleted:** `listDevices`, `findIpodDevices`, `findByVolumeUuid`, `getUuidForMountPoint`. No compatibility shims.
- `scan()` with no `kinds` is the old `listDevices`; `scan({ kinds: ['ipod'] })` is the old `findIpodDevices`, including the Linux `/sys` USB-fingerprint attach (required by the reconciler's serial-matching — must be preserved and pinned by a test).
- `locate({ path })`: macOS `diskutil info <path>` (single subprocess); Linux `findmnt --target <path>` → backing source + UUID. `locate({ volumeUuid })`: macOS `diskutil info <uuid>`; Linux `blkid -U <uuid>` / `/dev/disk/by-uuid/<uuid>`. **Spike first:** empirically verify `diskutil info` accepts a bare volume UUID; if not, macOS uuid-locate falls back to a scan (interface stays clean, perf win forgone on that path only). `locate` returns `null` when the OS cannot resolve the target and degrades to `null` (never throws) when a binary is missing.
- Fallback for UUID-less volumes (tmpfs, Docker bind mounts, FunctionFS-synthesised): `locate({ path })` returns a `PlatformDeviceInfo` with `volumeUuid: ''` but valid `mountPoint`, preserving today's "Linux/Docker has no fs-UUID, proceed with path" resolution behaviour.
- `discoverConnectedDevices` rebases its internal `findIpodDevices()` call onto `scan({ kinds: ['ipod'] })`; `suggestAddIntents` and `checkReadiness` inherit the change with no edits. The USB-inquiry pipeline stays a free function over `scan()`, not folded into the manager.
- `matchPathToConfigDevice` currently does `getUuidForMountPoint` **then** `findByVolumeUuid` (two enumerations); collapses to a single `locate({ path })`.

### Decision layer extracted from `runDeviceAdd` (`podkit-cli`)
- **M3 — Add-request resolver** (pure, no I/O): `(rawOptions, ctx) → AddRequest`. Owns name/type/quality validation, `DeviceClaim` (`{ mode: 'declared'; deviceType } | { mode: 'undeclared' }`), `DeviceTarget` (`{ path } | { volumeUuid } | { scan }`), `VerificationTier` derivation (`'verify' | 'trust-disk' | 'config-inject'`, with `--no-validate ⇒ --no-verify` structural), and **config-inject completeness validation**. Registry access and the mass-storage classifier are *injected* (`knownDeviceTypeIds`, `isMassStorageType`) so M3 imports no registry/config modules. Throws `CliError` only for static argument errors.
- **M4 — Verification policy** (pure, total, never throws, no I/O): `(tier, claim, assessmentView, deviceStateView) → Outcome`. The single source of truth for the scenario matrix. `Outcome` is a discriminated union: `proceed`, `proceed-with-warning`, `prompt-write-sie`, `prompt-unsupported`, `error-mismatch`, `error-missing-sysinfo` (doctor hint), `refuse-no-uuid`, `refuse-hfsplus-on-linux`, `refuse-empty-identity`, `error-incomplete-injection`. The orchestrator maps each refusal kind to a `DeviceErrorCodes` value and constructs the `CliError`.
- **The S1/S2 notion is rejected.** It is replaced by the two orthogonal sum types above: `DeviceClaim` answers "validate-the-claim vs scan-and-suggest"; `DeviceTarget` answers "how to reach the device". M4 consumes only `claim`, never the target shape.
- **Kind-agnostic views keep iPod-vs-mass-storage out of the policy.** M4 takes `DeviceAssessmentView` (not `IpodIdentityAssessment`) whose `identityStore: 'present' | 'missing' | 'unwritable' | 'not-applicable'` reconciles the kinds — mass-storage always emits `'not-applicable'` with `identityStoreRequired: false`, so M4 contains **no** kind branches. The single kind dispatch is an adapter selection at the orchestrator edge (`assessIpodIdentity` vs `assessMassStorageDevice` → view). It also takes `DeviceStateView` (located?, volumeUuid, filesystem, platform, `crossCheck: 'pass' | 'mismatch' | 'skipped'`).
- **Verify-tier cross-check reuses the existing diagnostics.** `sysinfo-consistency` + `sysinfo-modelnum-mismatch` `CheckResult.status` collapses to `crossCheck`. The orchestrator assembles the `liveIdentity` the checks expect from the assessment before running them.
- **`prompt-write-sie` re-enters M4 once** after the SysInfoExtended write + re-assess; a second `prompt-write-sie` is treated as `proceed-with-warning` to prevent loops.

### `device add` flow + flags
- Renamed flag: `--no-firmware-inquiry → --no-verify`. New flag: `--no-validate`. Both registered as Commander `--no-X` options so the existing `stripDefaultOptionValues` plumbing applies.
- **Behaviour change (intended, documented):** Trust-disk (`--no-verify`) now *requires* on-disk SysInfo, stricter than the old `--no-firmware-inquiry` which proceeded with empty identity. Going forward **only `--force` bypasses the empty-identity gate.**
- `--path` / `--volume-uuid` / `--volume-name` are plain identity inputs, not mode selectors. Path existence/`statSync` checks move out of M3 into the orchestrator (device I/O).
- JSON success envelope (`DeviceAddSuccess`) gains `verification: 'verified' | 'trusted-disk' | 'config-only'`.
- Shell completions are auto-derived from the new Commander options; a completions test asserts the new flags appear.

### CLI kind-leakage reduction
- Behavioural kind dispatch is sourced from the `openDevice` result (`isIpodDevice` / `adapter`), not re-derived from `config.type`. The `info` readiness gate keys off the opened result.
- Label/display selection unifies onto a single `DeviceDisplay` (`{ short, rich }`) abstraction, with a core `displayForConfig(deviceConfig, presets)` mirroring the existing live `displayFor`, so `getDeviceTypeDisplayName` / `getDeviceTypeRichDisplayName` / `getDeviceLabel` collapse and the label call sites stop branching on kind. `isMassStorageDevice` survives only as an internal guard inside `openDevice`.

### Sequencing
1. Spike: verify `diskutil info <uuid>` behaviour.
2. Atomic commit: `scan`/`locate` on the interface + all 4 platform impls + all ~14 call-site migrations + orchestrator rebase + test/persona retargeting.
3. Collapse disguised single-target `.find()` loops (`add.ts` HFS+ match, post-mount re-fetch, `matchPathToConfigDevice`) into `locate`.
4. M3 + M4 extraction and the thinned `runDeviceAdd`; flag rename + `--no-validate`; JSON `verification` field.
5. CLI display de-leakage (`DeviceDisplay` unification).
6. e2e migration off the env-var hatch; docs; completions test.

## Testing Decisions

A good test pins **external behaviour**, not internal structure: given inputs and observable outputs (return values, persisted config, error codes, emitted warnings, subprocess count), assert the contract — so the test survives refactors of the internals.

- **M3 (add-request resolver) and M4 (verification policy)** are the highest-value targets: pure, synchronous, no I/O. M4 is tested as an **exhaustive table** over `tier × claim × assessmentView × deviceStateView → Outcome` — the entire scenario matrix becomes a data-driven unit test with no subprocess and no fixtures. M3 is tested over arg combinations → `AddRequest` / static-error, including config-inject completeness validation and the `--no-validate ⇒ --no-verify` implication. Prior art: the existing `device-add.unit.test.ts` table-style cases and the `fakeManager()` pattern.
- **`scan` / `locate` (M1)** are tested with a **mocked subprocess runner**, asserting `locate` issues exactly one direct OS query (not a full enumerate), `scan({ kinds: ['ipod'] })` preserves the Linux USB-fingerprint attach, and missing-binary degrades to `null`. Prior art: the injected `SubprocessRunner` already used in the macOS/Linux device-manager tests.
- **Resolver (`resolveDevicePath`)** is tested to assert a path-only device does **zero** device I/O and a uuid device calls `locate`, not `scan`.
- **`device add` unit tests** are updated: `--no-firmware-inquiry` cases renamed to `--no-verify`; the empty-identity bypass reworked (only `--force` bypasses); HFS+/VOLUME_UUID cases scoped to the tiers that read the device. New cases: type-match success / type-mismatch error; `--no-verify` SysInfo-present success and SysInfo-absent doctor-hint error; `--no-validate` complete→write, incomplete→error, path-only→path identity; per-tier `verification` JSON field.
- **e2e host (`device.test.ts`)** migrates every add that rode the env-var hatch to `--no-validate` — going from two host enumerations per add to zero device I/O. The unconditional `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` in the shared CLI runner is deleted.
- **e2e VM:** `volume-uuid-defensive` scenario 2 (env-var) rewritten to `--no-validate`; scenario 1 reframed as Verify-tier-only. New `--no-verify` persona cases (SysInfo present → succeed; absent → error + doctor hint). `hfsplus-refusal` and `unsupported-cascade` kept, scoped to the tiers that read the device.
- **e2e Docker (new):** a gated `device-add.docker.test.ts` pinning the `--no-verify` / `--no-validate` Docker contract, explicitly annotated with the unresolved SCSI-in-Docker question.

Test coverage is maintained and improved where it makes sense; the pure decision modules should reach near-exhaustive matrix coverage.

## Out of Scope

- Solving the Docker SCSI gap (see Further Notes) — it is captured as an open risk, not built here.
- The interactive device-add wizard (TASK-262) — the opposite direction (more hand-holding); both can coexist.
- Per-device default collection assignments and other unrelated `device add` UX.
- Windows device-manager direct-lookup parity beyond keeping it building (no `diskutil`/`findmnt` equivalent wired up unless trivial).
- Changing how sync/transcoding consume a resolved device beyond the resolution call itself.

## Further Notes

**Open risk — Docker SCSI gap (untested / unsolved).** A Docker user whose mounted iPod has *no* on-disk SysInfo is told by `--no-verify` to "run `podkit doctor`" — but doctor writes SysInfoExtended via the SCSI/USB inquiry, which may be unavailable in the container. Worse, checksum-based iPod generations (hash58/72/AB) *require* SysInfoExtended on disk for sync to produce a valid DB checksum, so without SCSI *somewhere* those devices cannot sync regardless of add tier. Candidate directions to capture, none committed: (1) document a "run doctor on an SCSI-capable host once, then use from Docker" workflow; (2) synthesize SysInfo from the declared `--type`/generation using the `devices-ipod` tables (no SCSI needed — ties to `--type`); (3) confirm whether SG_IO works in Docker under `--privileged` to scope the gap to rootless containers.

**Cost model that motivated the priority.** SCSI/USB inquiry is the genuinely slow operation and lives only at add/scan/doctor/info — never in sync resolution, which is pure `diskutil`/`lsblk`. The headline test win is removing the redundant enumerations from the `--path`/`--no-validate` add path; `locate` (direct retrieval) is the supporting seam that also de-enumerates sync/info resolution. The `kinds` hint on `scan` exists because mass-storage discovery is cheap (vendor enumeration) while iPod discovery is expensive (classification + inquiry).

**Origin.** Supersedes the narrower TASK-344 (`device add --no-scan`), whose `--no-scan` flag and `synthesizeTestVolumeUuid` env-var hatch are subsumed: "no scan" is now a product of declaring identity args + the `--no-verify` / `--no-validate` tiers, not a standalone flag.
