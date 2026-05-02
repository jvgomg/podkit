---
id: TASK-186.12
title: Migrate music executor pipeline into MusicHandler.executeBatch()
status: Done
assignee: []
created_date: '2026-03-22 12:35'
updated_date: '2026-03-22 20:08'
labels:
  - refactor
  - architecture
dependencies:
  - TASK-186
references:
  - packages/podkit-core/src/sync/handlers/music-handler.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/demo/src/mock-core.ts
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Route music execution through the unified pipeline by wrapping `DefaultSyncExecutor`'s 3-stage async pipeline (download → prepare → transfer) into `MusicHandler.executeBatch()`. This is the final step to fully unify the CLI sync orchestration — once done, `syncMusicCollection()` can be deleted and all content types route through `syncCollection()`.

## Background

TASK-186 unified the sync pipeline with a ContentTypeHandler pattern. Video is fully unified. Music execution still goes through `DefaultSyncExecutor` directly in the CLI because:

1. `MusicHandler.executeBatch()` is currently a sequential stub
2. The 3-stage pipeline (download → prepare → transfer) in `DefaultSyncExecutor` provides critical performance via cross-operation parallelism (one file transcodes while another transfers to USB)
3. Wrapping this pipeline into the handler was deemed too risky during TASK-186

## What to do

1. **Wrap the pipeline into `MusicHandler.executeBatch()`** — The handler should internally instantiate the 3-stage pipeline from `DefaultSyncExecutor` and yield `OperationProgress` events as operations complete. The handler owns the pipeline lifecycle.

2. **Update `syncCollection()` to handle music** — Once `executeBatch()` works, music collections can route through `syncCollection()` instead of `syncMusicCollection()`.

3. **Delete `syncMusicCollection()`** and `MusicSyncContext` from `sync.ts`.

4. **Delete `DefaultSyncExecutor`** from `executor.ts` — its logic now lives inside `MusicHandler.executeBatch()`.

5. **Consolidate context types** — Replace remaining `MusicSyncContext` with `UnifiedSyncContext`.

## Key risk

Performance regression. The 3-stage pipeline's parallelism is critical for music sync speed. Before and after benchmarks should verify no regression.

## Key files

- `packages/podkit-core/src/sync/handlers/music-handler.ts` — implement real `executeBatch()`
- `packages/podkit-core/src/sync/executor.ts` — extract pipeline, then delete `DefaultSyncExecutor`
- `packages/podkit-cli/src/commands/sync.ts` — delete `syncMusicCollection()`, route music through `syncCollection()`
- `packages/demo/src/mock-core.ts` — remove `DefaultSyncExecutor` mock

## Deferred from

- TASK-186.07 AC#2 (MusicHandler pipeline)
- TASK-186.07 AC#8 (delete DefaultSyncExecutor)
- TASK-186.08 AC#2 (delete syncMusicCollection)
- TASK-186.08 AC#3 (consolidate context types)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MusicHandler.executeBatch() wraps the 3-stage async pipeline (download → prepare → transfer) and yields OperationProgress events
- [x] #2 Music sync performance is not regressed — before/after benchmarks show equivalent throughput
- [x] #3 syncMusicCollection() and MusicSyncContext are deleted from sync.ts — music routes through syncCollection()
- [ ] #4 DefaultSyncExecutor class is deleted from executor.ts
- [x] #5 All existing music executor tests pass against MusicHandler.executeBatch()
- [x] #6 Demo mock updated to remove DefaultSyncExecutor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Related tasks

**TASK-186.14** (naming refactor) depends on this task. Completing 186.12 first reduces the scope of the rename — `DefaultSyncExecutor`, `syncMusicCollection`, and `MusicSyncContext` would be deleted here rather than renamed there.

## Partial completion (2026-03-22)

- MusicHandler.executeBatch() wraps DefaultSyncExecutor via composition ✓
- Progress bridging from ExecutorProgress → OperationProgress ✓
- CLI syncMusicCollection() now uses UnifiedExecutor + MusicHandler ✓
- All E2E tests pass ✓

Remaining: delete syncMusicCollection() (generalize syncCollection), delete DefaultSyncExecutor, update demo mock

## Code review findings (2026-03-22)

- `bridgeProgress` maps both 'complete' and 'skipped' to phase='complete' — loses phase distinction but preserves `skipped` field. Acceptable for now since UnifiedExecutor checks `.phase === 'complete'` and `.phase === 'failed'` independently.
- DefaultSyncExecutor final save still happens internally — no double-save risk.
- Remaining AC: #3 (delete syncMusicCollection), #4 (delete DefaultSyncExecutor), #6 (demo mock) blocked on CLI unification work.

## Phase 2 completion (2026-03-22)

Implemented ContentTypePresenter pattern in `sync-presenter.ts` (1384 lines):
- `ContentTypePresenter<TSource, TDevice>` interface
- `MusicPresenter` extracts all music-specific logic from old syncMusicCollection
- `VideoPresenter` extracts all video-specific logic from old syncCollection
- `genericSyncCollection()` (~150 lines) handles content-type-agnostic sync flow

sync.ts reduced from ~2555 to ~1140 lines. Deleted syncMusicCollection, syncVideoCollection, old syncCollection, buildMusicDryRunOutput, and all their context types.

DefaultSyncExecutor NOT deleted (AC#4) — still used internally by MusicPresenter. Will be addressed in 186.14 naming refactor.

All tests pass: 1899 core, 763+58 CLI, 23 E2E.
<!-- SECTION:NOTES:END -->
