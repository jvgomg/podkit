---
id: TASK-069
title: Video sync support (movies and TV shows)
status: To Do
assignee: []
created_date: '2026-03-08 15:52'
updated_date: '2026-03-08 16:03'
labels:
  - epic
  - video
dependencies: []
documentation:
  - docs/VIDEO-TRANSCODING.md
  - docs/adr/ADR-006-video-transcoding.md
  - docs/TRANSCODING.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Epic: Add support for syncing movies and TV shows to iPod devices.

See sub-tasks for implementation breakdown. This parent task tracks overall completion.

Key requirements:
- Wide input format support (MKV, MP4, AVI, MOV, etc.) with early validation
- Pass-through for already-compatible files (similar to audio lossy handling)
- Quality presets (max/high/medium/low) that map to device-appropriate bitrates
- Source quality awareness: never "upscale" low-quality content
- Extensible metadata architecture using adapter pattern
- Support for both movies and TV shows with appropriate metadata
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Video files (MKV, MP4, AVI, MOV, WebM) can be transcoded to iPod-compatible M4V
- [ ] #2 Quality presets (max/high/medium/low) produce appropriate bitrates for target device
- [ ] #3 Source quality detection prevents upscaling low-quality content
- [ ] #4 Compatible files pass through without re-encoding
- [ ] #5 Dry-run validates video files and reports compatibility issues
- [ ] #6 Movies and TV shows are distinguished and have appropriate metadata
- [ ] #7 Embedded metadata is extracted from video files
- [ ] #8 Video transcoding has progress reporting
- [ ] #9 Documentation covers usage and technical details
- [ ] #10 Tests cover format detection, quality calculation, and transcoding
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Phases

### Phase 1: Foundation
- Video types and device profiles
- Video probe/analysis (ffprobe)
- Compatibility checking
- Test video fixtures

### Phase 2: Transcoding
- Video transcoder (FFmpeg H.264)
- Quality preset logic with source capping
- Passthrough detection

### Phase 3: Metadata
- VideoMetadataAdapter interface
- Embedded metadata adapter
- Content type detection (movie vs TV show)

### Phase 4: Sync Integration
- Video collection adapter
- Sync engine video support
- iPod database video track handling

### Phase 5: CLI & E2E
- CLI video options
- E2E test suite
- Documentation finalization
<!-- SECTION:PLAN:END -->
