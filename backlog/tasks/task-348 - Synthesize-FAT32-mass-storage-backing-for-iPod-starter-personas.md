---
id: TASK-348
title: Synthesize FAT32 mass-storage backing for iPod starter personas
status: Done
assignee: []
created_date: '2026-05-17 14:42'
updated_date: '2026-05-20 22:02'
labels:
  - vm-testing
  - tier-3
  - fixtures
  - scsi-synthesis
milestone: m-19
dependencies:
  - TASK-346
priority: high
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Migrate the 3 starter Tier-3 personas (`ipod-video-5g-iflash-1tb`, `ipod-nano-7g-space-gray`, `echo-mini`) onto mass-storage backing so the dummy-hcd daemon exposes them as real SCSI block devices in the test VM. With TASK-346 (sg kernel module loaded) plus this task, `podkit doctor` and `podkit device scan` in the test VM will behave the same way they do against real hardware — closing the long-standing Tier-3 fidelity gap.

## Per-persona content policy (per user direction 2026-05-17)

Each persona chooses its own initial backing-file content. Starter personas start with **empty FAT32 filesystems** (model a fresh iPod). Later personas may seed iTunesDB or other content — that's not in this task's scope.

## Scope

1. **Backing-file synthesis script** — new file e.g. `packages/device-testing/scripts/build-backing-file.ts`. Generates FAT32 images deterministically (idempotent: re-running produces byte-identical output via fixed sector layout + mkfs flags). Inputs: persona id, size MB, label. Output: raw image at a per-persona path.
2. **Persona updates**:
   - `ipod-video-5g-iflash-1tb` → 256MB FAT32 (label `IPOD_VIDEO`), empty
   - `ipod-nano-7g-space-gray` → 128MB FAT32 (label `IPOD_NANO`), empty
   - `echo-mini` → 64MB FAT32 (label `ECHO_MINI`), empty (closes TASK-324 AC #8)
   - Each persona's `index.ts` populates `massStorageBackingFile: { hostPath, vmPath, sizeBytes, filesystem: 'fat32' }`
   - Each persona's `provenance.md` documents the synthesis recipe
3. **Sidecar pipeline** — confirm `sidecar-build.ts` ships the new backing files to the VM (the runner already supports it; this verifies the loop is closed)
4. **Flag drift fix** — replace `--format json` with `--json` in `personas-baseline.tier3.test.ts` (lines 36 docstring + 120 invocation)
5. **Re-baseline Tier-3** — after changes land, `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3` must be GREEN (0 fails)
6. **Cleanup** — verify TASK-322.06.01 echo-mini filter is no longer triggered; leave the filter in place as a future tripwire but document that all starter personas now have daemon payload

## Out of scope

- Loading `sg` kernel module — TASK-346
- Daemon implementation changes — daemon already supports composition
- Seeding iTunesDB or media files inside the FAT32 image — separate persona variants
- HFS+ synthesis — Linux refuses HFS+ (TASK-317.12), only FAT32 is supported here
- Other personas (sony, ipod-nano variants 2g/3g/4g, etc.) — starter set first; broader migration follows

## References

- TASK-346 (sibling, deps) — VM SCSI infrastructure
- `tools/device-testing/dummy-hcd/src/gadget.ts` lines 121–133 — daemon mass-storage binding (already implemented)
- `packages/device-testing/src/personas/types.ts` — `massStorageBackingFile` schema
- `packages/device-testing/src/personas/echo-mini/` — example of current `null` state
- `backlog/tasks/task-324 - Phase-5-persona-registry-expansion.md` AC #8 — echo-mini sidecar requirement
- `agents/device-testing.md` — Tier-3 architecture overview
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Backing-file synthesis script produces deterministic, byte-identical FAT32 images on repeated runs
- [x] #2 ipod-video-5g-iflash-1tb persona has non-null massStorageBackingFile pointing to a 256MB FAT32 image
- [x] #3 ipod-nano-7g-space-gray persona has non-null massStorageBackingFile pointing to a 128MB FAT32 image
- [x] #4 echo-mini persona has non-null massStorageBackingFile pointing to a 64MB FAT32 image (closes TASK-324 AC #8)
- [x] #5 Each updated persona's provenance.md documents the synthesis recipe + filesystem choice
- [x] #6 personas-baseline.tier3.test.ts: --format json → --json (lines 36, 120)
- [x] #7 Tier-3 baseline GREEN: `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3` reports 0 fails
- [x] #8 Doctor inquiry-methods reports 'pass' / '/dev/sg* present' inside withPersona() for all 3 starter personas
- [x] #9 Doctor exit code is 0 (healthy) for all 3 starter personas under the healthy SystemState
- [x] #10 TASK-322.06.01 echo-mini filter no longer triggers (echo-mini has daemon payload now) — filter stays as a tripwire for future bare personas
- [x] #11 `bun run typecheck` + `bun run build` + `bun run test` pass across affected packages
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-20 — TASK-348 landed. Tier-3 baseline GREEN (39 pass / 0 fail / 106 expect() calls).**

Implementation history:
1. TASK-348 worker landed the core (synthesis script, backing-file pipeline, persona migration, sg-perms udev rule, flag drift fix, waitForScsiGenericEnumeration helper). Worker reported 39 pass / 0 fail at that point.
2. Team-lead reviewer pass identified 2 should-fix + 1 nit. Should-fix items applied: rename `skipped` → `wasAlreadyIdentical` (probe always rebuilds; the boolean is telemetry, not a skip signal) and journalctl-on-timeout error context in waitForScsiGenericEnumeration.
3. Re-run after reviewer fixes revealed two cascading VM-state issues NOT caught by the worker's original run (which had been against a polluted VM with leftover state from prior testing):
   - `podkit doctor` `udev-rule` check requires `91-podkit-ipod.rules` present. Worker's apply-state.sh only installed `40-podkit-sg-perms.rules`. Fix: added `ensure_podkit_udev_rule` to `apply_healthy()` that invokes `podkit doctor --repair udev-rule` if the rule is absent.
   - `91-podkit-ipod.rules` sets MODE=0660 GROUP=plugdev on Apple-vendor scsi_generic nodes, overriding the test's `40-podkit-sg-perms.rules` MODE=0664 (40 < 91 alphabetically). Adding the test user to plugdev does NOT work because SSH session group membership is fixed at login (ControlMaster caches). Fix: install `99-podkit-test-vm-sg-override.rules` which runs AFTER 91 and forces MODE=0664 on every `sg[0-9]*` node regardless of vendor. Test-VM-only; production posture untouched.

Also during this session: a full VM destroy + recreate was needed after a wedged-kernel state from an aborted Tier-3 run left zombie daemon processes in D state. Lima provisioning hung at "Attempting to download the image" twice before recovering; documented as future fragility but not a TASK-348 blocker.

Files changed (final state):
- `packages/device-testing/scripts/build-backing-file.ts` (new)
- `packages/device-testing/src/runners/lima-test-vm-backing-files.ts` (new) — renamed `skipped` → `wasAlreadyIdentical`
- `packages/device-testing/src/runners/lima-test-vm-backing-files.test.ts` (new) — assertion rename
- `packages/device-testing/src/runners/lima-test-vm.ts` — prepare() Step 6 backing files
- `packages/device-testing/src/tier3/persona-fixture.ts` — `waitForScsiGenericEnumeration` + journalctl-on-timeout
- `packages/device-testing/src/tier3/personas-baseline.tier3.test.ts` — `--format json` → `--json` + Apple-vendor scan branch
- `packages/device-testing/src/tier3/tier3-runtime-setup.test.ts` — echo-mini canary flipped
- `packages/device-testing/src/personas/echo-mini/{persona.ts,provenance.md}` — 64 MiB FAT32 `ECHO_MINI`
- `packages/device-testing/src/personas/ipod-nano-7g-space-gray/{persona.ts,provenance.md}` — 128 MiB FAT32 `IPOD_NANO`
- `packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/{persona.ts,provenance.md}` — 256 MiB FAT32 `IPOD_VIDEO`
- `packages/device-testing/src/personas/types.ts` — added `synthesis.label`
- `packages/device-testing/src/index.ts` — exports
- `packages/device-testing/package.json` — `build:backing-file` script
- `tools/device-testing/scripts/apply-state.sh` — sg-perms MODE 0664, `ensure_podkit_udev_rule`, `ensure_test_vm_sg_override`

m-19 follow-ups discovered (not in 348 scope):
1. `findIpodDevices()` in `packages/podkit-core/src/device/platforms/linux.ts:476` hard-codes `vendorId === '05ac'` — Echo Mini (0x071b) not surfaced by `device scan` even with a working mass-storage gadget. Scan test uses negative assertion as tripwire.
2. The `91-podkit-ipod.rules` GROUP=plugdev semantics don't grant access from headless/SSH sessions (uaccess is console-seat only). Test override is a stopgap; production might want a different access strategy for headless users.
3. `prepare()` always-rebuild backing files costs ~200ms (3 limactl round-trips). Future recipe-hash sidecar at `<vmPath>.recipe` would let us skip — log under TASK-339 (wall-time measurement) for when timing matters.
<!-- SECTION:NOTES:END -->
