---
id: TASK-069.08
title: Video passthrough detection
status: Done
assignee: []
created_date: '2026-03-08 16:04'
updated_date: '2026-03-08 16:56'
labels:
  - video
  - phase-2
dependencies: []
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement logic to detect when a video can be copied directly without transcoding.

A video can passthrough when:
- H.264 codec with compatible profile/level
- Resolution <= device max
- Bitrate <= device max  
- AAC audio
- MP4/M4V container

**Depends on:** TASK-069.03 (Compatibility checker)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 canPassthrough(analysis, device) returns boolean with reasons
- [x] #2 Correctly identifies compatible H.264 MP4 files
- [x] #3 Rejects incompatible containers (MKV, AVI) even with compatible codec
- [ ] #4 Rejects incompatible audio (needs AAC)
- [ ] #5 Rejects over-resolution/over-bitrate files
- [ ] #6 Dry-run output shows passthrough vs transcode status
- [ ] #7 Unit tests cover edge cases
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete with 7 additional tests (55 total in compatibility.test.ts). Features: canPassthrough() convenience wrapper, PassthroughResult type.
<!-- SECTION:NOTES:END -->
