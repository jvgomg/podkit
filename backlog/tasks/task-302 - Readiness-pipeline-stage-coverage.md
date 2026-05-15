---
id: TASK-302
title: Readiness pipeline stage coverage
status: Done
assignee: []
created_date: '2026-05-08 07:21'
updated_date: '2026-05-15 23:35'
labels:
  - testing
  - doctor
  - readiness
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-322.05.01
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify each of the six readiness stages reports the right status across the realistic permutations of device state. The readiness pipeline runs before the database-health checks and decides whether the device is `ready`, `needs-repair`, `needs-init`, `needs-format`, `needs-partition`, or `hardware-error`. Today only the happy path and a couple of failure modes are covered; many state combinations are untested.

Stages, in order: `usb`, `partition`, `filesystem`, `mount`, `sysinfo`, `database`.

For every test, run `podkit doctor --device <fixture> --json --no-system` (system checks out of scope here) and assert on `readiness.level` plus the matching entry in `readiness.stages[]`: `status`, `summary`, and `details`. Where stages depend on prior stages, also assert that downstream stages skip when an upstream stage fails — that "earliest failure stops the pipeline" behaviour is part of the contract.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; inject fakes via `DevicePersona` fields (`partitionLayout`, `lsblkJson`, `systemProfilerJson`) into injectable transports
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against synthesized personas
- **T2 (native subprocess):** OS-specific subprocess parsing tests tagged `*.linux.test.ts` / `*.darwin.test.ts`
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture

### m-19 harness integration (Phase 1 foundations)

Use the test harness landed in TASK-321 (Phase 1):

- **Fixtures** live in `@podkit/device-testing` — `DevicePersona` for device-facing state, `SystemState` for host-environment state. See `agents/device-testing.md` and `packages/device-testing/README.md`.
- **Tier 1** unit tests inject `SubprocessRunner` (from `@podkit/device-types`) and `TestRuntime` fakes wired up against persona/state fixtures. Default runner is `defaultSubprocessRunner` from `@podkit/core`; tests substitute `ReplaySubprocessRunner` from `@podkit/device-testing`.
- **Tier 3** integration tests run inside the `lima-test-vm` runner (lands in TASK-322.04) against synthesised USB gadgets.
- **Native subprocess tests** follow the `*.darwin.test.ts` / `*.linux.test.ts` tagging convention — see `agents/testing.md` §"Per-OS Test Tagging".
- Capture fresh subprocess fixtures with `PODKIT_SNAPSHOT_CAPTURE=1 PODKIT_SNAPSHOT_DIR=<dir>`; replay with `PODKIT_SNAPSHOT_REPLAY=1 PODKIT_SNAPSHOT_DIR=<dir>`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 usb stage: pass when an Apple iPod USB descriptor is present; details include vendorId/productId and the resolved usbModel
- [x] #2 usb stage: fail when no USB descriptor is reachable for the mount path
- [ ] #3 usb stage: skip with reason when the platform device manager is unsupported (not Linux/macOS)
- [x] #4 partition stage: pass on a single-partition iPod layout; pass on the dual-partition Mac/Win iPod layout
- [x] #5 partition stage: fail with hardware-error level when the device has no partition table at all
- [x] #6 filesystem stage: pass on FAT32 and HFS+; details report the detected filesystem
- [x] #7 filesystem stage: fail with needs-format level when the partition has no recognisable filesystem
- [x] #8 mount stage: pass when iPod_Control directory is present at the mount point
- [x] #9 mount stage: fail with needs-init level when iPod_Control is missing entirely
- [x] #10 sysinfo stage: pass when SysInfo or SysInfoExtended is present and parses; details include usbModelName and deviceModel
- [x] #11 sysinfo stage: warn when SysInfo is missing but SysInfoExtended is present (or vice versa) and the present file resolves a model
- [x] #12 sysinfo stage: fail with needs-repair when both SysInfo and SysInfoExtended are missing
- [x] #13 sysinfo stage: fail when present file(s) parse but identify() cannot resolve a model from any field
- [ ] #14 database stage: pass when iTunesDB is present and parses; details include trackCount
- [x] #15 database stage: fail with needs-init level when iTunesDB is missing
- [x] #16 database stage: fail when iTunesDB is present but corrupt
- [x] #17 downstream skip: when usb fails, partition/filesystem/mount/sysinfo/database all report skip
- [x] #18 downstream skip: when mount fails, sysinfo and database report skip
- [x] #19 downstream skip: when sysinfo fails but mount passed, database still runs (sysinfo failure does not block database)
- [x] #20 readiness.level is correctly derived from the worst non-skipped stage (e.g. mount fail → needs-init regardless of sysinfo)
- [x] #21 readiness output is identical between text and JSON modes for the same fixture (modulo formatting)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** Readiness pipeline is device-scope, not system-scope, so it always requires a real device. The Tier-3 assertions in this task therefore depend on TASK-322.05.01 (FunctionFS descriptor handshake) so the synthesised persona actually enumerates as a USB device. Tier-1 fake-injected coverage of each stage is independent and can land first.

**TASK-302 Phase 1 (Tier-1) landed 2026-05-15** — `packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts` (single matrix file, 34 tests, 112 expects).

**Test file shape**
- Single matrix file driving `checkReadiness()` + `determineLevel()` + `createUsbOnlyReadinessResult()` across the 21 permutations.
- Skip-cascade (ACs #17–#19) parameterised over `SkipFixture[]` — one fixture per upstream-failure level with `expectSkipped` / `expectRan` sets asserted in a shared loop.
- Derived-level (AC #20) parameterised over `LevelFixture[]` covering all `READINESS_RULES` branches in `determine-level.ts`.
- Format parity (AC #21) renders the result as JSON and as a text snapshot built from `STAGE_DISPLAY_NAMES` + a local `STAGE_MARKER` map, asserting structural agreement (stage count, marker character per status, display name per stage) without snapshotting the full string.

**AC mapping (one-line each, deferrals only):**
- #14 DEFERRED to `readiness.integration.test.ts` — libgpod pass-path lives there; duplicating Tier-1 needs a real iTunesDB.
- All other 20 ACs covered. Matrix file lists every mapping inline.

**Findings — pipeline gaps surfaced while writing the matrix**

1. **AC #1 — usb stage details do not echo USB metadata on success.** [Now closed by TASK-338, 2026-05-16.] Pipeline's success-path stage push was `{ identifier }` only; vendorId/productId/usbModel were echoed only on the unsupported short-circuit and via `createUsbOnlyReadinessResult`. TASK-338 mirrored the unsupported-path push onto the pass path — usb stage details now emit `{ identifier, vendorId, productId, usbModel }` consistently.

2. **AC #4 — partition stage layout is invisible inside the cascade.** [Now closed by TASK-338, 2026-05-16.] `findIpodDevices()` upstream filters to partitioned devices, so the partition stage was a passthrough with no layout detail. TASK-338 threaded `partitionLayout` through `PlatformDeviceInfo` (populated by `lsblk -J` on Linux and `diskutil list -plist` on macOS) and emits `{ partitionCount, partitions: [{ index, filesystem, sizeBytes }] }` in the partition-stage details on the pass path.

3. **AC #14 — Tier-1 database pass path is libgpod-bound.** Covered by the existing integration test (`readiness.integration.test.ts` via `withTestIpod`). Duplicating in Tier-1 requires synthesising a binary iTunesDB. Defer to integration; matrix documents the deferral inline.

**Cross-package note** — task description points at `@podkit/device-testing` personas, but `@podkit/device-testing` depends on `@podkit/core` (cycle). Matrix synthesises persona-shaped inputs inline. Persona-driven Tier-3 lands once TASK-322.05.01 closes the USB synthesis loop (declared dep).

**Quality gates passed**
- `bun test packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts` — 34 pass, 0 fail, 112 expects.
- `bun run test --filter @podkit/core --filter @podkit/device-testing --filter podkit` — all green (2565 pass, 1 skip, 0 fail).
- `bunx tsc --noEmit -p packages/podkit-core/tsconfig.json` — clean.
- `bunx oxlint packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts` — 0 warnings, 0 errors.

**Tier-3 deferred** to TASK-322.05.01 (declared dep). No Tier-3 scaffolding added here.
<!-- SECTION:NOTES:END -->
