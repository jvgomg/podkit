---
id: TASK-431.07
title: Playlists (PlaylistWriter → m3u8 + smart rules in catalogue)
status: To Do
assignee: []
created_date: '2026-06-22 11:02'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.03
  - TASK-431.06
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `PlaylistWriter`: emit `Playlists/<name>.m3u8` with relative paths into the archive tree, skipping the master/library playlist. Smart playlists are emitted as their resolved track list in M3U, with the rules preserved in `library.sqlite` (the `smart_playlist_rules` table from the catalogue slice).

Spec: doc-047 (Stage 2 — playlists; PlaylistWriter).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each non-master playlist emitted as Playlists/<name>.m3u8 with relative paths resolving into the tree
- [ ] #2 Master/library playlist is skipped
- [ ] #3 Smart playlists emit resolved track list as M3U; rules persisted in library.sqlite
- [ ] #4 PlaylistWriter tested for m3u8 content and master-skip behaviour
<!-- AC:END -->
