---
id: TASK-069.03
title: Video compatibility checker
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
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
- [ ] #1 checkVideoCompatibility(analysis, device) returns VideoCompatibility
- [ ] #2 Identifies H.264 Baseline/Main profile as potentially compatible
- [ ] #3 Checks resolution against device max
- [ ] #4 Checks bitrate against device max
- [ ] #5 Checks audio codec (must be AAC)
- [ ] #6 Checks container (must be MP4/M4V for passthrough)
- [ ] #7 Returns 'passthrough' for fully compatible files
- [ ] #8 Returns 'transcode' with reasons for incompatible files
- [ ] #9 Returns 'unsupported' for unhandled codecs
- [ ] #10 Unit tests cover all compatibility scenarios
<!-- AC:END -->
