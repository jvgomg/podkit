---
id: TASK-069.10
title: Embedded video metadata adapter
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-3
dependencies: []
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement VideoMetadataAdapter that extracts metadata from video file tags using ffprobe.

This is the primary/default adapter for v1.

**Depends on:** TASK-069.09 (Adapter interface), TASK-069.04 (Probe)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 EmbeddedVideoMetadataAdapter implements VideoMetadataAdapter
- [ ] #2 Extracts title from metadata tags
- [ ] #3 Extracts year/date
- [ ] #4 Extracts description/comment
- [ ] #5 Extracts genre
- [ ] #6 Detects embedded poster/thumbnail
- [ ] #7 Falls back to filename parsing when tags missing
- [ ] #8 Integration tests with fixture files containing metadata
<!-- AC:END -->
