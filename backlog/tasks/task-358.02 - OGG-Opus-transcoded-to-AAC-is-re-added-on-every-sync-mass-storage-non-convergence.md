---
id: TASK-358.02
title: >-
  OGG/Opus transcoded to AAC is re-added on every sync (mass-storage
  non-convergence)
status: To Do
assignee: []
created_date: '2026-05-28 21:13'
labels:
  - bug
  - mass-storage
  - sync
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
parent_task_id: TASK-358
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a mass-storage device, an OGG (vorbis) or Opus source that podkit transcodes to AAC is **re-added every sync** — the second (and every subsequent) dry-run re-fires `add-transcode` for that track, confirmed stable across 4 syncs. The transcoded AAC output on the device is not matched back to its incompatible-lossy source on re-scan, so the collection diff never converges.

This is the incompatible-lossy → AAC matching gap: the source is `.ogg`/`.opus`, the device file is `.m4a`, and whatever key the mass-storage diff uses to recognise an already-synced track does not bridge that source→output relationship for these formats (it does for lossless→AAC, which converges).

Repro: sync the multi-format fixture to a `type = "generic"` temp device (generic has no native vorbis/opus, so both transcode to AAC); dry-run again and observe `add-transcode` for the OGG and Opus tracks.

Currently fenced in the artwork matrix: `ms-generic` `ogg`/`opus` cells are `skipBug`-fenced in `skipArtworkCell` (`artwork-rules.ts`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mass-storage sync of an OGG or Opus source converges: the second sync plans no add/transcode for that track
- [ ] #2 Root cause identified (manifest/diff key, or source-codec normalisation) and fixed in the mass-storage adapter / sync diff
- [ ] #3 The ms-generic ogg/opus skipBug fences in skipArtworkCell are removed and the cells assert idempotency
<!-- AC:END -->
