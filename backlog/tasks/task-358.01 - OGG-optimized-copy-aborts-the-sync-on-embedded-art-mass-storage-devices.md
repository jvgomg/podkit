---
id: TASK-358.01
title: OGG optimized-copy aborts the sync on embedded-art mass-storage devices
status: Done
assignee: []
created_date: '2026-05-28 21:13'
updated_date: '2026-05-30 09:30'
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
- [x] #1 optimized-copy handles OGG/vorbis (and any non-iPod-canonical container) without failing, OR the planner transcodes when it can't safely passthrough
- [x] #2 A single track transfer failure no longer aborts the remaining tracks in the sync
- [x] #3 echo-mini multi-format sync completes with 0 failures
- [x] #4 The ms-echo-mini skipBug fences in artwork-rules.ts skipArtworkCell are removed and the cells assert real behaviour
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Fix A (AC #1) — OGG/vorbis optimized-copy.** Added `'vorbis'` to `OptimizedCopyFormat`, routed it to FFmpeg `-f ogg` (same container as `'opus'`, distinct so the filetype label / extension stay accurate). `getOptimizedCopyFormat` now maps `track.fileType === 'ogg'` → `'vorbis'` instead of falling through to `'m4a'` (which FFmpeg rejects with "extension is not .m4a nor .m4v").

**Fix B (AC #2) — non-fatal per-track failures.** Plumbed `continueOnError` through `ExecutionContext` (`engine/content-type.ts`). The engine executor (`engine/executor.ts`) sets it from `SyncExecuteOptions`; the music handler (`sync/music/handler.ts`) reads it from `ctx` (config override wins). The CLI sets `continueOnError: true` at the engine layer, but the music handler was passing `this.config.raw.continueOnError` (undefined) to `MusicPipeline`, defaulting it to `false` so a single failing track aborted the whole sync.

**Adjacent fixes surfaced while removing the skipBug fences:**

- `open-device.ts` now returns `adapter.capabilities` (the filtered view) instead of the raw preset for mass-storage. Without this the planner thought WAV/AIFF were device-native on echo-mini, classified them as `optimized-copy`, and FFmpeg failed on the `m4a` container.
- `getFileTypeLabel` got proper labels for `.ogg`/`.wav`/`.aiff`/`.aif` (was falling through to `'Audio file'` which `resolveFileExtension` then mangled into `.Audio file`, breaking TagLib mimetype detection).
- `MassStorageTarget.getTracks` now merges container + audio-stream tags (Vorbis comments live on the stream, container tags win on collision). Same anti-mutual-masking rationale as the earlier case-insensitive fix.
- `expectedFileArtworkSize` rounds the max edge down to even — FFmpeg's `force_divisible_by=2` on the artwork scale filter turns the echo-mini 127px max into 126px in real output.
- The artwork matrix's `observeStaticArtwork` now tolerates partial-failure (exit=2, `success=true`): skipBug cells share a multi-format source root with asserted cells, so legitimate per-track failures are expected.

**Fences removed.** `skipArtworkCell` for `ms-echo-mini` is gone; only Opus on echo-mini and OGG/Opus on generic stay `skipBug`-fenced (doc-039 §"Mass-storage sync gaps" #2 — the AAC re-add loop). echo-mini now sweeps the full artwork product.

**New coverage.** `art-matrix-resize.test.ts` extended to `ms-echo-mini` (max 127 → real 126px downscale).

**Unit tests added.** `buildOptimizedCopyArgs` covers `'vorbis'`; `engine/executor.test.ts` asserts `continueOnError` reaches `ExecutionContext`.

**Verification.** `bun run test:unit` 2780/2780; `bun run test:e2e` 31/31; `bun run test:e2e:docker -- art-matrix.docker` 1/1; `bun run typecheck` clean; oxlint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two root causes — both inside the OGG-on-echo-mini path that previously aborted at 2/8 tracks.

1. `OptimizedCopyFormat` didn't cover OGG/vorbis: `getOptimizedCopyFormat` fell through to `'m4a'`, FFmpeg ran `-f ipod` against a vorbis stream and failed. Added `'vorbis'` → ffmpegFormat `'ogg'`; `getOptimizedCopyFormat` routes `fileType === 'ogg'` to it.

2. The engine's `continueOnError=true` (set by the CLI) was never reaching `MusicPipeline`. Plumbed via `ExecutionContext` so the music handler can inherit it; config override still wins.

Three adjacent gaps surfaced when the skipBug fences came off and the rest of the echo-mini sync ran for the first time: `open-device.ts` was leaking raw (unfiltered) mass-storage caps into the classifier (WAV-on-echo-mini misclassified as device-native); `getFileTypeLabel` had no `.ogg`/`.wav`/`.aiff` branches (label fell through to `'Audio file'`, which `resolveFileExtension` turned into a `.Audio file` filename TagLib refused to write); and the test-side `MassStorageTarget.getTracks` only read `format_tags`, missing the Vorbis comments OGG/Opus carry on the audio stream. All four fixed.

The echo-mini artwork cells now sweep the full product (only Opus stays skipBug-fenced for #2). `art-matrix-resize` extended to echo-mini — the real 1024→127→126px downscale is asserted (the reference model now mirrors FFmpeg's `force_divisible_by=2` even-edge rule).

Unit/e2e/docker/typecheck/lint all green.
<!-- SECTION:FINAL_SUMMARY:END -->
