---
id: TASK-069.03
title: Video compatibility checker
status: Done
assignee: []
created_date: '2026-03-08 16:04'
updated_date: '2026-03-08 16:49'
labels:
  - video
  - phase-1
dependencies: []
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement logic to determine if a video file is iPod-compatible (passthrough), needs transcoding, or is unsupported.

Uses VideoSourceAnalysis and DeviceProfile to make the determination.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 checkVideoCompatibility(analysis, device) returns VideoCompatibility
- [x] #2 Identifies H.264 Baseline/Main profile as potentially compatible
- [x] #3 Checks resolution against device max
- [x] #4 Checks bitrate against device max
- [x] #5 Checks audio codec (must be AAC)
- [x] #6 Checks container (must be MP4/M4V for passthrough)
- [x] #7 Returns 'passthrough' for fully compatible files
- [x] #8 Returns 'transcode' with reasons for incompatible files
- [x] #9 Returns 'unsupported' for unhandled codecs
- [x] #10 Unit tests cover all compatibility scenarios
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented checkVideoCompatibility() with helper functions. 48 unit tests pass.
<!-- SECTION:NOTES:END -->
