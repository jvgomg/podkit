---
id: TASK-344
title: Design `device add --no-scan` for unmanaged / test / headless flows
status: To Do
assignee: []
created_date: '2026-05-17 09:33'
updated_date: '2026-06-21 09:22'
labels:
  - device-add
  - ux
  - testing
  - design
milestone: m-18
dependencies: []
documentation:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
priority: medium
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design + ship a first-class `--no-scan` flag (or similar) for `podkit device add` that lets users opt out of the host platform-discovery routine when they already know what they're adding.

This is a **design task** — finish thinking through the trade-offs, then implement. The current state is a stopgap.

## Why this matters

Several `podkit device add` consumers don't have a real backing volume that the host's platform discovery pipeline (macOS `diskutil` / Linux `lsblk`) can see:

1. **E2E tests** — the `@podkit/gpod-testing` `createTestIpod()` produces a tmpdir with an iPod_Control directory structure. Looks like an iPod to file-walking code; invisible to `findIpodDevices()`. Tests need to add it.
2. **Headless servers / CI / Docker** — operators who plug an iPod into a server may have it mounted at a well-known path but not surfaced by udisksctl / diskutil.
3. **Scripted setup** — automation knows the path + UUID up front; running the full host probe is wasteful.

The platform scan was designed for the interactive "I just plugged in an iPod, podkit find it" flow. The non-interactive flows are second-class today.

## Current workaround (must be replaced)

Commit `3a332be` shipped a test-only env-var escape hatch:

- `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` enables a synthetic `test-<base64-slug>` volumeUuid when no real one is available
- Implemented as `synthesizeTestVolumeUuid(path)` in `packages/podkit-cli/src/commands/device/add.ts`
- The e2e CLI runner (`packages/e2e-tests/src/helpers/cli-runner.ts`) sets the env var unconditionally

This was the right tactical fix to unblock e2e, but it's a side door:

- Real users can't use it (undocumented; named for test usage)
- It only addresses the volumeUuid refusal (TASK-317.15) — doesn't help with the broader "skip the scan" desire
- It silently substitutes a synthetic UUID without warning, exactly the smell TASK-317.15 was designed to eliminate

## Proposed design

Add an explicit `--no-scan` flag to `podkit device add`. When set:

- Skip `manager.isSupported` check
- Skip `manager.findIpodDevices()` / `listDevices()` probes
- Skip the TASK-317.15 volumeUuid refusal that depends on those probes (replaced by warning, see below)
- **Don't** skip: `existsSync(path)` sanity check; on-disk identity assessment (`assessIpodIdentity` reads SysInfo/SysInfoExtended directly — no platform scan); database init / track-count read

### User-provided info under `--no-scan`

| Flag | Required? | Purpose |
|---|---|---|
| `--device <name>` | already required | identity key in config |
| `--path <mount>` | **promoted to required** | scan can't fill it in |
| `--type <type>` | optional | mass-storage preset; iPod auto-detected from on-disk SysInfo |
| `--volume-uuid <uuid>` | optional | recommended; absent = path-only identity, won't survive replug |
| `--volume-name <name>` | optional | defaults to `basename(path)` |
| `--filesystem <fs>` | optional | only matters for HFS+/Linux refusal |

### Replug-following trade-off

Without `--volume-uuid`, device is pinned to mount path. If `/Volumes/iPod` becomes `/Volumes/iPod 1` on next mount, `doctor -d <name>` / `sync -d <name>` lookups by name break.

Two options:

1. **Warn + proceed**: emit `Added without volume UUID — device will not be re-found if mount path changes. Pass --volume-uuid <uuid> to enable replug-following.` User responsibility.
2. **Refuse unless `--volume-uuid` given**: stricter. Higher friction for tests + headless servers.

**Lean towards (1)**. The `--no-scan` flag is itself the explicit acknowledgement; re-refusing inside an explicit opt-out is annoying.

### HFS+ refusal question

TASK-317.12 reads `filesystem` from `manager.listDevices()`. With `--no-scan`, that source is gone. Three sub-options:

1. **Direct fs-type probe** — small `statfs` / `blkid` call on the one path. Refusal still fires automatically. Cleanest user-side.
2. **Trust user `--filesystem` flag**. If they say "vfat" but it's actually HFS+, they break themselves.
3. **Skip HFS+ refusal with `--no-scan`** — they opted in.

**Lean towards (1)**. Single targeted probe, not the full discovery pipeline. Keeps the safety automatic.

### Scan-found branch interaction

Should `--no-scan` also work with the scan-found branch (no `--path` flag, just `device add --no-scan -d foo`)?

- **No** — `--no-scan` implies "I'm telling you the path, don't look." Without `--path`, what would it even do?
- **Yes** — could degrade gracefully: prompt for path. Defeats automation.

**Lean towards "require `--path` when `--no-scan` is set"**. Simpler contract.

## Open questions to resolve during design

1. **Flag name**: `--no-scan` vs `--skip-scan` vs `--skip-discovery` vs `--unmanaged` vs `--manual`. Project convention is commander `--no-X` form, so `--no-scan` likely wins.
2. **Warning wording** when `--volume-uuid` is omitted — should be informative without scaring users away.
3. **JSON-mode envelope**: does the existing `device add --json` output need new fields to indicate scan was skipped? Or does `details.scannedHost: false` suffice?
4. **Doctor / sync handling of path-only devices**: when these consumers lookup a device that was added with `--no-scan` + no UUID, what's the failure mode? Probably "not found" with a hint to re-add.
5. **Echo Mini / Rockbox / generic mass-storage already support `--type <preset> --path <mount>` essentially as a manual flow.** Is `--no-scan` redundant for those, or unifying? Need to audit the mass-storage path.
6. **Shell completions** — flag needs to appear in completion output for bash/zsh/fish.
7. **Docs**: where does this land in the user guide? Probably a new "headless / automation" section under `user-guide/`.

## Migration plan (once shipped)

1. Land `--no-scan` with tests + docs.
2. Switch e2e CLI runner from `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` env var to `--no-scan` flag in every `device add` call.
3. Remove `synthesizeTestVolumeUuid` + `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` plumbing from `packages/podkit-cli/src/commands/device/add.ts`.
4. Remove env-var setup from `packages/e2e-tests/src/helpers/cli-runner.ts`.
5. Verify e2e still passes.

## References

- TASK-317.15 (`6db8fb0`) — defensive volumeUuid refusal that prompted this design.
- TASK-317.12 (`4ee5e2b`) — HFS+ refusal; interacts with the filesystem-probe question.
- `3a332be` — current env-var hatch (to be removed).
- TASK-262 — Interactive Device Add Wizard. The wizard is the OPPOSITE direction (more hand-holding); this task is the headless escape hatch from it. Both can coexist.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Design decisions resolved for: flag name, warning wording, JSON envelope shape, HFS+ refusal mechanism under --no-scan, doctor/sync handling of path-only devices, scan-found-branch interaction, mass-storage redundancy.
- [ ] #2 `podkit device add --no-scan --device <name> --path <mount>` succeeds on a real path with no platform scan, emitting a clear warning when --volume-uuid is omitted.
- [ ] #3 HFS+ on Linux still refused under --no-scan (via whichever mechanism the design lands on).
- [ ] #4 Optional --volume-uuid, --volume-name, --filesystem, --type flags accepted and persisted to config when --no-scan is set.
- [ ] #5 Unit + integration tests cover: --no-scan happy path, --no-scan + --volume-uuid, --no-scan without --path (error), HFS+/Linux refusal under --no-scan, replug-following behaviour with and without --volume-uuid.
- [ ] #6 E2E tests migrated from PODKIT_TEST_SYNTHETIC_VOLUME_UUID env-var to --no-scan flag; env-var hatch + `synthesizeTestVolumeUuid` removed from the CLI source.
- [ ] #7 User docs added (likely under `docs/user-guide/`) covering when to use --no-scan, the replug-following trade-off, and a worked example for the headless-server case.
- [ ] #8 Shell completions list --no-scan and any new sibling flags.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded by doc-045 PRD (Device discovery seam + device add verification tiers). The narrow `--no-scan` flag is subsumed: 'no scan' is now a product of declaring identity args + the `--no-verify` / `--no-validate` verification tiers, not a standalone flag. `synthesizeTestVolumeUuid` + the `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` env-var hatch are removed and e2e migrates to `--no-validate`. See doc-045 for the full design; implementation to be planned from there.
<!-- SECTION:NOTES:END -->
