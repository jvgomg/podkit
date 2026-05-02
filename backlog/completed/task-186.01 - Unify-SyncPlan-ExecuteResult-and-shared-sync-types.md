---
id: TASK-186.01
title: 'Unify SyncPlan, ExecuteResult, and shared sync types'
status: Done
assignee: []
created_date: '2026-03-21 23:19'
updated_date: '2026-03-22 11:07'
labels:
  - refactor
dependencies: []
references:
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/video-planner.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-cli/src/commands/sync.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Eliminate the duplicate type pairs where music and video have structurally identical types under different names. This is the lowest-risk first step — purely type-level changes with no behavioral impact.

**Current state:**
- `SyncPlan` (types.ts:228) and `VideoSyncPlan` (video-planner.ts:71) are structurally identical: `{ operations: SyncOperation[], estimatedTime: number, estimatedSize: number, warnings: SyncWarning[] }`
- `ExecuteResult` (executor.ts) and `VideoExecuteResult` (video-executor.ts) are parallel but divergent — music has `categorizedErrors` and `warnings`, video has `errors: Array<{ operation, error }>`
- `ExecutorProgress` and `VideoExecutorProgress` both extend `SyncProgress` but add different fields
- `getPlanSummary()` and `getVideoPlanSummary()` are parallel utility functions
- `willFitInSpace()` and `willVideoPlanFit()` are parallel utility functions
- `getOperationDisplayName()` and `getVideoOperationDisplayName()` are parallel utility functions

**What to do:**

1. **Unify `SyncPlan`** — Delete `VideoSyncPlan` and use `SyncPlan` everywhere. They are already identical. Update all imports in `video-planner.ts`, `video-executor.ts`, and `packages/podkit-cli/src/commands/sync.ts`.

2. **Unify `ExecuteResult`** — Create a single `ExecuteResult` type that is a superset:
   ```typescript
   interface ExecuteResult {
     completed: number;
     failed: number;
     skipped: number;
     errors: CategorizedError[];  // video will now use this too
     warnings: ExecutionWarning[];
     aborted?: boolean;
   }
   ```
   The video executor currently uses a simpler error shape — update it to use `CategorizedError` (this prepares for the video retry/error-categorization subtask).

3. **Unify `ExecutorProgress`** — Create a single progress type that includes both music and video extensions:
   ```typescript
   interface ExecutorProgress extends SyncProgress {
     operation?: SyncOperation;
     index?: number;
     error?: Error;
     categorizedError?: CategorizedError;
     skipped?: boolean;
     retryAttempt?: number;
     transcodeProgress?: TranscodeProgress;  // from video
   }
   ```

4. **Unify utility functions** — Merge `getPlanSummary`/`getVideoPlanSummary` into a single function that handles all operation types in the `SyncOperation` union. Same for `willFitInSpace`/`willVideoPlanFit` and `getOperationDisplayName`/`getVideoOperationDisplayName`.

**Key files to modify:**
- `packages/podkit-core/src/sync/types.ts` — unified types live here
- `packages/podkit-core/src/sync/video-planner.ts` — remove `VideoSyncPlan`, update imports
- `packages/podkit-core/src/sync/video-executor.ts` — remove `VideoExecuteResult`, `VideoExecutorProgress`, update to use unified types
- `packages/podkit-core/src/sync/executor.ts` — update `ExecuteResult` and `ExecutorProgress` to include video fields
- `packages/podkit-core/src/sync/planner.ts` — merge utility functions
- `packages/podkit-cli/src/commands/sync.ts` — update all references to removed types

**Testing:** Run `bun run test --filter podkit-core` and `bun run test --filter podkit-cli` to verify no regressions. These are type-level changes so tests should pass without modification (unless tests reference the old type names directly).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoSyncPlan type is deleted — all code uses SyncPlan
- [x] #2 A single ExecuteResult type exists with CategorizedError[] (no separate VideoExecuteResult)
- [x] #3 A single ExecutorProgress type exists with both music and video extension fields
- [x] #4 getPlanSummary, willFitInSpace, and getOperationDisplayName each have a single implementation handling all operation types
- [x] #5 All existing tests pass without behavioral changes
<!-- AC:END -->
