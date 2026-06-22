---
id: TASK-431.05
title: Artwork — in-package ArtworkDecoder + embed + cover.png
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
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the in-package `ArtworkDecoder` (port, don't import, ipod-db's artwork logic): parse the dumped `ArtworkDB`, match the largest thumbnail to a track by `dbid`, read bytes from the matching `F*.ithmb`, and decode the stored pixel format (RGB565 / RGB555 / RGB888) to RGBA, cropping padding. Add `RgbaToPng` (pngjs). Embed the PNG into each track's tags (via node-taglib-sharp) and also write `cover.png` into each album folder. Tracks with no artwork are skipped (no placeholder).

Spec: doc-047 (Reading the dump — artwork carve-out; ArtworkDecoder; RgbaToPng).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ArtworkDecoder decodes the largest thumbnail to RGBA from the dumped ArtworkDB + .ithmb, matched by dbid
- [ ] #2 Decoded artwork is PNG-encoded, embedded in track tags, and written as cover.png per album folder
- [ ] #3 Tracks without artwork are skipped with no placeholder
- [ ] #4 ArtworkDecoder integration-tested against fixture ArtworkDB/.ithmb across ≥2 pixel formats; RgbaToPng unit-tested
<!-- AC:END -->
