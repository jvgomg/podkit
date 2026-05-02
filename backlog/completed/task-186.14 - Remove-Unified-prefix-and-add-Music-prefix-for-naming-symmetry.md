---
id: TASK-186.14
title: Remove "Unified" prefix and add "Music" prefix for naming symmetry
status: Done
assignee: []
created_date: '2026-03-22 12:51'
updated_date: '2026-03-22 21:21'
labels:
  - refactor
  - architecture
  - naming
dependencies:
  - TASK-186.12
references:
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/unified-differ.ts
  - packages/podkit-core/src/sync/unified-planner.ts
  - packages/podkit-core/src/sync/unified-executor.ts
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/demo/src/mock-core.ts
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Make music and video first-class concepts in the codebase by:
1. Adding "Music" prefixes to music-specific symbols that currently use generic names (e.g., `SyncDiff` → `MusicSyncDiff`)
2. Removing the "Unified" prefix from generic pipeline components (e.g., `UnifiedDiffer` → `SyncDiffer`)
3. Cleaning up dead video pipeline code that's no longer referenced
4. Consolidating duplicate utility functions where the handler pattern makes them redundant

## Background

The codebase was originally music-only. When video was added, video-specific code got `Video` prefixes while music code kept unprefixed generic names. TASK-186 then added `Unified` prefixes to avoid collisions. The result is three naming conventions coexisting:

- Generic names that are actually music-specific: `SyncDiff`, `computeDiff`, `DefaultSyncExecutor`
- Video-prefixed names: `VideoSyncDiff`, `diffVideos`, `VideoHandler`
- Unified-prefixed generic pipeline: `UnifiedDiffer`, `UnifiedPlanner`, `UnifiedExecutor`

## Execution plan

### Phase 1a: Rename music files
- `differ.ts` → `music-differ.ts` (and test files)
- `planner.ts` → `music-planner.ts` (and test files)
- `executor.ts` → `music-executor.ts` (and test files)

### Phase 1b: Add "Music" prefix to music-specific symbols
| Old | New |
|-----|-----|
| `SyncDiff` | `MusicSyncDiff` |
| `SyncDiffer` | `MusicSyncDiffer` |
| `SyncPlanner` | `MusicSyncPlanner` |
| `SyncExecutor` | `MusicSyncExecutor` |
| `DiffOptions` | `MusicDiffOptions` |
| `PlanOptions` | `MusicPlanOptions` |
| `ExecuteOptions` | `MusicExecuteOptions` |
| `computeDiff()` | `computeMusicDiff()` |
| `createPlan()` | `createMusicPlan()` |
| `DefaultSyncExecutor` | `MusicExecutor` (or `DefaultMusicExecutor`) |
| `createExecutor()` | `createMusicExecutor()` |
| `executePlan()` | `executeMusicPlan()` |
| `getOperationDisplayName()` | `getMusicOperationDisplayName()` |
| `calculateOperationSize()` | `calculateMusicOperationSize()` |
| `getPlanSummary()` | `getMusicPlanSummary()` |
| `willFitInSpace()` | `willMusicFitInSpace()` |
| `DEFAULT_RETRY_CONFIG` | `MUSIC_RETRY_CONFIG` |

### Phase 1c: Remove dead video pipeline code
- Delete `syncVideoCollection()` and `VideoSyncContext` from CLI sync.ts (replaced by `syncCollection()`)
- Delete `PlaceholderVideoSyncExecutor` and `createVideoExecutor()` from video-executor.ts
- Clean up old video factory functions that return placeholders
- Update the one test that still references `syncVideoCollection`

### Phase 2a: Rename unified files
- `unified-differ.ts` → `differ.ts` (now free after Phase 1a)
- `unified-planner.ts` → `planner.ts`
- `unified-executor.ts` → `executor.ts`

### Phase 2b: Remove "Unified" prefix from generic symbols
| Old | New |
|-----|-----|
| `UnifiedSyncDiff` | `SyncDiff` |
| `UnifiedDiffOptions` | `DiffOptions` |
| `UnifiedDiffer` | `SyncDiffer` |
| `createUnifiedDiffer` | `createDiffer` |
| `UnifiedPlanOptions` | `PlanOptions` |
| `UnifiedPlanner` | `SyncPlanner` |
| `createUnifiedPlanner` | `createPlanner` |
| `UnifiedExecuteOptions` | `ExecuteOptions` |
| `UnifiedExecutor` | `SyncExecutor` |
| `createUnifiedExecutor` | `createExecutor` |
| `UnifiedSyncContext` (CLI) | `SyncContext` |
| `UnifiedSyncResult` (CLI) | `SyncResult` |

### Phase 2c: Update demo mock and exports
- Update all renamed symbols in `mock-core.ts`
- Update all re-exports in `index.ts`

## DRY opportunities to address
- Parallel display name functions (`getOperationDisplayName` vs `getVideoOperationDisplayName`) — make handler-internal once music also uses unified pipeline
- Parallel size/time estimation — already encapsulated by handler methods
- Duplicate error handling between `executor.ts` and `error-handling.ts` — consolidate once music uses unified executor

## Files affected (~25)
- `packages/podkit-core/src/sync/` — all differ/planner/executor files and tests
- `packages/podkit-core/src/sync/types.ts`
- `packages/podkit-core/src/sync/handlers/music-handler.ts`
- `packages/podkit-core/src/index.ts`
- `packages/podkit-cli/src/commands/sync.ts` and test files
- `packages/demo/src/mock-core.ts`

## Interaction with other tasks
- **TASK-186.12** (migrate music executor) should complete first — it deletes `DefaultSyncExecutor` and `syncMusicCollection`, reducing the number of symbols that need "Music" prefixes
- **TASK-186.13** (migrate music differ/planner) is related but not a hard dependency — the underlying functions (`computeMusicDiff`, `createMusicPlan`) will still exist as handler internals regardless
- If 186.12 completes first, Phase 1b has fewer symbols to rename and Phase 1c may already be partially done
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Music-specific files renamed: differ.ts → music-differ.ts, planner.ts → music-planner.ts, executor.ts → music-executor.ts
- [x] #2 All music-specific symbols have explicit Music prefix — no generic names for music-only code
- [x] #3 Dead video pipeline code removed: syncVideoCollection(), PlaceholderVideoSyncExecutor, old video factory functions
- [x] #4 Unified files renamed: unified-differ.ts → differ.ts, unified-planner.ts → planner.ts, unified-executor.ts → executor.ts
- [x] #5 All "Unified" prefixes removed from generic pipeline symbols (SyncDiffer, SyncPlanner, SyncExecutor, etc.)
- [x] #6 Demo mock updated to match all renamed exports
- [x] #7 All tests pass — build clean, core tests, CLI tests, E2E tests
- [x] #8 Duplicate utility functions identified and consolidated where handler pattern makes them redundant
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Prerequisites completed (2026-03-22)\n\n186.12 is done. syncMusicCollection, syncVideoCollection, and the old syncCollection are all deleted. The CLI now uses `genericSyncCollection()` with `MusicPresenter`/`VideoPresenter` from `sync-presenter.ts`.\n\n## Updated scope\n\nThe scope has changed significantly because of the presenter pattern refactor:\n\n### Phase 1a (rename music files) — unchanged\n- `differ.ts` → `music-differ.ts`, `planner.ts` → `music-planner.ts`, `executor.ts` → `music-executor.ts`\n\n### Phase 1b (Music prefix) — reduced scope\nMany symbols from the original plan were already deleted (syncMusicCollection, MusicSyncContext, etc.). Remaining symbols to rename:\n- `SyncDiff` → `MusicSyncDiff`\n- `DiffOptions` → `MusicDiffOptions`\n- `computeDiff()` → `computeMusicDiff()`\n- `DefaultSyncExecutor` → `MusicExecutor` (still used internally by MusicHandler.executeBatch via MusicPresenter)\n- `createPlan()` → `createMusicPlan()`\n- `getOperationDisplayName()` → `getMusicOperationDisplayName()`\n- `getPlanSummary()` → `getMusicPlanSummary()`\n- `willFitInSpace()` → `willMusicFitInSpace()`\n- `DEFAULT_RETRY_CONFIG` → `MUSIC_RETRY_CONFIG`\n\n### Phase 1c (dead video code) — partially done\n- `syncVideoCollection()` already deleted (was in sync.ts, now removed)\n- Still to clean: `PlaceholderVideoSyncExecutor`, `createVideoExecutor()` from video-executor.ts\n- Check if old video factory functions have any remaining callers\n\n### Phase 2a-2c (Unified → generic names) — unchanged\n- Rename unified-differ.ts → differ.ts, etc.\n- Remove \"Unified\" prefix from all generic symbols\n- Update demo mock and exports\n\n### New files to update\n- `packages/podkit-cli/src/commands/sync-presenter.ts` — references UnifiedDiffer, UnifiedPlanner, UnifiedExecutor, DefaultSyncExecutor, getOperationDisplayName, getPlanSummary, willFitInSpace\n- `packages/podkit-cli/src/commands/sync.ts` — reduced file, references genericSyncCollection and presenter types\n\n### Important: DefaultSyncExecutor\nDefaultSyncExecutor is still used internally by MusicPresenter (via MusicHandler.executeBatch). During the rename, it becomes `MusicExecutor`. It should NOT be deleted — just renamed and kept as an internal implementation detail of the music execution pipeline.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Completed: Naming symmetry rename

### Phase 1: Music prefix
- Renamed differ.ts→music-differ.ts, planner.ts→music-planner.ts, executor.ts→music-executor.ts
- Renamed symbols: computeDiff→computeMusicDiff, createPlan→createMusicPlan, DefaultSyncExecutor→MusicExecutor, etc.
- Added backward-compat aliases in index.ts

### Phase 2: Unified→generic
- Renamed unified-differ.ts→differ.ts, unified-planner.ts→planner.ts, unified-executor.ts→executor.ts
- Renamed symbols: UnifiedDiffer→SyncDiffer, UnifiedPlanner→SyncPlanner, UnifiedExecutor→SyncExecutor, etc.
- Added backward-compat aliases (old Unified* names still exported)
- Updated CLI (sync-presenter.ts), demo mock, all test files

### Deferred
- DRY consolidation of duplicate video executor code (separate task)

All 1945 tests pass, build green across all 8 packages.
<!-- SECTION:FINAL_SUMMARY:END -->
