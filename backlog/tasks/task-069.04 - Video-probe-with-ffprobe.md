---
id: TASK-069.04
title: Video probe with ffprobe
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
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
- [ ] #1 probeVideo(filePath) function returns VideoSourceAnalysis
- [ ] #2 Extracts video codec, profile, level
- [ ] #3 Extracts resolution (width x height)
- [ ] #4 Extracts video bitrate
- [ ] #5 Extracts audio codec and bitrate
- [ ] #6 Extracts duration
- [ ] #7 Extracts container format
- [ ] #8 Handles missing/corrupt files gracefully with clear errors
- [ ] #9 Integration tests with video fixtures
<!-- AC:END -->
