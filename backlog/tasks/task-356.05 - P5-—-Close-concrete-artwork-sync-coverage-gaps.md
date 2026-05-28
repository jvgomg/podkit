---
id: TASK-356.05
title: P5 — Close concrete artwork/sync coverage gaps
status: To Do
assignee: []
created_date: '2026-05-28 08:00'
labels:
  - testing
  - e2e
  - matrix
  - artwork
  - coverage
dependencies:
  - TASK-356.02
  - TASK-356.04
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
parent_task_id: TASK-356
priority: low
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-039 §"Concrete test gaps to close". Real missing cells that become expressible once the axes from P2 (transcode-vs-copy) and P4 (device, transfer mode) exist.

## Gaps

1. **Transfer mode × artwork** — `optimized` strips embedded art on database-artwork devices; `portable` preserves it. Currently absent from the artwork matrix.
2. **artwork-removed transition** — the change matrix covers added/updated but never the source-loses-art case.
3. **Artwork resize** — embedded-art devices resize; iPod has `artworkMaxResolution`. Not asserted anywhere.
4. **Compilation / album-artist × album-cache** — the album cache keys on `(artist, album)`; various-artist compilations risk collision or split. Directly relevant to the TASK-355.03 cache rework. Needs a compilation fixture (album where tracks have differing artists but a shared albumArtist / compilation flag).

Each gap is a small set of new cells on the existing harness, not new machinery. Depends on P2 (transcode-vs-copy axis) and P4 (device + transfer axes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 transfer-mode × artwork cells assert optimized strips / portable preserves embedded art on DB-artwork devices
- [ ] #2 artwork-removed transition covered in the change matrix
- [ ] #3 artwork resize asserted against device artworkMaxResolution
- [ ] #4 compilation / various-artist fixture added; album-cache behaviour asserted for shared-album differing-artist tracks
- [ ] #5 All new cells green
<!-- AC:END -->
