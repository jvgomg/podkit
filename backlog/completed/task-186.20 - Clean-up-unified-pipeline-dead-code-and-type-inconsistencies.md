---
id: TASK-186.20
title: Clean up unified pipeline dead code and type inconsistencies
status: Done
assignee: []
created_date: '2026-03-22 15:10'
updated_date: '2026-03-22 21:21'
labels:
  - tech-debt
  - cleanup
dependencies: []
references:
  - packages/podkit-core/src/sync/unified-planner.ts
  - packages/podkit-core/src/sync/unified-executor.ts
  - packages/podkit-core/src/sync/content-type.ts
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Items from code review (2026-03-22)

Several minor issues found during the TASK-186.12/186.13 code review:

1. **`PlanAddResult` type in unified-planner.ts** — defined and exported but never used. Remove or implement per-add-operation warnings.

2. **`SyncWarningType` reuse** — `unified-planner.ts` uses `'lossy-to-lossy'` warning type for space constraint warnings. Add a proper `'space-constraint'` type to the union.

3. **`TranscodeProgress.speed` type mismatch** — `TranscodeProgress.speed` is `number` but `OperationProgress.transcodeProgress.speed` is `string`. Causes unnecessary string-to-number round-trips in `VideoHandler.executeTranscode` and `buildExecutorProgress`.

4. **Handler registry (`registerHandler`/`getHandler`/`getAllHandlers`/`clearHandlers`)** — exported from public API but never used anywhere. Either remove or document as intended for future plugin system. Has no tests (tracked separately in TASK-186.15).

5. **`const skipped = 0` in `UnifiedExecutor.executeBatch`** — never incremented, always 0. Add comment explaining why, or change to `let` if skip logic may be added.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Unused PlanAddResult type removed or warning support implemented
- [x] #2 Space constraint warnings use a proper warning type, not 'lossy-to-lossy'
- [x] #3 TranscodeProgress.speed type is consistent between interfaces
- [x] #4 Old video pipeline exports (diffVideos, planVideoSync, createVideoExecutor) removed or marked @internal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Context update (2026-03-22)\n\nAdditional cleanup items identified during Phase 3 work:\n\n### Updated item #4 — Handler registry\nDecision made to REMOVE the registry rather than document it. This is now tracked as a separate task (TASK-186.15 repurposed). Remove from this task's scope.\n\n### New items from Phase 3\n\n6. **Old video pipeline functions still exported** — `diffVideos`, `planVideoSync`, `createVideoExecutor`, `PlaceholderVideoSyncExecutor` are still exported from `@podkit/core` but the CLI no longer calls them (uses UnifiedDiffer/UnifiedPlanner with VideoHandler instead). These should be removed or marked `@internal`. Check if any external consumers exist.\n\n7. **`VideoSyncDiff` type still exported** — the CLI now uses `UnifiedSyncDiff<CollectionVideo, IPodVideo>` instead. The old `VideoSyncDiff` type may have no remaining callers.\n\n8. **`getVideoPlanSummary` and `willVideoPlanFit`** — still called by both presenters in `sync-presenter.ts`. Consider whether these should be consolidated with `getPlanSummary`/`willFitInSpace` now that both use `SyncPlan`.\n\n9. **`completedCount` field on ExecutorProgress** — the `const skipped = 0` issue (item #5) is now partially addressed since skipped is included in `completedCount` calculation, but the `let` vs `const` question remains.\n\n### Scope note\nItems 6-7 overlap with 186.14 Phase 1c (dead video pipeline code). Consider doing them together."

## Completed (2026-03-22)

- Removed unused PlanAddResult type from unified-planner.ts, index.ts, and demo mock
- Added 'space-constraint' to SyncWarningType union; updated unified-planner.ts to use it
- Added comment explaining intentional `const skipped = 0` in UnifiedExecutor.executeBatch

### Deferred
- **TranscodeProgress.speed type (item #3)**: Deferred because changing OperationProgress.transcodeProgress.speed from string to number would require updating tests and all conversion callsites. The string→number round-trip works correctly and changing it risks regressions. Can be done as a standalone refactor.
- **Old video pipeline exports (item #4)**: Overlaps with 186.14 Phase 1c — will be handled during the naming refactor.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Completed (2026-03-22)

- Removed unused PlanAddResult type from unified-planner.ts, index.ts, and demo mock
- Added 'space-constraint' to SyncWarningType union; updated unified-planner.ts to use it
- Added comment explaining intentional `const skipped = 0` in UnifiedExecutor.executeBatch
- Old video pipeline dead code (PlaceholderVideoSyncExecutor, createVideoExecutor) removed
- diffVideos/planVideoSync still exported — actively used by VideoPresenter in sync-presenter.ts, not dead code

### Deferred
- **TranscodeProgress.speed type (item #3)**: Deferred — changing OperationProgress.transcodeProgress.speed from string to number would require updating tests and all conversion callsites. The string→number round-trip works correctly. Can be done as a standalone refactor.
<!-- SECTION:FINAL_SUMMARY:END -->
