---
id: TASK-248.06
title: 'FFmpeg argument builders for Opus, MP3, and FLAC'
status: Done
assignee: []
created_date: '2026-03-27 10:42'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.01
  - TASK-248.04
  - TASK-248.05
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add codec-specific FFmpeg argument builders and generalize existing builders for multi-codec dispatch.

See PRD: doc-024, sections "FFmpeg argument builder generalization" and "Codec-aware quality mapping" (VBR/CBR flags).

**New argument builders:**
- Opus: `-c:a libopus -vbr on/off -b:a {bitrate} -ar 48000 -f ogg`
- MP3: `-c:a libmp3lame -q:a {quality}` (VBR) or `-b:a {bitrate}` (CBR), `-f mp3`
- FLAC: `-c:a flac -f flac` (lossless, no quality parameter)

**Generalize existing builders:**
- `buildTranscodeArgs` and `buildVbrArgs` dispatch to codec-specific builders
- `buildOptimizedCopyArgs` dispatches container format per codec: `ogg` for Opus, `flac` for FLAC, `ipod` for AAC/ALAC, `mp3` for MP3
- `OptimizedCopyFormat` type widened to include `'opus'`, `'flac'`
- Sample rate from codec metadata table, not hardcoded `-ar 44100`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opus argument builder produces correct VBR (`-vbr on -b:a`) and CBR (`-vbr off -b:a`) args with 48kHz sample rate and `-f ogg`
- [x] #2 MP3 argument builder produces correct VBR (`-q:a` 0-9 scale) and CBR (`-b:a`) args with `-f mp3`
- [x] #3 FLAC argument builder produces `-c:a flac -f flac` with no quality parameter
- [x] #4 `buildTranscodeArgs` dispatches to correct codec-specific builder based on target codec
- [x] #5 `buildOptimizedCopyArgs` uses correct `-f` flag per codec (ogg/flac/ipod/mp3)
- [x] #6 `OptimizedCopyFormat` type includes `'opus'` and `'flac'`
- [x] #7 Sample rate comes from codec metadata table, not hardcoded
- [x] #8 Existing AAC/ALAC argument construction unchanged
- [x] #9 Unit tests verify correct argument construction for each codec × VBR/CBR combination
<!-- AC:END -->
