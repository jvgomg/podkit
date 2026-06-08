---
id: TASK-412
title: Mid-save ENOSPC matrix cells (ADR-018 post-sweep + estimate-drift)
status: Done
assignee: []
created_date: '2026-06-08 08:27'
updated_date: '2026-06-08 09:44'
labels:
  - testing
  - e2e
  - matrix
  - save-transaction
  - free-space
dependencies:
  - TASK-378
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - test-packages/device-testing/src/system-states/device-mount-near-full.ts
  - adr/adr-018-free-space-pre-flight-strategy.md
  - documents/architecture/sync/planning.md
  - documents/architecture/sync/save-transactions.md
priority: low
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-378 closed the structural free-space audit work — ADR-018 implementation landed (post-sweep statfs recompute + `InsufficientSpaceAfterCleanup` typed error) and the JSON envelope now carries structured `errors[]` payloads. The existing TASK-380 save-failure matrix cell pins the **plan-time pre-flight envelope** path (device-full-at-start mount → `"Not enough space..."` + `NotEnoughSpacePlanTime` errors[] entry, no save() runs).

Two reachable mid-save ENOSPC paths are **NOT** covered by the matrix today:

1. **Post-sweep recompute (ADR-018).** Mount sized so the plan-time gate passes (storage.free + debrisCleanup.totalBytes ≥ estimatedSize). Sweep partially fails (per-path `rm` returns EACCES/EIO). Post-sweep `statfsSync` shows actual free < estimatedSize. Executor throws `InsufficientSpaceAfterCleanup` before any track is attempted.
2. **Estimate-drift mid-save.** Source file actual size > `estimateCopySize` prediction (typical-bitrate model underestimates by ~25% for 320kbps mp3 vs 256 default). Mount sized to plan estimate but not actual. Transfer phase ENOSPCs per-track via `MoveError`/`TagWriteError`.

Both require new `SystemState` variants beyond the existing `device-mount-near-full` (which is sized so the plan-time gate always fires first).

## Scope

1. **NEW SystemState `device-mount-fits-estimate-failed-sweep`** in `test-packages/device-testing/src/system-states/`:
   - Provision a loopback mount sized to comfortably fit the matrix's standard source set (~few MB free).
   - Pre-seed debris files under the content paths totalling enough bytes that the plan-time envelope assumes the sweep will recover them.
   - Lock the debris dir read-only (chmod 0555) so `rm` returns EACCES per-path.
   - Net: plan-time gate passes (envelope includes debris bytes); sweep partial-fail leaves real free < estimate; post-sweep recompute fires.

2. **NEW SystemState `device-mount-fits-estimate-source-drifts`** (or in-test variant — depends on whether the drift can be expressed via the source-format fixtures):
   - Mount sized to plan estimate but not source actual.
   - Source file with `estimateCopySize` < actual (e.g. high-bitrate mp3 vs typical-default).

3. **NEW failure modes** in `matrix/save-failure-rules.ts`: `enospc-post-sweep`, `enospc-estimate-drift`. Each with its own `predict*` arm and `predictSaveFail` branch.

4. **Matrix cells**: at least one cell per new failure mode. Tradeoff: full fan-out across capability shapes is ~10 new cells per mode; pruning to one canonical shape (`embedded × flac × prefer-copy × fast`) gives 2 new cells. Latter is plenty for a reachability pin.

5. **Predictions**:
   - `enospc-post-sweep` → `throwsClass: 'InsufficientSpaceAfterCleanup'`, `errorCategory: 'space'`, `errors[]` carries the typed-error detail (bytesFreedBySweep, failedSweepPaths). `partialDeviceState: 'no-files-landed'` (post-sweep gate fires before any track).
   - `enospc-estimate-drift` → per-track typed errors (`MoveError` or similar) in `errors[]`; `partialDeviceState` = whatever the in-place atomic-write contract leaves (depends on the transfer mode).

6. **Tests**: matrix cells run through the existing `observeOnce` pipeline, no harness changes needed beyond the new SystemState wiring + apply-state.sh extensions.

## Why filed separately

The audit + ADR + implementation slice of TASK-378 (commits `bca54814` / `70a2d479` / `bccaa8b0`) closed 8/9 ACs. AC #7's "mid-save ENOSPC tested if reachable" intersects this work but the matrix cells need 4-6 hours of VM-harness work that didn't fit the audit-slice scope.

## Reference

- `adr/adr-018-free-space-pre-flight-strategy.md` — the decision this exercises.
- `documents/architecture/sync/planning.md` "Free-space contract — plan-time" + `save-transactions.md` "Free-space contract — execute-time" — the contracts to pin.
- `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` — the matrix to extend.
- `test-packages/device-testing/src/system-states/device-mount-near-full.ts` — pattern for the new SystemStates.
- TASK-378 — parent audit task; closure note explains the carve-out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 New SystemState `device-mount-fits-estimate-failed-sweep` lands with apply-state.sh wiring; provisions a mount where plan-time gate passes but post-sweep recompute fires
- [x] #2 #2 New SystemState `device-mount-fits-estimate-source-drifts` exercising estimate-drift mid-save ENOSPC (source mp3 synthesised at apply-state time, cached per VM session)
- [x] #3 #3 New failure modes `enospc-post-sweep` + `enospc-estimate-drift` in matrix/save-failure-rules.ts with their own predict() branches; local ErrorCategory union extended with 'space' and ThrowsClass with 'InsufficientSpaceAfterCleanup'
- [x] #4 #4 At least one canonical matrix cell per new failure mode (embedded × flac × prefer-copy × fast for post-sweep; embedded × mp3 × prefer-copy × fast for drift)
- [x] #5 #5 Post-sweep cell predicts throwsClass='InsufficientSpaceAfterCleanup', errorCategory='space', errors[] carries typed-error detail (bytesFreedBySweep=0, failedSweepPaths populated). Debris immutability via chattr +i; teardown chattr -i before remount
- [x] #6 #6 Estimate-drift cell predicts throwsClass=null, errorCategory='copy' (raw fs.copyFileSync ENOSPC propagates unwrapped via operation-type fallback). partialDeviceState reflects atomic-write contract (.podkit-tmp orphan). Wrap typed CopyError filed as follow-up if pin needs strengthening
- [x] #7 #7 Both cells run end-to-end in VM (bun run test:vm) and GREEN against ADR-018 implementation
- [x] #8 #8 SaveFailObserved extended to surface errors[].detail for the post-sweep cell's typed-error payload assertions
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What landed

Two new save-failure matrix cells exercising mid-save ENOSPC paths the existing matrix didn't cover. Both GREEN against ADR-018 implementation on a freshly-rebuilt VM.

### Cells

1. **`embedded × flac × prefer-copy × fast × enospc-post-sweep`** — ADR-018 post-sweep recompute path. Plan-time envelope (free + debrisCleanup.totalBytes) covers the source estimate; sweep's per-path `rm` returns EPERM on chattr-immutable debris; post-sweep statfs reads the original insufficient free and throws `InsufficientSpaceAfterCleanup`. Pins typed-error class + `errorCategory: 'space'` + `postSweepDetail.bytesFreedBySweep: 0` + `postSweepDetail.failedSweepPathsCount: 2`.

2. **`embedded × mp3 × prefer-copy × fast × enospc-estimate-drift`** — estimate-drift mid-save path. Plan-time + post-sweep gates both pass (mount fits typical-bitrate estimate); 30s × 320 kbps mp3 actual body exceeds mount free; transfer-phase atomicCopyFile ENOSPCs mid-write. Raw fs error propagates unwrapped (no typed `CopyError` wrap today); categorized as `'copy'` via operation-type fallback. Pins `errorCategory: 'copy'`, `partialDeviceState: 'no-files-landed'`.

### Files

**SystemStates (TypeScript fixtures):**
- NEW `test-packages/device-testing/src/system-states/device-mount-fits-estimate-failed-sweep.ts` — 1 MiB ext4 loopback at `/mnt/podkit-device-fs-postsweep`, ~200 KiB free, with chattr +i debris.
- NEW `test-packages/device-testing/src/system-states/device-mount-fits-estimate-source-drifts.ts` — 3 MiB ext4 loopback at `/mnt/podkit-device-fs-drift`, ~1100 KiB free.
- Registered in `system-states/index.ts` + `types.ts`. Smoke tests updated (9 states).

**apply-state.sh provisioning:**
- NEW shared helper `provision_loopback_ext4(img, mnt, size_mb, reserve_kib)` extracted from the existing near-full block.
- NEW `apply_device_mount_fits_estimate_failed_sweep` + `tear_down_postsweep`. Seeds two 60 KiB `.podkit-tmp` files under `Music/SeededArtist/SeededAlbum/`, chattr +i them. Teardown `chattr -i` before umount so inode flags don't survive in the image.
- NEW `apply_device_mount_fits_estimate_source_drifts` + `tear_down_drift`.
- `apply_healthy` calls both teardowns.
- `main()` dispatch + usage extended for both new state IDs.

**Matrix rules** (`test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts`):
- `FailureMode` extended with `'enospc-post-sweep'` + `'enospc-estimate-drift'`.
- `ThrowsClass` extended with `'InsufficientSpaceAfterCleanup'`.
- `ErrorCategory` extended with `'space'` (matches the engine union from TASK-378).
- `SaveFailObserved` + `SaveFailExpected` gained optional `postSweepDetail?: {bytesFreedBySweep, failedSweepPathsCount} | null` so the post-sweep cell can pin the typed-error payload shape.
- NEW `predictPostSweep` + `predictEstimateDrift` arms; dispatch in `predictSaveFail`.
- Two canonical cells added to `generateFanOut()` (one per new failure mode).

**Matrix harness** (`test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts`):
- NEW `isLoopbackProvisionedFailure` type predicate + `ChmodFailureMode` type for safe `FaultId` narrowing.
- `mountPointFor` extended for the two new paths.
- `observeCell` branches: applies the right SystemState; skips fault dispatch for loopback-provisioned modes; rebuilds clean image post-observation for all three loopback modes (`enospc`, `enospc-post-sweep`, `enospc-estimate-drift`).
- `classifyThrowsClass` recognizes the post-sweep error message format.
- `parseVerboseSyncOutput` regex extracts `bytesFreedBySweep` + `failedSweepPathsCount` from the `InsufficientSpaceAfterCleanup` constructor message in stderr.
- `writeSourceTrack` produces a 30s × 320 kbps mp3 for the drift cell + a 2s flac for the post-sweep cell (the small flac fits the post-sweep envelope math).
- `isCanonicalCell` keeps both new cells.

**Doc**: matrix README catalogue updated with both new failure modes and their SystemState mapping.

## VM verification

`bun run harness:destroy --yes && bun run harness:setup` rebuilt the VM with the new `apply-state.sh`. `bun run --cwd test-packages/e2e-vm-tests test:vm`:

- 134 pass / 42 skip / 5 fail
- Both TASK-412 cells GREEN (`enospc-post-sweep` + `enospc-estimate-drift`)
- 5 remaining failures are pre-existing regressions unrelated to TASK-412 (3 `manifest-dir-readonly` + 2 iPod portable `track-readonly`). Filed for investigation as a separate task.

## Iteration notes

- First VM run surfaced one real arithmetic bug in the drift cell: 2 MiB mount → ~924 KiB real free after ext4 reserved-blocks (5%) + journal overhead. Plan estimate 940.8 KiB → plan-time gate fired first. Fixed by bumping mount to 3 MiB and `DRIFT_RESERVE_KIB` to 1100.
- Sonnet pre-impl review (verdict: "fix post-sweep duration before running VM tests") caught a parallel arithmetic bug: 4s default FLAC = 442 KiB estimate vs 320 KiB envelope. Applied 2s duration for post-sweep cells.

## Sonnet reviews

- Pre-impl approach review (opus): `chattr +i` over chmod 0555, raw-fs-no-typed-wrap for drift, discrete SystemStates not parameterized, synthesize-not-prebake fixtures. All folded in.
- Mid-impl sonnet review: 1 real bug (post-sweep audio duration), 8 other checks clean. Bug fixed.

## Carried forward

- 5 pre-existing matrix regressions filed as a separate investigation task by the parallel sonnet (not TASK-412 scope).
- Optional follow-up: wrap raw fs.copyFileSync errors out of `MassStorageAdapter.copyTrackFile` in a typed `CopyError extends CategorizedSyncError` so the drift cell can pin a stronger contract than the current `throwsClass: null` fallback.
<!-- SECTION:FINAL_SUMMARY:END -->
