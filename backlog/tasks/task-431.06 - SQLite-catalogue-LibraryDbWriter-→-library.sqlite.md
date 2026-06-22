---
id: TASK-431.06
title: SQLite catalogue (LibraryDbWriter → library.sqlite)
status: To Do
assignee: []
created_date: '2026-06-22 11:02'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.02
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `LibraryDbWriter` to build `library.sqlite` — the parsed, queryable view (no raw blobs; raw iTunesDB in the dump stays the source of truth). Tables: `device` (model/serial/capacity/generation/dump_date/podkit_version), `tracks` (all DB fields + `exported_path` + `dump_path`), `playlists`, `playlist_items` (ordered, per-item timestamp), `albums`, `artwork` (track→image, width/height/format), `smart_playlist_rules`, `schema_version`. Preserve play counts, ratings, last-played, skip counts, date-added exactly as on device.

Use the driver chosen by the SQLite spike (task-431.02).

Spec: doc-047 (library.sqlite schema; SPIKE outcome).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 library.sqlite written with the documented tables and schema_version
- [ ] #2 Each track row maps to its exported_path and dump_path
- [ ] #3 Play counts, ratings, last-played, skip counts, date-added preserved as stored on device
- [ ] #4 Smart-playlist rules persisted
- [ ] #5 Uses the spike-chosen driver and works under both CLI runtimes (or the spike-decided single runtime)
- [ ] #6 LibraryDbWriter tested by opening the produced DB and asserting device row, track fields, playlist ordering, smart rules
<!-- AC:END -->
