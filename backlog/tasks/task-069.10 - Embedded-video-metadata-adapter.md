---
id: TASK-069.10
title: Embedded video metadata adapter
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
Implement VideoMetadataAdapter that extracts metadata from video file tags using ffprobe.

This is the primary/default adapter for v1.

**Depends on:** TASK-069.09 (Adapter interface), TASK-069.04 (Probe)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 EmbeddedVideoMetadataAdapter implements VideoMetadataAdapter
- [x] #2 Extracts title from metadata tags
- [x] #3 Extracts year/date
- [x] #4 Extracts description/comment
- [x] #5 Extracts genre
- [x] #6 Detects embedded poster/thumbnail
- [x] #7 Falls back to filename parsing when tags missing
- [x] #8 Integration tests with fixture files containing metadata
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete with 51 unit tests + 6 integration tests. EmbeddedVideoMetadataAdapter class, ffprobe metadata extraction, filename fallback parsing, VideoMetadataError class.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented `EmbeddedVideoMetadataAdapter` that extracts video metadata from embedded file tags using ffprobe.

## Changes

### New Files
- `packages/podkit-core/src/video/metadata-embedded.ts` - Main adapter implementation
- `packages/podkit-core/src/video/metadata-embedded.test.ts` - Unit tests with mocked spawn
- `packages/podkit-core/src/video/metadata-embedded.integration.test.ts` - Integration tests with fixture files

### Modified Files
- `packages/podkit-core/src/video/index.ts` - Added exports for the new adapter

## Implementation Details

### EmbeddedVideoMetadataAdapter
- Implements `VideoMetadataAdapter` interface with `name = 'embedded'`
- `canHandle()` returns true for video extensions: `.mp4`, `.m4v`, `.mkv`, `.avi`, `.mov`, `.webm`
- `getMetadata()` uses ffprobe `-show_format` to extract format tags

### FFprobe Metadata Extraction
- Extracts: title, date/year, description/comment/synopsis, genre
- For movies: director (from artist), studio (from album_artist)  
- For TV shows: show, season_number, episode_sort, episode_id, network
- Detects content type based on presence of TV-specific tags (show, season_number, episode_sort, episode_id)

### Filename Fallback Parsing
- `parseFilename()` function handles various naming patterns when embedded tags are missing:
  - Title extraction from filename without extension
  - Year parsing: `(2024)`, `[2024]`, `.2024`
  - TV show patterns: `S01E01`, `s01e01`, `1x01`
  - Dot-separated filenames cleaned to spaces

### Configuration
```typescript
interface EmbeddedVideoMetadataConfig {
  ffprobePath?: string;  // Custom ffprobe binary path
  _spawnFn?: SpawnFn;    // For testing with mock spawn
}
```

## Test Results
- 317 tests pass across 9 video module files
- 57 new tests added (51 unit tests + 6 integration tests)
- Integration tests verify real metadata extraction from fixture files:
  - `movie-with-metadata.mp4` - Full movie metadata
  - `tvshow-episode.mp4` - Full TV show metadata
  - `compatible-h264.mp4` - Basic title extraction
<!-- SECTION:FINAL_SUMMARY:END -->
