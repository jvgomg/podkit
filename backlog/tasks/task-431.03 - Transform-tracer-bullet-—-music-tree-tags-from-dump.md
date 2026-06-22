---
id: TASK-431.03
title: Transform tracer bullet — music tree + tags (--from-dump)
status: To Do
assignee: []
created_date: '2026-06-22 11:02'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.01
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second vertical slice — the stage-2 tracer bullet. Add `--from-dump <path>` and the `runTransform` orchestrator (pure function of the dump; never touches the live device). Implement `DumpLoader` (open dump via libgpod-node `Database.open(dumpDir)` + identity via ipod-firmware SysInfoExtended for serial, libgpod-node for model/generation/capacity, degrading when absent), `ArchivePathPlanner` for the **music case only** (`Music/<AlbumArtist>/<Album>/## Title.ext`, sanitisation, length caps, collision→append-dbid, Unknown fallbacks, null-ipodPath → no-audio), and `TagWriter` (copy audio losslessly, write text tags in place via node-taglib-sharp — no artwork yet).

Demoable: a dump → browsable `Music/` tree of tagged, lossless audio files. Can run off a fixture dump (soft-depends on the raw-dump slice for real e2e).

Spec: doc-047 (Stage 2; Reading the dump; ArchivePathPlanner; TagWriter).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `podkit device archive --from-dump <path>` produces a Music/<AlbumArtist>/<Album>/## Title.ext tree from a dump without touching a device
- [ ] #2 Audio files are byte-lossless copies with text tags written from the DB (no re-encode)
- [ ] #3 DumpLoader opens via libgpod-node and surfaces identity, degrading when serial/SysInfoExtended absent
- [ ] #4 ArchivePathPlanner handles sanitisation, length caps, collision→append-dbid, Unknown Artist/Album, null ipodPath→no-audio
- [ ] #5 ArchivePathPlanner unit-tested (music cases); DumpLoader + TagWriter integration-tested against a fixture dump
<!-- AC:END -->
