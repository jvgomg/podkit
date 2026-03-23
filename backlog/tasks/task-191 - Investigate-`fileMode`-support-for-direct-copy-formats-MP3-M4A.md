---
id: TASK-191
title: 'Investigate `fileMode` support for direct-copy formats (MP3, M4A)'
status: To Do
assignee: []
created_date: '2026-03-23 11:46'
labels:
  - investigation
  - config
  - transcoding
dependencies:
  - TASK-189
references:
  - packages/podkit-core/src/sync/music-planner.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently `fileMode` only affects transcoded files. Direct-copy formats (MP3, lossy M4A/AAC) are copied byte-for-byte to the device with all embedded data intact. Should `fileMode: 'optimized'` strip artwork from these files too?

**Questions to resolve:**
1. How much space does embedded artwork typically consume in MP3/M4A files? Is the savings meaningful on capacity-constrained devices?
2. Would users expect `fileMode` to apply uniformly to all files, or is it reasonable that it only affects transcoded/processed files?
3. For MP3 files, stripping artwork would require running them through FFmpeg (`-c:a copy -vn`), adding processing time to what's currently a fast copy. Is the tradeoff worthwhile?
4. Are there edge cases where stripping embedded data from MP3/M4A could cause issues (e.g., ReplayGain tags stored in non-standard ways)?
5. Should this be the same `fileMode` setting, or a separate config option (e.g., `stripArtwork` that applies to all files)?

**Context:** iPods read artwork from their internal database, not from embedded file metadata, so embedded artwork in any format is dead weight on the device. However, users who use their iPod as a portable drive or who value file portability may want to keep it.

**Decision:** This is an investigation/design task. Output should be a recommendation on whether to implement, and if so, the preferred approach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision documented on whether to support fileMode for direct-copy formats
- [ ] #2 If yes: design approach documented covering MP3 and lossy M4A handling
- [ ] #3 If yes: space savings estimated for typical collections
- [ ] #4 Edge cases identified (ReplayGain, non-standard tags, etc.)
<!-- AC:END -->
