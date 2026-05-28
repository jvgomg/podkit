---
id: TASK-356.02
title: P2 — Add the rigid-codec transcode-vs-copy axis to the artwork concern
status: To Do
assignee: []
created_date: '2026-05-28 08:00'
updated_date: '2026-05-28 08:20'
labels:
  - testing
  - e2e
  - matrix
  - artwork
  - codec
dependencies:
  - TASK-356.01
  - TASK-356.03
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
parent_task_id: TASK-356
priority: medium
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-039 phase 3 + §"The transcode-path reframe". Today the artwork matrix's `format` axis silently conflates the container's embed mechanism with whether the track is copied or transcoded (under default `quality=high` on a 5G iPod, lossless transcodes to AAC, mp3/aac copy, ogg/opus transcode). A transcode-only regression can hide behind a copy-path pass.

## Scope

Add an explicit transcode-vs-copy axis to the artwork concern via two pinned codec configs:
- **copy-everything**: `quality=max`, lossless stack `['source']`, device supports every source codec → all formats direct-copy.
- **transcode-everything**: `quality=high`, lossy `['aac']` → lossless + incompatible formats transcode to AAC.

Update the artwork `reference-model` so `deviceAction(format, device, codecCfg)` returns copy vs transcode deterministically from the pinned config, and `artSurvives()` composes off the action. The matrix then asserts "art survives a copy" and "art survives FFmpeg re-embed" as separate, controlled cells rather than an accident of format.

Depends on P1 (the harness + reference model must exist first).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 copy-everything and transcode-everything pinned configs added as a matrix axis
- [ ] #2 reference-model deviceAction() returns copy/transcode deterministically from the pinned codec config
- [ ] #3 Artwork survival asserted separately for the copy path and the transcode path, every format
- [ ] #4 Matrices green with the new axis
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-28: Now also depends on TASK-356.03. P2's 'copy-everything' pinned config (quality=max, lossless ['source'], device supports every codec) is degenerate on the iPod target — MA147 has no native FLAC/OGG/Opus, so the classifier transcodes those regardless of config. A literal copy-everything needs the broad-codec mass-storage device that P3 delivers, so P3 runs first. Per design decision: deviceAction() will be an INDEPENDENT re-implementation of podkit's classifier in the reference model (not an import of @podkit/core) so the prediction stays independent of the system under test.
<!-- SECTION:NOTES:END -->
