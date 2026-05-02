---
id: TASK-069.11
title: Content type detection (movie vs TV show)
status: Done
assignee: []
created_date: '2026-03-08 16:05'
updated_date: '2026-03-08 17:04'
labels:
  - video
  - phase-3
dependencies: []
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement logic to distinguish movies from TV shows based on:
1. Embedded metadata tags (if present)
2. Folder structure patterns
3. Filename patterns

**Depends on:** TASK-069.10 (Embedded adapter)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 detectContentType(filePath, metadata?) returns 'movie' | 'tvshow'
- [x] #2 Detects TV patterns: S01E01, 1x01, 'Season X'
- [x] #3 Detects TV folder patterns: /TV Shows/, /Series/
- [x] #4 Extracts series name, season, episode from patterns
- [x] #5 Falls back to 'movie' when no TV patterns match
- [x] #6 Confidence score or explicit override option
- [x] #7 Unit tests for various naming conventions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete with 60 tests. detectContentType() function with pattern matching for S01E01, 1x01, Season X folders. ContentTypeResult with confidence levels (high/medium/low). Series title extraction with cleanup.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented content type detection for video files to distinguish movies from TV shows based on metadata, folder structure, and filename patterns.

## Changes

### New Files

**`/packages/podkit-core/src/video/content-type.ts`**
- Main detection function `detectContentType(filePath, metadata?)` returning `ContentTypeResult`
- Detects TV show episode patterns: `S01E01`, `s01e01`, `s01.e01`, `1x01`, `Season 1 Episode 1`
- Detects TV folder patterns: `/TV Shows/`, `/Series/`, `/Television/`, `/TV/`
- Detects Season folder patterns: `Season 1/`, `S01/`
- Extracts series title from folder structure (parent of Season folder) or filename (text before episode pattern)
- Cleans up series titles by removing quality indicators (720p, 1080p), codecs (x264, x265), release groups
- Implements confidence levels:
  - `high`: Episode pattern + TV/Season folder, OR metadata override
  - `medium`: Episode pattern OR TV/Season folder alone
  - `low`: Fallback to movie (no TV indicators)
- Respects metadata override: if metadata has `contentType`, uses it with high confidence

**`/packages/podkit-core/src/video/content-type.test.ts`**
- 60 test cases covering:
  - All episode pattern formats (S01E01, s01e01, s01.e01, 1x01, Season X Episode Y)
  - Folder structure detection
  - Series title extraction and cleanup
  - Confidence level assignment
  - Metadata override behavior
  - Fallback to movie
  - Real-world examples (scene releases, Netflix naming, Plex naming, anime)
  - Edge cases (Windows paths, triple-digit episodes, empty filenames)

### Modified Files

**`/packages/podkit-core/src/video/index.ts`**
- Added exports for `ContentTypeConfidence`, `ContentTypeResult` types
- Added export for `detectContentType` function

## Testing

All 265 video module tests pass, including 60 new content-type tests.
<!-- SECTION:FINAL_SUMMARY:END -->
