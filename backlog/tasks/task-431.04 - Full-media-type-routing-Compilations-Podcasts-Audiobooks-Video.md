---
id: TASK-431.04
title: Full media-type routing (Compilations / Podcasts / Audiobooks / Video)
status: To Do
assignee: []
created_date: '2026-06-22 11:02'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `ArchivePathPlanner` beyond music to route by libgpod-node `Track.mediaType` (+ season/episode/movieFlag/tvShow): `Music/Compilations/<Album>/` (compilation flag), `Podcasts/<Show>/`, `Audiobooks/<Author?>/`, `Video/Movies/`, `Video/TV Shows/<Show>/Season NN/## Title`, `Video/Music Videos/`.

Spec: doc-047 (Stage 2 directory tree; media-type routing).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tracks route into Music/Compilations, Podcasts, Audiobooks, and Video/{Movies,TV Shows,Music Videos} by media type
- [ ] #2 Compilation albums grouped under Music/Compilations/<Album>/
- [ ] #3 TV shows nested as Video/TV Shows/<Show>/Season NN/
- [ ] #4 ArchivePathPlanner unit tests extended to cover every media-type branch
<!-- AC:END -->
