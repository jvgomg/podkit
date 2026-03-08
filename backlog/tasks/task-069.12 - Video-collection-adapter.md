---
id: TASK-069.12
title: Video collection adapter
status: Done
assignee: []
created_date: '2026-03-08 16:05'
updated_date: '2026-03-08 17:31'
labels:
  - video
  - phase-4
dependencies: []
references:
  - packages/podkit-core/src/adapters/directory.ts
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a VideoDirectoryAdapter that scans directories for video files, similar to the audio DirectoryAdapter.

Separate from audio adapter due to different file types, metadata handling, and content type detection.

**Depends on:** TASK-069.09-11 (Metadata adapters)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoDirectoryAdapter class following CollectionAdapter pattern
- [x] #2 Scans for video extensions (mkv, mp4, m4v, avi, mov, webm, wmv)
- [x] #3 Returns CollectionVideo items with file info and metadata
- [x] #4 Supports recursive directory scanning
- [x] #5 Supports include/exclude patterns
- [x] #6 Progress events during scanning
- [x] #7 Uses VideoMetadataAdapter for metadata extraction
- [x] #8 Unit tests for scanning logic
- [x] #9 Integration tests with fixture directories
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete with 36 tests (19 unit + 17 integration). VideoDirectoryAdapter class, CollectionVideo interface, VideoFilter for queries, progress and warning callbacks.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented `VideoDirectoryAdapter` for scanning directories for video files, similar to the audio `DirectoryAdapter`.

## Changes

### New Files

1. **`/packages/podkit-core/src/video/directory-adapter.ts`**
   - `CollectionVideo` interface with all required fields (file info, metadata, technical info)
   - `VideoDirectoryAdapter` class following the CollectionAdapter pattern
   - `VideoFilter` interface for filtering videos by content type, genre, year, series, etc.
   - `VideoScanProgress` and `VideoScanWarning` types for callbacks
   - `VideoDirectoryAdapterConfig` for configuration
   - `createVideoDirectoryAdapter()` factory function

2. **`/packages/podkit-core/src/video/directory-adapter.test.ts`**
   - Unit tests for constructor, filtering, and callbacks (19 tests)
   - Tests for `CollectionVideo` interface representing movies and TV shows

3. **`/packages/podkit-core/src/video/directory-adapter.integration.test.ts`**
   - Integration tests using actual video fixtures (17 tests)
   - Tests for scanning, metadata extraction, technical probing
   - Tests for movie and TV show detection
   - Tests for filtering by content type, year, genre, path pattern

### Modified Files

- **`/packages/podkit-core/src/video/index.ts`** - Added exports for new module

## Key Features

- Scans for video extensions: mkv, mp4, m4v, avi, mov, webm, wmv
- Uses `EmbeddedVideoMetadataAdapter` for metadata extraction (customizable)
- Uses `probeVideo` for technical analysis (codec, resolution, duration)
- Uses `detectContentType` for movie/TV show classification
- Supports recursive directory scanning with progress events
- Supports filtering by content type, genre, year, series, season, path pattern
- Graceful error handling with warnings for problematic files

## Test Results

All 353 video module tests pass, including 36 new tests for the directory adapter.
<!-- SECTION:FINAL_SUMMARY:END -->
