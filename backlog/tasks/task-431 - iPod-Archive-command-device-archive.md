---
id: TASK-431
title: iPod Archive command (device archive)
status: Done
assignee: []
created_date: '2026-06-22 11:01'
updated_date: '2026-06-22 17:42'
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
- [x] #1 `podkit device archive` produces a raw dump + podkit archive end-to-end against a real/dummy iPod
- [x] #2 All 9 subtasks are Done
- [x] #3 Feature behaviour matches doc-047; no scope handled outside the PRD
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the `podkit device archive` feature end-to-end as a new leaf package `@podkit/ipod-archive` + a thin CLI subcommand. All 9 subtasks Done.

Two-stage design: `runDump` (lossless read-only raw dump of the iPod whitelist, streamed sha256 → manifest.sha256, junk/foreign skipped+reported) → `runTransform` (pure function of the dump; never touches a device) producing a browsable `archive/`: media-type-routed Music/Compilations/Podcasts/Audiobooks/Video trees, lossless audio copies with restamped tags + embedded PNG artwork (+cover.png per album), `library.sqlite` catalogue (bun:sqlite; tracks/playlists/playlist_items/albums/artwork/smart_playlist_rules/device/schema_version; bigint-as-TEXT; preserves play counts/ratings/timestamps verbatim; no blobs), m3u8 playlists (master skipped), README.md identity+stats card, and a both-stage report.{md,json}. `runArchive` composes both into one self-contained `<deviceName>-<serial>-<timestamp>/` (raw dump/ + archive/). CLI: bare → both stages, `--dump-only` → stage 1, `--from-dump <path>` → stage 2 (device-free).

Read path is libgpod-node only; the ArtworkDB/.ithmb decode was ported in-package (no ipod-db dep) and cross-validated byte-for-byte against ipod-db's reference reader on a real 2,663-track iPod (2,417 artwork tracks, zero disagreements). Branch A (Bun-only CLI) → bun:sqlite. Changeset added (podkit minor).

Quality: build + typecheck + lint clean; @podkit/ipod-archive 161 unit + 47 integration; podkit 1734 unit; binary e2e smoke 2/2. Not committed (left in working tree for the user).
<!-- SECTION:FINAL_SUMMARY:END -->
