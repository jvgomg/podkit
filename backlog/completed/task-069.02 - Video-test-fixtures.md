---
id: TASK-069.02
title: Video test fixtures
status: Done
assignee: []
created_date: '2026-03-08 16:04'
updated_date: '2026-03-08 16:39'
labels:
  - video
  - phase-1
  - testing
dependencies: []
documentation:
  - test/fixtures/audio/README.md
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create or source video test fixtures for unit and integration tests.

Similar to audio fixtures in test/fixtures/audio/, we need short video clips in various formats with embedded metadata for testing.

Fixtures needed:
- H.264 MP4 (iPod-compatible, should passthrough)
- H.264 MKV (needs remux/transcode)
- Various resolutions (240p, 480p, 720p, 1080p)
- With and without embedded metadata
- Movie-style and TV-show-style naming/metadata
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FFmpeg script to generate test videos (1-2 seconds each)
- [x] #2 H.264 MP4 fixture at 640x480 (iPod Classic compatible)
- [x] #3 H.264 MKV fixture at 1920x1080 (needs transcoding)
- [x] #4 VP9 WebM fixture (incompatible codec)
- [x] #5 Fixture with embedded title/year metadata
- [x] #6 Fixture with TV show metadata (series, season, episode)
- [x] #7 README documenting fixtures and regeneration
- [x] #8 Fixtures small enough for repo (<1MB each)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Created video test fixtures directory at `test/fixtures/video/` with 6 synthetic video files for testing podkit's video sync pipeline.

## Files Created

| File | Size | Purpose |
|------|------|---------|
| `generate.sh` | 5.4K | FFmpeg script to regenerate all fixtures |
| `compatible-h264.mp4` | 61K | iPod-compatible: 640x480, H.264 Main L3.1, AAC |
| `low-quality.mp4` | 53K | Low quality: 320x240, H.264 Baseline, AAC |
| `high-res-h264.mkv` | 565K | Needs transcoding: 1920x1080, H.264 High L4.1, MKV |
| `incompatible-vp9.webm` | 96K | Unsupported codec: VP9/Opus |
| `movie-with-metadata.mp4` | 39K | Movie metadata: title, year, description, synopsis |
| `tvshow-episode.mp4` | 36K | TV show metadata: show, season_number, episode_id |
| `README.md` | 4.5K | Complete documentation |

**Total size: 880K** (well under the 1MB per file limit)

## Test Coverage

- **Passthrough tests**: `compatible-h264.mp4`, `low-quality.mp4` - should copy without transcoding
- **Transcode tests**: `high-res-h264.mkv` - needs resolution downscale and container remux
- **Unsupported codec tests**: `incompatible-vp9.webm` - VP9 requires full transcode
- **Metadata parsing tests**: `movie-with-metadata.mp4`, `tvshow-episode.mp4` - validate metadata extraction

## Technical Details

All videos are 2 seconds long with:
- Synthetic test patterns (testsrc, smptebars, pal75bars)
- Pure sine wave audio at different frequencies for easy identification
- Proper iPod Classic compatible profiles where applicable (H.264 Main, Level 3.1, AAC-LC)
<!-- SECTION:FINAL_SUMMARY:END -->
