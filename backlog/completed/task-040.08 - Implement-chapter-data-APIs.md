---
id: TASK-040.08
title: Implement chapter data APIs
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-24 00:31'
labels:
  - libgpod-node
  - podcasts
  - audiobooks
dependencies: []
parent_task_id: TASK-040
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose libgpod chapter data APIs for podcasts and audiobooks:

- `itdb_chapterdata_new()` - Create chapter data
- `itdb_chapterdata_add_chapter(cd, start, title)` - Add chapter marker
- `itdb_chapterdata_free(cd)` - Free chapter data
- Associate chapter data with tracks
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Can create chapter markers for tracks
- [x] #2 Chapter data persists to iPod database
- [x] #3 Integration tests with podcast/audiobook media types
<!-- AC:END -->
