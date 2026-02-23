---
id: TASK-031
title: Implement sync selection and filtering
status: To Do
assignee: []
created_date: '2026-02-22 21:54'
updated_date: '2026-02-23 01:23'
labels:
  - feature
  - ux
milestone: 'M3: Production Ready (v1.0.0)'
dependencies: []
references:
  - docs/adr/ADR-004-collection-sources.md
  - TASK-013
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow users to configure which songs to sync rather than syncing everything.

**Filtering approaches to consider:**

| Approach | Description |
|----------|-------------|
| **Playlist-based** | Import M3U/M3U8 playlists - user creates playlist of songs to sync |
| **Path patterns** | Include/exclude directories via glob patterns |
| **Tag filters** | Filter by genre, artist, year, album, etc. |

**Recommended primary approach:** Playlist-based
- Users already know how to create playlists
- Works with any music player (Strawberry, foobar2000, VLC, etc.)
- Explicit control over exact songs to sync

**Configuration example:**
```yaml
# podkit.yaml
sync:
  # Option 1: Playlist (recommended)
  playlist: /path/to/ipod-sync.m3u

  # Option 2: Path patterns
  include:
    - /music/favorites/**
    - /music/albums/2024/**
  exclude:
    - /music/audiobooks/**

  # Option 3: Tag filters
  filter:
    genre: ["Rock", "Electronic"]
    year: { min: 2020 }
```

**Background:** This task was created during TASK-013 research. We chose music-metadata over beets, which means we don't have access to beets' custom fields (like `sync_to_ipod`). This task provides alternative filtering mechanisms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Users can specify a playlist file to control sync selection
- [ ] #2 Users can use path patterns to include/exclude directories
- [ ] #3 Users can filter by metadata tags (genre, artist, year)
- [ ] #4 Configuration documented in user guide
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred from M2 - filtering not needed for initial release
<!-- SECTION:NOTES:END -->
