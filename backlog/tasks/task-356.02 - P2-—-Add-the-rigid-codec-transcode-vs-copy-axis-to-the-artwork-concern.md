---
id: TASK-356.02
title: P2 — Add the rigid-codec transcode-vs-copy axis to the artwork concern
status: Done
assignee: []
created_date: '2026-05-28 08:00'
updated_date: '2026-05-28 09:29'
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
modified_files:
  - test-packages/e2e-tests/src/matrix/reference-model.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
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
- [x] #1 copy-everything and transcode-everything pinned configs added as a matrix axis
- [x] #2 reference-model deviceAction() returns copy/transcode deterministically from the pinned codec config
- [x] #3 Artwork survival asserted separately for the copy path and the transcode path, every format
- [x] #4 Matrices green with the new axis
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What landed

- **`reference-model.ts`** — added the pipeline axis + classifier mirror:
  - `Pipeline` (`prefer-copy` | `transcode-aac`) + `PIPELINES`.
  - `deviceAction(format, capabilities, pipeline): 'copy' | 'transcode'` — an INDEPENDENT mirror of podkit's classifier first rule (`copy ⟺ device-native AND not forcing a lossless source down a lossy preset`), keyed off the capability table, not an `@podkit/core` import.
  - `artworkReaches(sourceHadArt, capabilities)` — art survives both copy and transcode on any device with artwork storage; the codec action never drops it (transfer-mode stripping is a separate P5 axis).
- **`artwork-rules.ts`** — `PipelineCell` (scenario × format × pipeline) + builders; `predictDirectory` is now pipeline-aware, composing `deviceAction` (for the reason/path) + `artworkReaches` (for `deviceHasArtwork`); `createPipelineConfig(musicRoot, pipeline)` writes the pinned-config TOML (`quality=max` + lossless `['source']` for prefer-copy; `quality=high` + lossy `['aac']` for transcode-aac). `HOST_IPOD_CAPS` derived once via `ipodCapabilitiesForModel('MA147')`.
- **`art-matrix.test.ts`** — host matrix now varies the pipeline axis (128 cells = 4 scenario × 8 format × 2 pipeline × 2 check-artwork). Each pipeline syncs onto its OWN fresh iPod so the second pipeline's sync can't diff against the first's tracks and pollute idempotency.

## The coverage win (iPod, MA147)

ALAC/WAV/AIFF flip copy↔transcode between the two pipelines (copy under prefer-copy, transcode under transcode-aac); MP3/AAC always copy; FLAC/OGG/Opus always transcode (no native iPod playback). So the **copy path for ALAC/WAV/AIFF is now exercised** — the previous default-`high` matrix only ever transcoded them — and art is asserted to survive both paths for every format.

## Scope notes

- Pipeline axis applied to the HOST (directory) matrix only. Transcode-vs-copy is a device+config property, not a source-adapter property, so re-running it through the slower Subsonic container adds no signal. The docker and change matrices keep their single-config behaviour.
- The static matrix asserts art *survives* both paths (the real sync runs under each pinned config), but does not yet assert *which* action podkit chose — that's a decision assertion, gated on TASK-357. `deviceAction` is the reference the future assertion will compare against.
- On iPod, `deviceHasArtwork` is uniform across pipelines (art survives both), so the prediction value is the same per (scenario, format); the value is exercising both real code paths + the deviceAction seam. The literal "copy-everything" (all formats copy) arrives in P4 with the broad-codec mass-storage device.

## Verification

- Host matrix (128 cells) green; change matrix (16) green; docker matrix (64) green — the latter two share the edited `artwork-rules.ts`.
- Both pinned configs produce successful syncs (observe throws on non-zero exit / `success:false`), confirming `quality=max` + `[codec] lossless=['source']` and `quality=high` + `[codec] lossy=['aac']` parse and resolve.
- typecheck + oxlint clean. No production code changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the transcode-vs-copy axis to the host artwork matrix via two pinned codec configs (`prefer-copy`: quality=max + lossless ['source']; `transcode-aac`: quality=high + lossy ['aac']). New `deviceAction()` in the reference model independently mirrors podkit's classifier to predict copy vs transcode per (format, capabilities, pipeline); `artworkReaches()` confirms art survives both paths on an artwork-storing device. `predictDirectory` composes both; `createPipelineConfig` writes the pinned TOML; the host matrix now runs 128 cells with each pipeline on its own fresh iPod.

Coverage win: ALAC/WAV/AIFF are now exercised on the copy path (prefer-copy) — the previous default-high matrix only transcoded them — with art asserted to survive. Action-level assertion (which path podkit actually chose) is deferred to TASK-357. Scoped to the directory adapter (transcode-vs-copy is device+config, not source-dependent). Host (128) + change (16) + docker (64) matrices all green; typecheck + oxlint clean; no production code changed.
<!-- SECTION:FINAL_SUMMARY:END -->
