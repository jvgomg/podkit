---
id: TASK-186
title: Unify sync pipeline with Content Type Handler pattern
status: Done
assignee: []
created_date: '2026-03-21 23:18'
updated_date: '2026-03-22 21:03'
labels:
  - refactor
  - architecture
dependencies: []
references:
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/video-differ.ts
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-core/src/sync/video-planner.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/video/directory-adapter.ts
  - packages/podkit-cli/src/commands/sync.ts
documentation:
  - doc-010
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sync pipeline has parallel implementations for music and video at every stage (differ, planner, executor), with ~20 duplicate type pairs (SyncDiff/VideoSyncDiff, SyncPlan/VideoSyncPlan, ExecuteResult/VideoExecuteResult, etc.). Adding a new content type requires duplicating all of this, and developers frequently forget to update one branch when making changes.

This initiative introduces a generic `ContentTypeHandler<TSource, TDevice>` interface that each media type implements, and refactors the pipeline into a shared orchestration layer that delegates type-specific decisions to the handler. This enables adding new content types by implementing a single handler rather than duplicating the entire pipeline.

The migration is incremental: first unify types, then upgrade video to feature parity, then define the handler interface, then unify each pipeline stage one at a time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single ContentTypeHandler<TSource, TDevice> interface exists and is implemented by MusicHandler and VideoHandler
- [x] #2 The differ, planner, and executor each have a single generic implementation that delegates to handlers
- [x] #3 Adding a new content type requires only: implementing ContentTypeHandler, a CollectionAdapter, and entity types — no pipeline duplication
- [x] #4 All existing music and video tests pass without behavioral changes
- [x] #5 Video sync has feature parity with music: retries, error categorization, and self-healing upgrades
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completion Status (2026-03-22)\n\nSubtasks 186.01–186.08 completed the initial migration. Follow-up sessions completed 186.09–186.13, 186.18.\n\n### Phase 1 (186.01–186.08): Core unification\n- ContentTypeHandler interface, MusicHandler, VideoHandler\n- UnifiedDiffer, UnifiedPlanner, UnifiedExecutor\n- CLI syncCollection() for video\n- All deprecated wrappers removed\n\n### Phase 2 (186.09–186.13): Handler migration\n- Video transcode progress restored\n- Demo mock updated\n- Music diff/plan migrated to UnifiedDiffer/UnifiedPlanner\n- MusicHandler.executeBatch() wraps DefaultSyncExecutor\n\n### Phase 3 (current session, 2026-03-22): CLI unification + bug fixes\n\n**Completed:**\n- **186.18**: Fixed videoCompleted overcounting — added `completedCount` to `ExecutorProgress`\n- **186.19**: Archived (duplicate of 186.18)\n- **Video CLI migration**: Both `syncVideoCollection` and `syncCollection` now use UnifiedDiffer/UnifiedPlanner with VideoHandler (was calling old diffVideos/planVideoSync directly)\n- **VideoHandler enhancements**: Added `postProcessDiff` (preset-change detection + force-metadata sweep), proper `applyTransformKey`, `transformSourceForAdd`, transform-aware `detectUpdates`, `setVideoTransformsConfig`, `VideoHandlerDiffOptions` type\n- **186.12 completion**: Implemented ContentTypePresenter pattern in new `sync-presenter.ts` (1384 lines). Deleted syncMusicCollection, syncVideoCollection, old syncCollection, buildMusicDryRunOutput. sync.ts reduced from ~2555 to ~1140 lines.\n\n**Key architectural addition — ContentTypePresenter pattern:**\n- CLI-level `ContentTypePresenter<TSource, TDevice>` interface in `packages/podkit-cli/src/commands/sync-presenter.ts`\n- `MusicPresenter` and `VideoPresenter` implementations\n- `genericSyncCollection()` (~150 lines) handles content-type-agnostic sync flow\n- Adding a new content type (podcasts, photos) requires implementing a presenter + handler\n\n**Files changed:**\n- `packages/podkit-core/src/sync/types.ts` — added `completedCount` to ExecutorProgress\n- `packages/podkit-core/src/sync/unified-executor.ts` — tracks completedCount\n- `packages/podkit-core/src/sync/executor.ts` — tracks completedCount in DefaultSyncExecutor\n- `packages/podkit-core/src/sync/video-executor.ts` — tracks completedCount\n- `packages/podkit-core/src/sync/handlers/video-handler.ts` — postProcessDiff, transforms, detectUpdates enhancements\n- `packages/podkit-core/src/index.ts` — exports VideoHandlerDiffOptions\n- `packages/podkit-cli/src/commands/sync-presenter.ts` — NEW: presenter pattern\n- `packages/podkit-cli/src/commands/sync.ts` — reduced, uses genericSyncCollection\n- `packages/podkit-cli/src/commands/sync-empty-source.test.ts` — updated for new API\n- `packages/podkit-cli/src/commands/sync-aggregation.test.ts` — updated for new API\n\n**All tests pass:** 1899 core, 763+58 CLI, 23 E2E. Build clean.\n\n### Remaining subtasks:\n- **186.14** (Low): Naming refactor — remove \"Unified\" prefix, add \"Music\" prefix\n- **186.15** (High → repurpose): Remove handler registry instead of testing it (decision made this session)\n- **186.16** (High): VideoHandler execute path tests\n- **186.17** (Medium): MusicHandler + UnifiedExecutor test gaps\n- **186.20** (Low): Dead code cleanup + type inconsistencies\n\n**Note:** All changes from this session are uncommitted. The user handles commits.

## Changeset required

The previous developer noted a changeset is needed before merging. Changes touch @podkit/core's public API:
- New exports: `completedCount` on `ExecutorProgress`, `VideoHandlerDiffOptions`
- New methods on `ContentTypeHandler`: `postProcessDiff`, `transformSourceForAdd` (VideoHandler now implements both)
- New methods on `VideoHandler`: `setVideoTransformsConfig`, `setVideoQuality` (already existed)

Run `bunx changeset` and select `@podkit/core` with a minor bump.

## Uncommitted changes

All Phase 3 changes are uncommitted in the main working directory. The user handles commits. Run `git diff HEAD --stat` to see the full scope.

## Session 3 completion (2026-03-22)

All remaining subtasks completed:

| Task | Work Done |
|------|----------|
| 186.14 | Naming symmetry: Music prefix (Phase 1) + Unified→generic rename (Phase 2) |
| 186.15 | Removed unused handler registry from content-type.ts and public API |
| 186.16 | Added 26 VideoHandler tests (execute paths + diff/plan branches) |
| 186.17 | Added 21 MusicHandler + SyncExecutor tests (forceTranscode, transcodingActive, video phases) |
| 186.20 | Removed dead code (PlanAddResult, PlaceholderVideoSyncExecutor), fixed SyncWarningType |

### Deferred to standalone tasks
- **TASK-187**: TranscodeProgress.speed type inconsistency (string vs number)
- **TASK-188**: DRY consolidation of duplicate utility functions across music/video executors

### Final file layout (sync module)
- `differ.ts` — generic SyncDiffer (was unified-differ.ts)
- `planner.ts` — generic SyncPlanner (was unified-planner.ts)
- `executor.ts` — generic SyncExecutor (was unified-executor.ts)
- `music-differ.ts` — computeMusicDiff (was differ.ts)
- `music-planner.ts` — createMusicPlan (was planner.ts)
- `music-executor.ts` — MusicExecutor (was executor.ts)
- `video-differ.ts`, `video-planner.ts`, `video-executor.ts` — unchanged
- `handlers/music-handler.ts`, `handlers/video-handler.ts` — ContentTypeHandler implementations
- `content-type.ts` — ContentTypeHandler interface (registry removed)

### Quality
- 1945 tests, 0 failures
- Build green across all 8 packages
- All changes uncommitted, pending user review
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## TASK-186: Unify sync pipeline with ContentTypeHandler pattern — Complete\n\nA multi-session initiative (186.01–186.20) that introduced a generic `ContentTypeHandler<TSource, TDevice>` interface and refactored the sync pipeline into a shared orchestration layer.\n\n### What was built\n- **ContentTypeHandler interface** with MusicHandler and VideoHandler implementations\n- **Generic pipeline**: SyncDiffer, SyncPlanner, SyncExecutor delegate to handlers\n- **CLI ContentTypePresenter pattern** for content-type-agnostic sync orchestration\n- **Naming symmetry**: Music-specific code has Music prefix, generic pipeline uses Sync prefix\n\n### Adding a new content type now requires\n1. Implement `ContentTypeHandler<TSource, TDevice>`\n2. Implement `ContentTypePresenter<TSource, TDevice>` (CLI)\n3. Implement a `CollectionAdapter<TSource, TFilter>`\n4. Define source/device entity types\n\nNo pipeline duplication needed.\n\n### Test coverage added\n- 47 new tests across VideoHandler execute paths, MusicHandler branches, and SyncExecutor video phases\n\n### Deferred work\n- TASK-187: TranscodeProgress.speed type inconsistency\n- TASK-188: DRY consolidation of duplicate utility functions
<!-- SECTION:FINAL_SUMMARY:END -->
