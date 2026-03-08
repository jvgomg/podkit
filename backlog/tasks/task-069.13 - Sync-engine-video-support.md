---
id: TASK-069.13
title: Sync engine video support
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-4
dependencies: []
references:
  - packages/podkit-core/src/sync/types.ts
  - packages/podkit-core/src/sync/executor.ts
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the sync engine to support video content alongside audio.

This includes diff calculation, plan generation, and execution for video tracks.

**Depends on:** TASK-069.12 (Video collection adapter), TASK-069.05 (Transcoder)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SyncOperation extended with video-transcode and video-copy types
- [ ] #2 SyncDiff works with video content
- [ ] #3 SyncPlan includes video operations with size/time estimates
- [ ] #4 SyncExecutor handles video transcode operations
- [ ] #5 Video operations respect device video support flag
- [ ] #6 Progress reporting during video transcoding
- [ ] #7 Dry-run shows video operations with passthrough/transcode status
- [ ] #8 Unit tests for video sync planning
<!-- AC:END -->
