---
id: TASK-358.01
title: OGG optimized-copy aborts the sync on embedded-art mass-storage devices
status: To Do
assignee: []
created_date: '2026-05-28 21:13'
labels:
  - bug
  - mass-storage
  - transcoding
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/sync/music/classifier.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
parent_task_id: TASK-358
priority: high
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a mass-storage device whose primary artwork source is `embedded` and that natively plays vorbis (e.g. the `echo-mini` preset), an OGG/vorbis source is classified as a copy and routed to `optimized-copy` (FFmpeg passthrough). The re-mux into an OGG container fails, and the failure aborts the rest of the run — only the tracks processed before it land (e.g. 2/8). Reproduces even with `artwork = false`.

Root: `optimized-copy` FFmpeg args were implemented for iPod-canonical formats only (ALAC/MP3/AAC — see TASK-198). OGG/vorbis was never handled. Two distinct defects are tangled here: (a) optimized-copy can't handle the OGG container, and (b) a single track's transfer failure aborts the whole sync rather than being recorded and continuing.

Repro: sync the multi-format fixture set to a `type = "echo-mini"` temp device; observe `result.failed` > 0 and the sync stopping early.

Currently fenced in the artwork matrix: all `ms-echo-mini` cells are `skipBug`-fenced in `skipArtworkCell` (`artwork-rules.ts`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 optimized-copy handles OGG/vorbis (and any non-iPod-canonical container) without failing, OR the planner transcodes when it can't safely passthrough
- [ ] #2 A single track transfer failure no longer aborts the remaining tracks in the sync
- [ ] #3 echo-mini multi-format sync completes with 0 failures
- [ ] #4 The ms-echo-mini skipBug fences in artwork-rules.ts skipArtworkCell are removed and the cells assert real behaviour
<!-- AC:END -->
