---
id: TASK-413
title: >-
  Save-failure matrix regressions: manifest-dir-readonly EACCES + iPod portable
  doctor-id drift
status: Done
assignee: []
created_date: '2026-06-08 09:47'
updated_date: '2026-06-08 10:10'
labels:
  - test
  - regression
  - save-failure-matrix
dependencies: []
references:
  - packages/podkit-core/src/lib/pid-file.ts
  - packages/podkit-core/src/lib/sync-lock-path.ts
  - packages/podkit-cli/src/commands/sync.ts
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts
  - packages/podkit-core/src/diagnostics/checks/debris-files-ipod.ts
  - packages/podkit-core/src/diagnostics/checks/debris-files-mass-storage.ts
  - packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts
priority: high
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two distinct regressions caused 5 matrix cells to flip RED after TASK-380 closed.

## Regression 1 — manifest-dir-readonly (3 cells)

**Affected cells:**
- `embedded × flac × prefer-copy × fast × manifest-dir-readonly`
- `embedded-vorbis × flac × prefer-copy × fast × manifest-dir-readonly`
- `sidecar-mixed × flac × prefer-copy × fast × manifest-dir-readonly`

**Root cause:** Commit `484fb0ea` (TASK-404, per-device sync lock) introduced `resolveSyncLockPath()` which, for mass-storage devices, calls `acquireLock(.podkit/sync.lock)` early in the sync flow — before any track operation runs. `acquireLock` calls `tryCreateAndWrite` which calls `open(path, 'wx')`. That call only catches `EEXIST`; any other error is re-thrown. When `.podkit/` is chmod 0555 (`manifest-dir-readonly` fault), the `open` hits EACCES, which is not a `LockHeldError`/`LockContestedError`, so it is not caught in `sync.ts`'s lock-acquisition block. The uncaught EACCES propagates all the way out of `runSync`, bypassing every track operation and producing a raw Bun JS stack trace on stderr instead of a typed error envelope. The audio file never lands.

**Observable symptoms:**
- `syncExit: 1` with Bun source-context stack trace on stderr (raw EACCES from `open(.podkit/state.json...sync.lock...`)
- `errorCategory: null` (no typed error envelope)
- `partialDeviceState: 'no-files-landed'` (was `'file-copied-manifest-stale'`)
- `rescanRefiresAddOrUpgrade: true` (was `false`)
- `failedTrackCount: 0` (was `1`)

**Fix:** `acquireLock` (or `sync.ts`'s lock acquisition block) must handle EACCES on the lock-file open gracefully — e.g. wrap it as a `CliError` with a clear message ("cannot write lock file: .podkit/ is not writable") so sync fails cleanly rather than crashing. The fault should still propagate (the manifest IS read-only), but via the typed error path, not an uncaught JS throw.

**Implicated file:** `packages/podkit-core/src/lib/pid-file.ts` — `tryCreateAndWrite` only catches `EEXIST`, throws everything else. The lock acquisition block in `packages/podkit-cli/src/commands/sync.ts` (lines 1001–1043) only catches `LockHeldError`/`LockContestedError`.

## Regression 2 — iPod portable track-readonly doctorSeesPodkitTmp drift (2 cells)

**Affected cells:**
- `ipod-noart × mp3 × prefer-copy × portable × track-readonly`
- `ipod-artwork × mp3 × prefer-copy × portable × track-readonly`

**Root cause:** Two-part problem:

1. The `doctorSeesPodkitTmp` helper in `save-failure-matrix.e2e.test.ts` (line 792) looks only for `orphan-files-mass-storage` check ID. For iPod devices this check is never run (it is `applicableTo: ['mass-storage']`), so `doctor.checks.find(...)` returns `undefined` and the helper returns `null`. The prediction says `doctorSeesPodkitTmp: false`. `Object.is(false, null)` → diff fires.

2. These cells were previously fenced with `skipBug('TASK-395'/'TASK-396')` so they were pruned at TASK-380 close time. Commit `c1cdebd9` (TASK-380 chattr+i follow-up) replaced the `skipBug` with a live-cell path and updated the `portableTagWarn` prediction — but did NOT fix `doctorSeesPodkitTmp: false → null` for iPod cells, nor did it update the helper to look at `debris-files-ipod`.

**Additional complication:** TASK-397 (commit `afe382eb`) split `orphan-files-mass-storage` into `orphan-files-mass-storage` (orphans only) and `debris-files-mass-storage` (debris only). `.podkit-tmp` files now live in `debris-files-mass-storage`, not `orphan-files-mass-storage`. So even for mass-storage cells, `doctorSeesPodkitTmp` would now return `false` even when `.podkit-tmp` debris exists (it looks in the wrong check). This is a latent bug for mass-storage cells too — currently masked because those cells don't leave `.podkit-tmp` behind.

**Fix options for iPod cells:**
- Option A: Change the `doctorSeesPodkitTmp` prediction for iPod portable track-readonly to `null` (iPod devices have no mass-storage manifest, no `.podkit-tmp` is expected, and the check is absent). This is the minimal fix.
- Option B: Extend `doctorSeesPodkitTmp` to also look at `debris-files-ipod` check when the iPod check is present. More correct but more surgery.

**Fix for mass-storage cells (latent):** Update `doctorSeesPodkitTmp` to look at `debris-files-mass-storage` (not `orphan-files-mass-storage`) for `.podkit-tmp` files, since TASK-397 moved debris to its own check.

**Implicated file:** `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` — `doctorSeesPodkitTmp` helper (line 792). Also `test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts` — iPod portable track-readonly prediction (line 569).

## Summary of commits implicated

| Regression | Introducing commit | Description |
|---|---|---|
| manifest-dir-readonly | `484fb0ea` | TASK-404 per-device sync lock (acquireLock EACCES not caught) |
| iPod portable doctor drift | `c1cdebd9` | TASK-380 chattr+i follow-up (removed skipBug without fixing null vs false) |
| Mass-storage doctor drift (latent) | `afe382eb` | TASK-397 orphan/debris split (moved .podkit-tmp to debris-files-mass-storage) |
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 5 previously-RED cells are GREEN: embedded × flac × prefer-copy × fast × manifest-dir-readonly, embedded-vorbis × flac × prefer-copy × fast × manifest-dir-readonly, sidecar-mixed × flac × prefer-copy × fast × manifest-dir-readonly, ipod-noart × mp3 × prefer-copy × portable × track-readonly, ipod-artwork × mp3 × prefer-copy × portable × track-readonly
- [x] #2 manifest-dir-readonly cells: sync exits with a typed CliError (not a raw JS stack trace) when .podkit/ is read-only; the error is surfaced before any track operation runs; exit code 1 with a human-readable message about the lock file
- [x] #3 iPod portable track-readonly cells: doctorSeesPodkitTmp expected value updated to null (or helper extended to look at debris-files-ipod); Object.is comparison passes
- [x] #4 doctorSeesPodkitTmp helper updated to read from debris-files-mass-storage (not orphan-files-mass-storage) for .podkit-tmp checks on mass-storage cells — fixes the latent TASK-397 drift
- [x] #5 No other matrix cells are broken by the fix — bun run test:vm on save-failure-matrix.e2e.test.ts shows 0 additional regressions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (sonnet review skipped — no Task tool; design decision documented inline)

### Regression 1 — manifest-dir-readonly (prod fix)

Add a new typed error `LockUnavailableError` in `packages/podkit-core/src/lib/pid-file.ts`:

- Distinct from `LockHeldError` (no holder exists; the file was never created) and from `LockContestedError` (file exists but unreadable contents).
- Catches `EACCES`, `EROFS`, `EPERM` at the `open(path, 'wx')` call in `tryCreateAndWrite`.
- Carries the originating errno (`code`) and preserves the underlying `ErrnoException` as `cause` for diagnostics.

Surface as a typed `CliError` in:
- `packages/podkit-cli/src/commands/sync.ts` — new `SyncErrorCodes.LOCK_UNAVAILABLE`, default exit code 1 (not the contention exit code 4, since no contention exists).
- `packages/podkit-cli/src/commands/doctor.ts` — same pattern via `withDeviceWriteLock`.

Rationale for a NEW typed error (vs. extending `LockHeldError`):
1. `LockHeldError` carries `pid`/`startTimeMs` of a holder. There is no holder on EACCES — passing zeros would be misleading.
2. Distinct error class lets the CLI emit a "directory not writable" message instead of a "another process is using" message — these are user-fix-distinct.
3. Mirrors the existing two-error split (held vs contested) — symmetric design.

### Regression 2 — test-side drift

- Helper `doctorSeesPodkitTmp` updated to read from `debris-files-mass-storage` first (TASK-397 split moved debris out of `orphan-files-mass-storage`) AND fall back to `debris-files-ipod` (added by TASK-376 for atomic tag-write residue on iPod).
- iPod portable track-readonly prediction left at `doctorSeesPodkitTmp: false`: with the helper fix, the iPod debris check fires, the atomic tag-write tmp is cleaned up (parent dir is writable; only the target inode is immutable), so the check returns no debris → `false`.

### Tests
- New unit tests in `pid-file.test.ts` for the EACCES path (uses `chmod 0555` on the lock dir; skipped when running as root).
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What landed

**Prod fix** (`fix(sync): wrap EACCES on lock-file open as typed LockUnavailableError` — d4708d12):
- New typed error `LockUnavailableError` in `packages/podkit-core/src/lib/pid-file.ts` carrying the originating errno (`'EACCES' | 'EROFS' | 'EPERM'`) plus the underlying `ErrnoException` as `cause`.
- `tryCreateAndWrite` catches the three errno codes at the `open(path, 'wx')` call and throws `LockUnavailableError` instead of letting the raw fs error propagate.
- `sync.ts` and the doctor's `withDeviceWriteLock` translate the typed error into a `CliError` (new code `LOCK_UNAVAILABLE`, exit code 1) with a clear "directory not writable" message — distinct from the contention exit code 4 reserved for in-flight concurrent syncs.
- Exported from `@podkit/core` and stubbed in the demo's `mock-core.ts`.
- Two new unit tests in `pid-file.test.ts` exercise the EACCES path using `chmod 0555` on the lock directory (skipped when running as root).

**Test fix** (`test(matrix): align doctor-debris helper with TASK-397 split + iPod check` — e3c0ba01):
- `doctorSeesPodkitTmp` helper updated to read `debris-files-mass-storage` first (TASK-397 moved `.podkit-tmp` out of `orphan-files-mass-storage`) and fall back to `debris-files-ipod` (TASK-376 atomic tag-write residue).
- `manifest-dir-readonly` predictions updated to reflect the new typed-CliError-before-save() behaviour: errorCategory=null, partialDeviceState='no-files-landed', failedTrackCount=0, rescanRefiresAddOrUpgrade=true.
- `itunesdb-readonly` iPod predictions: `doctorSeesPodkitTmp` flipped from `null` to `false` (libgpod's `.<DB>.<rand>` tmp pattern is not `.podkit-tmp` so debris-files-ipod returns pass with empty debris).
- `enospc-post-sweep` prediction: `doctorSeesPodkitTmp` flipped from `false` to `true` — the chattr-immutable tmps from TASK-412 genuinely survive on disk; the legacy-helper bug was masking this all along.

## Files changed

Prod fix (commit d4708d12):
- `packages/podkit-core/src/lib/pid-file.ts`
- `packages/podkit-core/src/lib/pid-file.test.ts`
- `packages/podkit-core/src/index.ts`
- `packages/podkit-cli/src/commands/sync.ts`
- `packages/podkit-cli/src/commands/doctor.ts`
- `packages/demo/src/mock-core.ts`

Test fix (commit e3c0ba01):
- `test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts`
- `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts`

## Verification

- `bun test packages/podkit-core/src/lib/pid-file.test.ts` → 24 pass / 0 fail (including 2 new LockUnavailableError tests).
- `bun run test:unit --filter @podkit/core --filter podkit` → 4470 pass / 6 skip / 0 fail.
- `bun test test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` → **27 pass / 42 skip / 0 fail** (was 19/42/8 before; all 5 previously-RED cells from this task are GREEN, no new regressions).

## Design notes

Chose a new typed error (`LockUnavailableError`) over overloading `LockHeldError` because:
1. `LockHeldError` carries `pid`/`startTimeMs` of a holder — none exists on EACCES.
2. The CLI emits a "directory not writable" message vs. "another process is using" — user-fix-distinct.
3. Mirrors the existing held-vs-contested two-error split — symmetric design.

## Follow-ups

None filed beyond what already existed (TASK-414, TASK-415 were filed by user during the session; unrelated to this task's scope).
<!-- SECTION:FINAL_SUMMARY:END -->
