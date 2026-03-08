---
id: TASK-069.05
title: Video transcoder implementation
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
labels:
  - video
  - phase-2
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - docs/adr/ADR-006-video-transcoding.md
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement FFmpeg-based video transcoding to iPod-compatible H.264 format.

Core transcoding functionality that converts video files to M4V with H.264 video and AAC audio.

**Depends on:** TASK-069.01 (Types), TASK-069.04 (Probe)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 transcodeVideo(input, output, settings) function
- [ ] #2 Outputs H.264 Main profile for iPod Classic
- [ ] #3 Outputs H.264 Baseline profile for older iPods
- [ ] #4 Includes AAC audio track (stereo)
- [ ] #5 Uses M4V container with faststart flag
- [ ] #6 Scales video to target resolution maintaining aspect ratio
- [ ] #7 Adds letterboxing/pillarboxing as needed
- [ ] #8 Limits frame rate to 30fps
- [ ] #9 Progress callback with percentage complete
- [ ] #10 Supports abort signal for cancellation
- [ ] #11 Hardware acceleration on macOS (VideoToolbox) when available
- [ ] #12 Integration tests verify output plays on iPod (via ffprobe validation)
<!-- AC:END -->
