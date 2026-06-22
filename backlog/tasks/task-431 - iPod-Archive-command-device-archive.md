---
id: TASK-431
title: iPod Archive command (device archive)
status: To Do
assignee: []
created_date: '2026-06-22 11:01'
labels:
  - feature
  - ipod
  - archive
  - cli
dependencies: []
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella task for the `podkit device archive` feature: a non-interactive, iPod-only command that archives a connected iPod in two stages — a near-byte-for-byte **raw dump** (lossless, checksummed, read-only) followed by a **podkit archive** transform (browsable renamed audio tree with embedded artwork, SQLite catalogue, M3U playlists, README + machine-readable report). Stage 2 is a pure function of the dump (`--from-dump`), and a dump-only run is supported (`--dump-only`).

New standalone leaf package `@podkit/ipod-archive` (depends on `@podkit/libgpod-node`, `@podkit/ipod-firmware`, `@podkit/device-types`; NOT core, NOT ipod-db). The CLI command in podkit-cli is a thin shell over the package.

Full spec, decisions, module breakdown, and testing plan: **doc-047 — PRD: iPod Archive Command (device archive)** (`backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md`).

Subtasks are tracer-bullet vertical slices; see each for scope and dependencies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `podkit device archive` produces a raw dump + podkit archive end-to-end against a real/dummy iPod
- [ ] #2 All 9 subtasks are Done
- [ ] #3 Feature behaviour matches doc-047; no scope handled outside the PRD
<!-- AC:END -->
