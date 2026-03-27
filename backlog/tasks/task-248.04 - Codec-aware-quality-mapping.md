---
id: TASK-248.04
title: Codec-aware quality mapping
status: To Do
assignee: []
created_date: '2026-03-27 10:41'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.01
documentation:
  - doc-024
parent_task_id: TASK-248
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement per-codec bitrate tables so quality presets deliver perceptually equivalent quality regardless of codec.

See PRD: doc-024, section "Codec-aware quality mapping."

Each lossy codec gets its own preset-to-bitrate table: AAC (high=256, medium=192, low=128), Opus (high=160, medium=128, low=96), MP3 (high=256, medium=192, low=128). Also specifies VBR quality parameters per codec (e.g., MP3 libmp3lame `-q:a` scale). Lossless codecs (FLAC ~700 kbps, ALAC ~900 kbps) have no quality presets — size estimation uses codec-specific averages. `customBitrate` bypasses the mapping entirely. `encoding` (vbr/cbr) is applied uniformly at the config level.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Per-codec bitrate tables exist for AAC, Opus, and MP3 with correct values at each preset tier
- [ ] #2 Lossless codecs return no bitrate preset, with size estimation using ~700 kbps for FLAC and ~900 kbps for ALAC
- [ ] #3 `customBitrate` overrides the preset mapping for all codecs
- [ ] #4 VBR quality parameters are specified per codec (not just target bitrates)
- [ ] #5 Unit tests verify correct mapping for each preset × codec combination
<!-- AC:END -->
