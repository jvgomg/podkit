---
id: TASK-450
title: E2E loopback-fat CLI harness + device-add trust-disk verification (VM-free)
status: Done
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-08-05 17:59'
labels:
  - docker
  - testing
  - cli
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - documents/architecture/testing/taxonomy.md
  - adr/adr-025-canonical-test-taxonomy.md
  - packages/podkit-daemon/src/device-poller.ts
  - test-packages/e2e-tests/src/docker-source/device-add.test.ts
  - backlog/docs/doc-046 - Open-Risk-Docker-SCSI-Gap-for-SysInfoExtended.md
modified_files:
  - test-packages/e2e-tests/src/docker/podkit-image.ts
  - test-packages/e2e-tests/src/docker-loopback/harness.ts
  - >-
    test-packages/e2e-tests/src/docker-loopback/device-add-trust-disk.docker-loopback.test.ts
  - test-packages/e2e-tests/src/docker-loopback/fixtures/sysinfo-extended.xml
  - test-packages/e2e-tests/src/docker-loopback/fixtures/README.md
  - test-packages/e2e-tests/package.json
  - turbo.json
  - documents/architecture/testing/taxonomy.md
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - test-packages/e2e-tests/src/docker-source/device-add.test.ts
  - agents/docker.md
  - agents/testing.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the **E2E · `host-docker-image` · `local-dir` · `loopback-fat`** cell of the [test taxonomy](../../documents/architecture/testing/taxonomy.md) as a **CLI** device-test surface — not a daemon one.

## Why this changed (design finding, 2026-08-04)

The original framing (daemon-in-container detects a loopback FAT "iPod" via `lsblk` → mount → sync → eject, + SIGTERM drain + Apprise notify) is **not achievable VM-free**, because the daemon's iPod detection is deliberately USB-gated:

- `packages/podkit-daemon/src/device-poller.ts` `collectPartitions` **excludes `type: "loop"` devices**, and `isIpodDevice` requires **`vfat` AND Apple USB vendor id `05ac`** read from `/sys/block/<name>/device/idVendor`.
- Commit d3361548 ("detect whole-disk-formatted iPods") added the `type: "disk"` branch but **kept both guards** ("still excluding loop devices; the iPod match (vfat + Apple vendor id) is unchanged"). A `losetup` device presents as lsblk `type: "loop"` with no USB ancestor in `/sys`, so it can never satisfy either guard.

These guards are correct: the daemon polls every block device on a user's machine and must only ever sync provably-real iPods. A loopback FAT is exactly what it should ignore. Making the daemon accept it would require weakening detection in production — rejected.

**Decision:** daemon device testing (real detect → mount → sync → eject, SIGTERM graceful-drain, Apprise notify) is **USB-gated → VM-only** and moves to Tier-5 (`vm-docker-image` · `usb-synth`); tracked by its own task. The loopback tier is repurposed as the honest, VM-free home for **CLI** device operations that read on-disk identity (the CLI is transport-agnostic — it operates on a mounted iPod filesystem, no USB required, as proven by the Tier-5 path-based sync).

## First deliverable — fill the orphan trust-disk gap

`test-packages/e2e-tests/src/docker-source/device-add.test.ts` carries a documented TODO (from TASK-430, Done): the `--no-verify` (trust-disk) tier's meaningful assertion "requires a synthetic iPod volume mounted in the container … not currently wired into the Docker harness. When it is, add a case here." The `verified` (default) tier still needs USB/SCSI firmware inquiry → stays VM-only (see doc-046). The `--no-validate` (config-only) tier is device-free → already covered. The **`--no-verify` trust-disk** tier needs exactly a mounted loopback iPod volume — this task provides it.

## Proven this session
- Host `docker build` of the shipped `packages/podkit-docker/Dockerfile` from musl arm64 binaries (`packages/podkit-{cli,daemon}/bin/*-linux-arm64-musl`) → runnable image; `podkit --version` = 0.6.0 in-image.
- `--privileged` container: `apk add dosfstools util-linux` (mkfs.vfat not in the shipped image) → `truncate` + `losetup -f --show` + `mkfs.vfat -F 32 -n IPOD` + `lsblk` reports `fstype=vfat label=IPOD` + `mount` + seed + cleanup. All green.

## Location
`test-packages/e2e-tests/src/docker-loopback/` per the taxonomy directory rule; `test:e2e:docker-loopback` script gating the dir (already excluded from default `test:e2e`/serial/dummy/real via `--exclude-path 'docker-loopback/'`).

Constraint: `losetup`/`mkfs.vfat` in-container need `--privileged` (or `CAP_SYS_ADMIN` + `/dev/loop-control`); confirmed on Docker Desktop; keep working on native-Linux CI.

Daemon steady-state (mount→sync→eject, SIGTERM drain, Apprise notify) is NOT re-done here — unit-covered in `podkit-daemon` + e2e homed in Tier-5 (follow-up task).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reusable loopback-fat harness (host image build + privileged container that losetup + mkfs.vfat a whole-disk FAT, seeds an iPod_Control tree, mounts it at an in-container path)
- [x] #2 CLI `--no-verify` (trust-disk) + on-disk SysInfo present → exit 0, JSON verification = 'trusted-disk'
- [x] #3 CLI `--no-verify` + on-disk SysInfo absent → exit 1, doctor hint in stderr
- [x] #4 Hard-error-on-generic: `podkit device add`/`sync` against a generic FAT lacking authoritative identity → refuse + never mutate
- [x] #5 Runnable locally via a documented command (test:e2e:docker-loopback)
- [x] #6 Test lives in test-packages/e2e-tests/src/docker-loopback/ per the taxonomy directory rule
- [x] #7 Docs updated: taxonomy.md (daemon device testing = VM-only + why; loopback-fat = CLI surface), doc-053 Tier-4 reframe, device-add.test.ts TODO repointed to this task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Wiring-first, CLI-focused. Reuse @podkit/device-testing#build:musl-binary (host musl binaries) as a turbo dep.

1. Host image helper (test-packages/e2e-tests/src/docker/podkit-image.ts) — `docker build` shipped Dockerfile on the HOST docker daemon from staged musl bin/<arch> context. Native arch only (analog of buildPodkitImageInVm, host docker not nerdctl/VM).
2. Loopback fixture helper — privileged container: apk add dosfstools util-linux; truncate + losetup + mkfs.vfat whole-disk FAT; mount; seed iPod_Control tree from gpod-testing/templates/MA147 (5G Video) + optional SysInfoExtended for the identity-present case; a bare-FAT variant (no iPod_Control) for the generic case.
3. Tests (test-packages/e2e-tests/src/docker-loopback/): AC2 --no-verify + SysInfo present → trusted-disk exit 0; AC3 --no-verify + SysInfo absent → exit 1 doctor hint; AC4 generic FAT → device add/sync refuses, no mutation.
4. test:e2e:docker-loopback script + turbo entry (dir already excluded from defaults).
5. Docs: taxonomy.md grid cell + a "daemon device testing is VM-only (USB-gated), why" note; doc-053 Tier-4 reframe (daemon steady-state → Tier-5); repoint device-add.test.ts comment.

Out of scope (moved to Tier-5 follow-up): daemon detect→mount→sync→eject, SIGTERM drain, Apprise notify — USB-gated, VM-only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validated CLI contract live (2026-08-05, spike in-container against loopback FAT, arm64 shipped image):

- AC2 (trusted-disk): fresh loopback FAT with iPod_Control/Device/{SysInfo, SysInfoExtended} present + `podkit --json device add --type ipod --no-verify --path <mp> --yes` → exit 0, JSON `verification: "trusted-disk"`, `success:true`, config written. volumeUuid resolves in-container via blkid (no DEVICE_PATH_UNRESOLVED for this flow).
- AC3 (missing SIE): SAME fixture but SysInfoExtended absent (iPod_Control/Device/SysInfo present, never initialized) → exit 1, JSON `success:false`, `code:"EMPTY_IDENTITY"`, error text 'This iPod has no on-disk SysInfo and --no-verify skips the firmware inquiry… Run `podkit doctor`…'. No config written.
- AC4 (hard-error-on-generic): must use DETECT mode (NO --type) — `podkit --json device add --no-verify --path <generic-mp> --yes` on a bare FAT (no iPod_Control) → exit 1, `success:false`, `code:"EMPTY_IDENTITY"`, error 'Cannot add this device: no identifying signal is available…'. No config written. NOTE: `device add --type ipod` on a generic device is a DECLARED claim and proceeds by design (even initializes) — so AC4 uses detect mode, not a forced type.

Gotchas: (1) shipped alpine image lacks mkfs.vfat → `apk add dosfstools util-linux` in the privileged container (scaffolding). (2) Reuse a device across cases pollutes identity (device add initializes an iTunesDB whose model libgpod re-reads) → fresh loopback per case. (3) checksum-model nuance turned out moot — trust-disk keys on SysInfoExtended presence, so the missing-SIE error fires regardless of model.

Fixture identity source: nano-3g persona SysInfoExtended (checked in as a docker-loopback fixture with provenance note).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the E2E · host-docker-image · local-dir · loopback-fat cell as a **CLI** surface (reframed from the original daemon framing — see task notes/doc-053; daemon device e2e is USB-gated, moved to Tier-5 task-474).

**Harness (new):**
- `test-packages/e2e-tests/src/docker/podkit-image.ts` — `buildPodkitImageOnHost()`: host `docker build` of the shipped alpine/musl Dockerfile from `bin/<arch>/{podkit,podkit-daemon}` musl binaries (turbo dep `@podkit/device-testing#build:musl-binary`). Host sibling of `buildPodkitImageInVm`.
- `src/docker-loopback/harness.ts` — privileged container lifecycle + loopback FAT fixture builders (`losetup`+`mkfs.vfat`, seed iPod_Control/SysInfo(+SIE) or bare generic FAT) + in-container `podkit --json` runner. Handles the real gotchas: shipped image lacks mkfs.vfat (`apk add dosfstools util-linux`); loop-device nodes pre-created (Docker Desktop only pre-populates a few → `losetup -f` picks lost nodes after churn); loop devices leak from `--rm` containers into the VM kernel → teardown detaches ours (matched by backing file); fresh loopback per case (device add initialises an iTunesDB that pollutes identity).
- `src/docker-loopback/fixtures/sysinfo-extended.xml` — nano-3g persona SIE (provenance in fixtures/README.md).

**Tests (`device-add-trust-disk.docker-loopback.test.ts`, 3/3 pass, ~6s, idempotent, 0 loop leaks):**
- AC2: `--no-verify` + on-disk SysInfoExtended present → exit 0, JSON verification="trusted-disk", config written.
- AC3: same, SIE absent → exit 1, code EMPTY_IDENTITY, error contains "podkit doctor", config file never created.
- AC4: generic FAT + `device add` detect-mode (no --type) → exit 1, EMPTY_IDENTITY, "no identifying signal", no config + no iPod_Control written.

**Wiring:** `test:e2e:docker-loopback` script + turbo entry (deps ^build + build:musl-binary, cache:false); dir already excluded from default e2e surfaces.

**Docs:** taxonomy.md (grid cell + daemon=VM-only rationale), doc-053 (Tier-4 reframe, coverage map), agents/docker.md (run section), agents/testing.md (command table), device-add.test.ts TODO repointed here.

Verified: bun test 3/3 pass (x2, idempotent), tsc 0 errors, oxlint 0/0, no loop-device leak. Reviewed by a sonnet agent; substantive findings (orphan-container-on-exec-throw; stronger no-mutation proof) applied. No changeset — test infra only, no distributed package touched. Uncommitted (user commits).
<!-- SECTION:FINAL_SUMMARY:END -->
