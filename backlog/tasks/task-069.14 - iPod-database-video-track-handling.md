---
id: TASK-069.14
title: iPod database video track handling
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-4
dependencies: []
references:
  - packages/podkit-core/src/ipod/constants.ts
  - packages/libgpod-node/
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure iPod database layer correctly handles video tracks with appropriate MediaType flags and video-specific metadata.

Research libgpod's video support and implement accordingly.

**Depends on:** TASK-069.13 (Sync engine)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Research: Document how libgpod handles video tracks
- [ ] #2 MediaType.Movie constant added (or document existing approach)
- [ ] #3 addTrack supports video-specific fields
- [ ] #4 Video tracks appear in Videos menu on iPod
- [ ] #5 TV shows categorized correctly with series/season/episode
- [ ] #6 Movies categorized correctly
- [ ] #7 Poster artwork supported for video tracks
- [ ] #8 Integration tests verify video tracks added to iPod database
<!-- AC:END -->
