---
id: TASK-198
title: FFmpeg optimized-copy args and portable-mode artwork preservation
status: Done
assignee: []
created_date: '2026-03-23 14:08'
updated_date: '2026-03-23 15:13'
labels:
  - feature
  - core
  - transcoding
milestone: 'Transfer Mode: iPod Support'
dependencies:
  - TASK-195
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/transcode/types.ts
documentation:
  - backlog/docs/doc-012 - Spec--Transfer-Mode-Behavior-Matrix.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the FFmpeg argument building for the new optimized-copy path (audio stream copy with artwork stripping) and ensure all three transfer modes produce correct args for all file type paths.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-012 (Transfer Mode Behavior Matrix) — contains exact FFmpeg args for every path

**New: optimized-copy args**
Build FFmpeg arguments for stream-copy operations that strip artwork without re-encoding audio:

- ALAC→ALAC: `-i <input> -c:a copy -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>`
- MP3→MP3: `-i <input> -c:a copy -map_metadata 0 -vn -y -progress pipe:1 <output>` (no `-f ipod`)
- M4A/AAC→M4A/AAC: `-i <input> -c:a copy -map_metadata 0 -vn -f ipod -y -progress pipe:1 <output>`

This could be a new `buildOptimizedCopyArgs(input, output, format)` function or integrated into existing builders.

**Updated: transcode args for three modes**
- `fast` + `optimized`: `-vn` (strip artwork) — same as current `optimized` behavior
- `portable`: `-c:v copy -disposition:v attached_pic` (preserve artwork)

This applies to both `buildTranscodeArgs()` (AAC output) and `buildAlacArgs()` (ALAC output). The existing two-mode logic extends to three modes where `fast` behaves like `optimized` for transcodes.

**Note:** The executor wiring (actually calling these functions for optimized-copy operations) is handled in TASK-199.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Optimized-copy FFmpeg args generated for ALAC→ALAC with -c:a copy -vn (no audio re-encode, strip artwork)
- [x] #2 Optimized-copy FFmpeg args generated for MP3→MP3 with -c:a copy -vn (no -f ipod for MP3)
- [x] #3 Optimized-copy FFmpeg args generated for M4A/AAC→M4A/AAC with -c:a copy -vn -f ipod
- [x] #4 Transcode args for fast mode use -vn (strip artwork) for both AAC and ALAC output
- [x] #5 Transcode args for optimized mode use -vn (strip artwork) for both AAC and ALAC output
- [x] #6 Transcode args for portable mode use -c:v copy -disposition:v attached_pic for both AAC and ALAC output
- [x] #7 Parameterized tests cover all 3 transfer modes × all file type paths per DOC-012 behavior matrix
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
buildTranscodeArgs/buildAlacArgs updated from `fileMode?: FileMode` to `transferMode?: TransferMode`. New `buildOptimizedCopyArgs(input, output, format)` function added with `OptimizedCopyFormat` type. MP3 format correctly omits `-f ipod`. Default changed from 'optimized' to 'fast' (same -vn behavior). 86 tests pass.
<!-- SECTION:NOTES:END -->
