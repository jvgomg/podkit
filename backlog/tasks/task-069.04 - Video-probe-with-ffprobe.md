---
id: TASK-069.04
title: Video probe with ffprobe
status: Done
assignee: []
created_date: '2026-03-08 16:04'
updated_date: '2026-03-08 16:49'
labels:
  - video
  - phase-1
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement video file analysis using ffprobe to extract codec, resolution, bitrate, and other technical metadata.

Extends the existing FFmpeg integration pattern used for audio.

**Depends on:** TASK-069.01 (Video types)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 probeVideo(filePath) function returns VideoSourceAnalysis
- [x] #2 Extracts video codec, profile, level
- [x] #3 Extracts resolution (width x height)
- [x] #4 Extracts video bitrate
- [x] #5 Extracts audio codec and bitrate
- [x] #6 Extracts duration
- [x] #7 Extracts container format
- [x] #8 Handles missing/corrupt files gracefully with clear errors
- [ ] #9 Integration tests with video fixtures
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented probeVideo() using ffprobe with dependency injection for testing. 22 unit tests pass. Note: AC#9 (integration tests with fixtures) will be verified in TASK-069.16 E2E tests.
<!-- SECTION:NOTES:END -->
