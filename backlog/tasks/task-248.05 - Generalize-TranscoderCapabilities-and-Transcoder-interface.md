---
id: TASK-248.05
title: Generalize TranscoderCapabilities and Transcoder interface
status: To Do
assignee: []
created_date: '2026-03-27 10:42'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.01
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend encoder detection beyond AAC and generalize the Transcoder interface for multi-codec support.

See PRD: doc-024, sections "TranscoderCapabilities generalization" and "Transcoder interface update."

**TranscoderCapabilities:** Extend to track encoder availability per codec (not just AAC). Extend `FFmpegTranscoder.detect()` to scan for Opus (libopus), MP3 (libmp3lame), and FLAC (flac) encoders alongside existing AAC encoder detection.

**Transcoder interface:** Rename `AacTranscodeConfig` to a codec-generic type (e.g., `EncoderConfig`) — note: `TranscodeConfig` is already taken by the user-facing config interface, so a different name must be used to avoid collision. Update `Transcoder` interface to accept the generic config type.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `TranscoderCapabilities` tracks encoder availability per codec (AAC, Opus, MP3, FLAC)
- [ ] #2 `FFmpegTranscoder.detect()` scans for libopus, libmp3lame, and flac encoders
- [ ] #3 `AacTranscodeConfig` renamed to codec-generic type (not `TranscodeConfig` — that name is taken)
- [ ] #4 `Transcoder` interface updated to accept the generic config type
- [ ] #5 Existing AAC encoder detection and priority logic preserved
- [ ] #6 Unit tests verify detection of each encoder type
<!-- AC:END -->
