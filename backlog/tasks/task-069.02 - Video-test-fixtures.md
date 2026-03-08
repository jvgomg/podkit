---
id: TASK-069.02
title: Video test fixtures
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
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
- [ ] #1 FFmpeg script to generate test videos (1-2 seconds each)
- [ ] #2 H.264 MP4 fixture at 640x480 (iPod Classic compatible)
- [ ] #3 H.264 MKV fixture at 1920x1080 (needs transcoding)
- [ ] #4 VP9 WebM fixture (incompatible codec)
- [ ] #5 Fixture with embedded title/year metadata
- [ ] #6 Fixture with TV show metadata (series, season, episode)
- [ ] #7 README documenting fixtures and regeneration
- [ ] #8 Fixtures small enough for repo (<1MB each)
<!-- AC:END -->
