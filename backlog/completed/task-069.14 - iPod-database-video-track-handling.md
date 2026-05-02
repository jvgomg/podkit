---
id: TASK-069.14
title: iPod database video track handling
status: Done
assignee: []
created_date: '2026-03-08 16:05'
updated_date: '2026-03-08 17:31'
labels:
  - video
  - phase-4
dependencies: []
references:
  - packages/podkit-core/src/ipod/constants.ts
  - packages/libgpod-node/
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure iPod database layer correctly handles video tracks with appropriate MediaType flags and video-specific metadata.

Research libgpod's video support and implement accordingly.

**Depends on:** TASK-069.13 (Sync engine)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Research: Document how libgpod handles video tracks
- [x] #2 MediaType.Movie constant added (or document existing approach)
- [x] #3 addTrack supports video-specific fields
- [x] #4 Video tracks appear in Videos menu on iPod
- [x] #5 TV shows categorized correctly with series/season/episode
- [x] #6 Movies categorized correctly
- [x] #7 Poster artwork supported for video tracks
- [x] #8 Integration tests verify video tracks added to iPod database
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### libgpod Video Fields
Researched libgpod's Itdb_Track struct and found these video-specific fields:
- `tvshow` (gchar*) - TV show name
- `tvepisode` (gchar*) - Episode name/title string
- `sort_tvshow` (gchar*) - Sorting name for TV show
- `season_nr` (guint32) - Season number
- `episode_nr` (guint32) - Episode number  
- `movie_flag` (guint8) - Whether track is a movie

Note: libgpod does NOT have video_width/video_height fields - these are determined by the device profile during transcoding.

### Changes Made
1. **libgpod-node/src/types.ts**: Added video fields to TrackInput and Track interfaces
2. **native/gpod_converters.cc**: Added reading video fields from Itdb_Track
3. **native/track_operations.cc**: Added setting video fields in AddTrack and UpdateTrack
4. **podkit-core/src/ipod/types.ts**: Added video fields to TrackInput, TrackFields, and IPodTrack
5. **podkit-core/src/ipod/constants.ts**: Added MediaType.Movie (0x0002)
6. **podkit-core/src/ipod/track.ts**: Added video field properties to IpodTrackImpl
7. **podkit-core/src/ipod/video.ts**: Created utility functions for creating video track inputs
8. **podkit-core/src/ipod/index.ts**: Exported new video utilities

### Test Coverage
- Added video-tracks.integration.test.ts with tests for movies and TV shows
- Added video.test.ts for unit tests of utility functions
- Updated constants.test.ts to include MediaType.Movie

Implementation complete with 34 tests (10 integration + 24 unit). Updated libgpod-node native bindings for video fields (tvShow, seasonNumber, episodeNumber, movieFlag). Added video utilities: createMovieTrackInput, createTVShowTrackInput, createVideoTrackInput.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## iPod Database Video Track Handling\n\n### What was implemented\n\nAdded complete support for video tracks (movies and TV shows) in the iPod database layer:\n\n**Native Bindings (libgpod-node)**\n- TrackInput/Track types now include: tvShow, tvEpisode, sortTvShow, seasonNumber, episodeNumber, movieFlag\n- Native C++ code reads/writes these fields to libgpod's Itdb_Track\n\n**Core Library (podkit-core)**\n- TrackInput, TrackFields, and IPodTrack interfaces include video fields\n- Added MediaType.Movie constant (0x0002)\n- Created video.ts with utility functions:\n  - `createMovieTrackInput()` - Creates TrackInput for movie files\n  - `createTVShowTrackInput()` - Creates TrackInput for TV episodes\n  - `createVideoTrackInput()` - Auto-selects based on content type\n  - `isVideoMediaType()` - Check if media type is video\n  - `getVideoTypeName()` - Get human-readable type name\n\n**Testing**\n- 10 new integration tests for video tracks in libgpod-node\n- 24 new unit tests for video utilities\n- All 267 libgpod-node tests pass\n- All 147 podkit-core ipod tests pass\n\n### Technical Notes\n\nlibgpod stores video metadata using:\n- `tvshow` - Series name for TV shows\n- `tvepisode` - Episode title (string, not number)\n- `season_nr` / `episode_nr` - Numeric identifiers\n- `movie_flag` - 0x01 for movies, 0x00 for TV shows\n- `mediatype` - Uses MediaType.Movie (0x02) or MediaType.TVShow (0x40)\n\nNote: Video dimensions are NOT stored in the iPod database - they are determined by device capabilities during transcoding.
<!-- SECTION:FINAL_SUMMARY:END -->
