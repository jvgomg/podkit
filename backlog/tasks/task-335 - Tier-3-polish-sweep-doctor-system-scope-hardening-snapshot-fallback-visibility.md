---
id: TASK-335
title: >-
  Tier-3 polish sweep: doctor system-scope hardening + snapshot fallback
  visibility
status: Done
assignee: []
created_date: '2026-05-14 22:38'
updated_date: '2026-05-14 22:56'
labels:
  - doctor
  - vm-coverage
  - tier-3
  - polish
milestone: m-19
dependencies:
  - TASK-333
  - TASK-322.02.01
modified_files:
  - packages/podkit-core/src/diagnostics/index.ts
  - packages/podkit-core/src/diagnostics/index.test.ts
  - packages/device-testing/src/runners/lima-test-vm-snapshots.ts
  - packages/device-testing/src/runners/lima-test-vm-snapshots.test.ts
priority: low
ordinal: 21900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three small hardenings surfaced in post-implementation reflection on TASK-333 + TASK-322.02.01. Bundled because each is a one-liner; not blocking any current flow, hence Low priority.

## 1. `runSystemOnlyDoctor` hard-codes `deviceType: 'ipod'`

`packages/podkit-cli/src/commands/doctor.ts:894` calls `runDiagnostics` with `deviceType: 'ipod'` even when `--scope system` is in effect. All current system-scope checks declare `applicableTo: ['ipod', 'mass-storage']` so the filter passes, but a future system-scope check registered with `applicableTo: ['mass-storage']` would silently be skipped.

**Fix options:**
- (a) Iterate both device types and union the results — simple but emits duplicate checks if a check is applicable to both
- (b) Teach `runDiagnostics` to bypass the device-type filter when `scopes === ['system']` — cleaner; the device-type filter is a per-check applicability mechanism, not a system-vs-device discriminator

Recommend (b). Anchor: `packages/podkit-core/src/diagnostics/index.ts:151`.

## 2. `runDiagnostics` opens an empty IpodDatabase even with `scopes: ['system']`

`packages/podkit-core/src/diagnostics/index.ts:125` calls `IpodDatabase.open(mountPoint)` regardless of scope. Wrapped in try/catch so it's harmless, but wasteful when scope is system-only. One-line guard:

```ts
if (deviceType === 'ipod' && !db && allowedScopes.includes('device')) {
  db = await IpodDatabase.open(mountPoint);
}
```

## 3. Snapshot fallback is silent on `vz`

`packages/device-testing/src/runners/lima-test-vm-snapshots.ts:220` (`isSnapshotUnsupported`) returns silently on every Lima `vz` invocation. The fallback is correct (TASK-322.02.01 decided to keep apply-state.sh on vz), but a developer who doesn't know the architecture spends time wondering why state changes feel slower than the snapshot fast path would be.

**Fix:** first-time-per-process stderr line: `[lima-test-vm] snapshot driver unimplemented (vz); using apply-state.sh fallback — see TASK-322.02.01`. Use a module-level boolean guard like `tier3-runtime-setup.ts`'s `skipWarningEmitted` pattern.

## Out of scope

- Restructuring how diagnostic checks declare applicability — that's TASK-330's territory.
- Changing the snapshot-strategy decision — TASK-322.02.01 settled on `vz` + apply-state.sh-every-time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 runDiagnostics skips the device-type filter (or accepts deviceType: undefined / unioned types) when scopes === ['system']; future system-scope-only checks registered for mass-storage are not silently dropped
- [x] #2 runDiagnostics does NOT attempt IpodDatabase.open() when scopes does not include 'device' and deviceType === 'ipod'; verified by absence of the open() call in the system-only path's subprocess scripted runner
- [x] #3 lima-test-vm-snapshots.ts emits a single stderr warning the first time isSnapshotUnsupported() returns true in a process; subsequent calls are silent
- [x] #4 Warning text names the driver (vz) and links to TASK-322.02.01 for the decision context
- [x] #5 Unit tests cover all three changes: doctor scope filter, doctor db-open guard, snapshot warning idempotency
- [x] #6 No behavioural regressions in existing TASK-333 / TASK-322.02.01 tests
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

Three independent changes, each minimally invasive:

### Change 1 — system-scope filter bypass (`index.ts:148-152`)
Added `isSystemOnly` flag before the CHECKS filter. When `allowedScopes` is `['system']`, the device-type predicate (`types.includes(deviceType)`) is bypassed. A future check declared with `applicableTo: ['mass-storage']` + `scope: 'system'` will now fire correctly for any deviceType in system-only mode.

### Change 2 — db-open guard (`index.ts:123`)
Hoisted the `allowedScopes` computation before the db-open block. Added guard: `if (deviceType === 'ipod' && !db && allowedScopesEarly.includes('device'))`. System-only runs no longer attempt `IpodDatabase.open()`.

### Change 3 — snapshot fallback first-time warning (`lima-test-vm-snapshots.ts`)
Added module-level `snapshotUnsupportedWarningEmitted` boolean (mirrors `skipWarningEmitted` pattern). Added `resetSnapshotUnsupportedWarning()` export. Added `warn` DI seam to `SnapshotOpts` and `ListSnapshotsOpts`, threaded through `createSnapshot`, `restoreSnapshot`, and `listSnapshotsSafe`. `isSnapshotUnsupported()` now accepts `warn` parameter and emits the once-per-process warning on first hit.

### Tests
- `packages/podkit-core/src/diagnostics/index.test.ts` (new, 8 tests) — filter predicate isolation + db-open guard via non-existent mountPoint
- `packages/device-testing/src/runners/lima-test-vm-snapshots.test.ts` (extended, +5 tests in new describe block) — first-emit, idempotency, reset, snapshotExists path, non-unimplemented no-warning

### Results
- @podkit/core: 2468 pass, 0 fail
- @podkit/device-testing: 241 pass, 0 fail
- `bunx tsc --noEmit`: clean on both packages
- `bunx oxlint` on 4 affected files: 0 warnings, 0 errors
<!-- SECTION:FINAL_SUMMARY:END -->
