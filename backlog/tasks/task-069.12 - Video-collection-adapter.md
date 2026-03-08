---
id: TASK-069.12
title: Video collection adapter
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-4
dependencies: []
references:
  - packages/podkit-core/src/adapters/directory.ts
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a VideoDirectoryAdapter that scans directories for video files, similar to the audio DirectoryAdapter.

Separate from audio adapter due to different file types, metadata handling, and content type detection.

**Depends on:** TASK-069.09-11 (Metadata adapters)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 VideoDirectoryAdapter class following CollectionAdapter pattern
- [ ] #2 Scans for video extensions (mkv, mp4, m4v, avi, mov, webm, wmv)
- [ ] #3 Returns CollectionVideo items with file info and metadata
- [ ] #4 Supports recursive directory scanning
- [ ] #5 Supports include/exclude patterns
- [ ] #6 Progress events during scanning
- [ ] #7 Uses VideoMetadataAdapter for metadata extraction
- [ ] #8 Unit tests for scanning logic
- [ ] #9 Integration tests with fixture directories
<!-- AC:END -->
