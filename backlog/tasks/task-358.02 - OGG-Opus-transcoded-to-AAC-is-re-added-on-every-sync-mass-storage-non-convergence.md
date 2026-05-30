---
id: TASK-358.02
title: >-
  OGG/Opus transcoded to AAC is re-added on every sync (mass-storage
  non-convergence)
status: Done
assignee: []
created_date: '2026-05-28 21:13'
updated_date: '2026-05-30 11:16'
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
- [x] #1 A mass-storage sync of an OGG or Opus source converges: the second sync plans no add/transcode for that track
- [x] #2 Root cause identified (manifest/diff key, or source-codec normalisation) and fixed in the mass-storage adapter / sync diff
- [x] #3 The ms-generic ogg/opus skipBug fences in skipArtworkCell are removed and the cells assert idempotency
- [x] #4 The ms-echo-mini opus skipBug fence in skipArtworkCell is removed and the cell asserts idempotency
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause was metadata loss, not a diff-key issue. FFmpeg's `-map_metadata 0` copies *format-level* tags only; OGG/Vorbis and Opus carry their tags on the audio stream (Vorbis comments are a stream construct), so the transcoded M4A output landed with no title/artist/album. With no metadata to match against, the source/device matcher (`getMatchKey` on artist+title+album) couldn't recognise the AAC output as the OGG/Opus source's existing track, so the dry-run kept re-firing `add-transcode`.

**Fix.** Added a `pushSourceMetadataMapping` helper that emits the chained `-map_metadata 0 -map_metadata 0:s:0` pair across every codec builder in `transcode/ffmpeg.ts` (`buildTranscodeArgs`, `buildOpusArgs`, `buildMp3Args`, `buildFlacArgs`, `buildAlacArgs`, `buildOptimizedCopyArgs`). The second mapping promotes input stream-0 metadata to the output's global tags — a no-op for sources that already had format-level tags (FLAC, MP3, M4A, ALAC, WAV, AIFF), and the missing piece for OGG/Opus.

This is the exact fix prescribed by TASK-354 — both tasks share the root cause, so 358.02 closing also closes 354.

**Verification:**
- Direct repro: ms-generic sync of multi-format-embedded → first sync 8 completed, second dry-run `tracksExisting: 8 / tracksToTranscode: 0` (was 6/2 before).
- Un-skipped the OGG metadata-preservation integration test at `ffmpeg.integration.test.ts` and added an equivalent Opus test — both pass.
- `skipArtworkCell` reduced to `return null` (every cell asserts real behaviour); `skipBug` import dropped from artwork-rules.ts.
- Full host e2e: 31/31. Docker matrix: 1/1. Unit: 2812/2812. Core integration: green. Typecheck + oxlint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Same root cause as TASK-354 — `-map_metadata 0` only copies format-level tags, and OGG/Opus store theirs on the audio stream. The transcoded M4A output had no title/artist/album to match against, so the diff fired `add-transcode` forever.

Added `pushSourceMetadataMapping` to ffmpeg.ts and replaced every `-map_metadata 0` site with the chained `0 + 0:s:0` pair. Stream-tag sources (OGG/Opus) now round-trip through transcode; format-tag sources (everything else) are unaffected.

The artwork matrix's `skipArtworkCell` is now a no-op `return null` — all skipBug fences gone. Both ms-generic ogg/opus and ms-echo-mini opus cells assert real idempotency. Un-skipped the long-skipped OGG metadata test in `ffmpeg.integration.test.ts` and added an Opus equivalent.

This also closes TASK-354 (same fix, same root cause).
<!-- SECTION:FINAL_SUMMARY:END -->
