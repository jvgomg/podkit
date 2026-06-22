---
id: TASK-431.08
title: README + report (ArchiveReport across both stages)
status: To Do
assignee: []
created_date: '2026-06-22 11:03'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.01
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `ArchiveReport`, an accumulator spanning both stages, and the README generator. Emit `report.md` + `report.json` listing: foreign files skipped, junk skipped (stage 1), and tracks with no audio, tracks with no artwork, and any copy/transform failures (stage 2). Generate `README.md` at the archive root with model, serial, generation, capacity, dump date, podkit version, and library stats (track/size/play-time totals, distinct artists/albums, date-added range, top artists). Non-interactive run → these files are the user's paper trail.

Spec: doc-047 (Stage 2 — report; README content; user stories 26-27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 report.md + report.json enumerate foreign-skipped, junk-skipped, no-audio, no-artwork, and failure buckets
- [ ] #2 README.md at archive root contains device identity, dump date, podkit version, and library stats
- [ ] #3 Report aggregates events from both the dump and transform stages
- [ ] #4 ArchiveReport tested for the markdown + JSON bucket contents
<!-- AC:END -->
