---
id: TASK-190
title: Support `fileMode` for ALAC copy operations
status: To Do
assignee: []
created_date: '2026-03-23 11:46'
labels:
  - feature
  - transcoding
  - config
dependencies:
  - TASK-189
references:
  - packages/podkit-core/src/sync/music-planner.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/sync/music-executor.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ALAC source files copied to ALAC-capable devices currently bypass FFmpeg entirely (direct byte-for-byte copy), so `fileMode` has no effect. Users should be able to control whether embedded artwork and other extra data is preserved or stripped from ALAC files, just like they can for AAC transcodes.

**Context:** When a user has `fileMode: 'optimized'` and syncs ALAC sources to an ALAC-capable device, the files are copied as-is with all embedded data intact. The `fileMode` setting is silently ignored because the planner routes ALAC→ALAC through `createCopyOperation` rather than through FFmpeg.

**Proposed approach:** Route ALAC→ALAC through FFmpeg when `fileMode` matters, using `-c:a copy` (audio stream copy, no re-encoding) combined with either `-vn` (optimized) or `-c:v copy -disposition:v attached_pic` (portable). This preserves audio quality while giving FFmpeg control over artwork/video streams. The planner would need to create a transcode-like operation instead of a copy operation for ALAC→ALAC when fileMode is relevant.

**Key files:**
- `packages/podkit-core/src/sync/music-planner.ts` — `planAddOperations` and `planUpdateOperations` ALAC copy logic
- `packages/podkit-core/src/transcode/ffmpeg.ts` — would need an ALAC passthrough mode
- `packages/podkit-core/src/sync/music-executor.ts` — executor routing
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ALAC→ALAC operations respect `fileMode` setting (strip or preserve artwork)
- [ ] #2 Audio data is not re-encoded (stream copy only)
- [ ] #3 `--force-transcode` re-processes ALAC→ALAC files when fileMode has changed
- [ ] #4 Sync tags record the fileMode used for ALAC copy operations
- [ ] #5 Tests cover both fileMode values for ALAC→ALAC path
<!-- AC:END -->
