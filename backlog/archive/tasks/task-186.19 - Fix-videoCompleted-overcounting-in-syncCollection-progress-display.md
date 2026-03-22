---
id: TASK-186.19
title: Fix videoCompleted overcounting in syncCollection progress display
status: To Do
assignee: []
created_date: '2026-03-22 15:10'
labels:
  - bug
  - ux
dependencies: []
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/sync/unified-executor.ts
parent_task_id: TASK-186
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

In `syncCollection()` (video sync path), `videoCompleted` increments on every `ExecutorProgress` event where `phase !== 'preparing' && phase !== 'complete'`. But `buildExecutorProgress` in `unified-executor.ts` derives `phase` from the operation type (e.g., always `'video-transcoding'` for a video-transcode op), not from the `OperationProgress` phase. So every progress event (starting, in-progress, complete from handler) maps to the same phase string, causing `videoCompleted` to increment dozens of times per video.

## Pre-existing

This bug existed before the 186.12/186.13 changes — `syncCollection()` was written in TASK-186.08 and has always had this behavior. The progress bar count is wrong for video sync.

## Fix

Track completion by counting only events where `OperationProgress.phase === 'complete'` (which maps to a unique `ExecutorProgress` event per completed operation), not by filtering on the operation-type phase. The `UnifiedExecutor.executeBatch` path yields one `'complete'`-phase event per finished operation.

Alternatively, add a `completedCount` field to `ExecutorProgress` that the executor maintains accurately.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Video sync progress display shows correct completed count (increments once per finished operation, not per progress event)
- [ ] #2 Music sync progress display also counts correctly through the unified executor path
<!-- AC:END -->
