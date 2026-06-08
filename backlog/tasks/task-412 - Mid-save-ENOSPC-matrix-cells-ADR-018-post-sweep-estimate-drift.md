---
id: TASK-412
title: Mid-save ENOSPC matrix cells (ADR-018 post-sweep + estimate-drift)
status: To Do
assignee: []
created_date: '2026-06-08 08:27'
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
- [ ] #1 #1 New SystemState `device-mount-fits-estimate-failed-sweep` lands with apply-state.sh wiring; provisions a mount where plan-time gate passes but post-sweep recompute fires
- [ ] #2 #2 New SystemState (or in-test variant) for `device-mount-fits-estimate-source-drifts` exercising estimate-drift mid-save ENOSPC
- [ ] #3 #3 New failure modes `enospc-post-sweep` + `enospc-estimate-drift` in matrix/save-failure-rules.ts with their own predict() branches
- [ ] #4 #4 At least one canonical matrix cell per new failure mode (embedded × flac × prefer-copy × fast)
- [ ] #5 #5 Post-sweep cell predicts throwsClass='InsufficientSpaceAfterCleanup', errorCategory='space', errors[] carries typed-error detail
- [ ] #6 #6 Estimate-drift cell predicts per-track typed error in errors[], partialDeviceState reflects actual atomic-write contract
- [ ] #7 #7 Both cells run end-to-end in VM (bun run test:vm) and GREEN against ADR-018 implementation
<!-- AC:END -->
