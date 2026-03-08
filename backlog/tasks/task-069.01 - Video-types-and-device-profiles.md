---
id: TASK-069.01
title: Video types and device profiles
status: Done
assignee: []
created_date: '2026-03-08 16:04'
updated_date: '2026-03-08 16:36'
labels:
  - video
  - phase-1
dependencies: []
documentation:
  - docs/VIDEO-TRANSCODING.md
  - docs/adr/ADR-006-video-transcoding.md
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define TypeScript types for video transcoding including quality presets, device profiles, and source analysis results.

This is foundational work that other video tasks depend on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoQualityPreset type defined (max/high/medium/low) mirroring audio presets
- [x] #2 DeviceProfile type with resolution, bitrate limits, codec constraints for each iPod model
- [x] #3 VideoSourceAnalysis type for ffprobe results (codec, resolution, bitrate, etc.)
- [x] #4 VideoTranscodeSettings type for calculated transcode parameters
- [x] #5 VideoCompatibility type for passthrough/transcode/unsupported status
- [x] #6 Types exported from podkit-core index
- [x] #7 Unit tests verify type exports
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in commit 1273bb6. All types exported from podkit-core, 27 unit tests pass.
<!-- SECTION:NOTES:END -->
