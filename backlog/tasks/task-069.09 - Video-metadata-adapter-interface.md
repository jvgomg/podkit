---
id: TASK-069.09
title: Video metadata adapter interface
status: Done
assignee: []
created_date: '2026-03-08 16:05'
updated_date: '2026-03-08 17:04'
labels:
  - video
  - phase-3
dependencies: []
references:
  - packages/podkit-core/src/adapters/interface.ts
  - docs/adr/ADR-004-collection-sources.md
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the VideoMetadataAdapter interface following the adapter pattern from ADR-004.

This interface allows for extensible metadata sources (embedded, NFO, Plex, etc.).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoMetadataAdapter interface defined
- [x] #2 VideoMetadata type with common fields (title, year, description, genre)
- [x] #3 MovieMetadata extending VideoMetadata
- [x] #4 TVShowMetadata with series, season, episode fields
- [x] #5 ContentType discriminator ('movie' | 'tvshow')
- [x] #6 canHandle(filePath) method for adapter selection
- [x] #7 getMetadata(filePath) async method
- [x] #8 Interface exported from podkit-core
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created `/packages/podkit-core/src/video/metadata.ts` with the video metadata adapter interface and types.

### Types Defined

- `ContentType` - Union type `'movie' | 'tvshow'` for content discrimination
- `VideoMetadataBase` - Base interface with common fields (title, year, description, genre, contentType)
- `MovieMetadata` - Extends base with movie-specific fields (director, studio)
- `TVShowMetadata` - Extends base with TV-specific fields (seriesTitle, seasonNumber, episodeNumber, episodeId, network)
- `VideoMetadata` - Discriminated union of MovieMetadata | TVShowMetadata
- `VideoMetadataAdapter` - Interface with name, canHandle(), getMetadata() methods

### Type Guards

- `isMovieMetadata(metadata)` - Type guard for narrowing to MovieMetadata
- `isTVShowMetadata(metadata)` - Type guard for narrowing to TVShowMetadata

### Utility Functions

- `formatEpisodeId(season, episode)` - Creates "S01E01" style IDs
- `parseEpisodeId(episodeId)` - Parses "S01E01" or "1x01" formats

### Exports

- Types exported from `video/index.ts` and main package `index.ts`
- 21 unit tests added in `metadata.test.ts`
- All 205 video module tests pass
- Build succeeds with no type errors

Implementation complete with 21 tests. Types: ContentType, VideoMetadataBase, MovieMetadata, TVShowMetadata, VideoMetadata (union), VideoMetadataAdapter interface. Utilities: isMovieMetadata(), isTVShowMetadata(), formatEpisodeId(), parseEpisodeId().
<!-- SECTION:NOTES:END -->
