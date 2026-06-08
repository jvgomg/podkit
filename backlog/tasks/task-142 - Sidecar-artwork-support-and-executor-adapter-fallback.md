---
id: TASK-142
title: Sidecar artwork support and executor adapter fallback
status: Done
assignee: []
created_date: '2026-03-17 14:58'
updated_date: '2026-06-08 07:10'
labels:
  - enhancement
  - artwork
  - subsonic
  - directory-adapter
dependencies:
  - TASK-141
references:
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/artwork/extractor.ts
  - packages/podkit-core/src/adapters/directory.ts
  - test/fixtures/audio/multi-format/generate.sh
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/matrix/reference-model.ts
documentation:
  - backlog/docs/doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Two artwork gaps remain after TASK-141 Phase 1 (Subsonic artwork presence detection):

### 1. Executor doesn't fall back to adapter artwork

When the executor downloads a Subsonic track and `extractArtwork()` returns null (no embedded artwork), it gives up. If the artwork exists on the server but isn't embedded in the audio file (e.g., sidecar artwork served by Navidrome via getCoverArt), it's never transferred to the iPod.

**Fix:** Add a `getArtwork(track): Promise<Buffer | null>` method to the adapter interface. When `extractArtwork()` returns null during sync, the executor falls back to fetching artwork from the adapter.

### 2. Directory sidecar files (cover.jpg) not detected

When a directory has `cover.jpg`/`folder.jpg` alongside audio files but no embedded artwork:
- Directory adapter reports `hasArtwork: false` (only checks embedded)
- Users expect sidecar artwork to be detected and transferred

**Fix:** Add sidecar file detection to the directory adapter. Check for cover.jpg, folder.jpg, cover.png, folder.png in the track's directory. Set `hasArtwork: true` when a sidecar exists.

## Notes

- The test fixture `test/fixtures/audio/multi-format/generate.sh` has cover.jpg creation commented out pending this work
- The executor's `transferArtwork()` in `packages/podkit-core/src/sync/executor.ts` is the integration point for the adapter fallback
- The adapter interface is at `packages/podkit-core/src/adapters/interface.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Executor falls back to adapter getArtwork() when extractArtwork() returns null
- [x] #2 Directory adapter detects sidecar artwork files (cover.jpg, folder.jpg, cover.png, folder.png)
- [x] #3 Directory adapter sets hasArtwork=true when sidecar exists even if no embedded artwork
- [x] #4 Integration tests for executor adapter fallback
- [x] #5 Integration tests for directory sidecar detection
- [x] #6 test/fixtures/audio/multi-format/generate.sh cover.jpg creation uncommented
- [x] #7 E2E matrix reference model gains a sidecar-primary branch when this lands: `test-packages/e2e-tests/src/matrix/reference-model.ts` `fileArtworkSurvives` and `expectedFileArtworkSize` currently only branch on embedded vs database (sidecar-primary falls through to database, untested); rockbox is added to `art-matrix-transfer.test.ts` and `art-matrix-resize.test.ts` to assert the executor's sidecar transfer-mode behaviour cell-for-cell.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-29 (e2e matrix audit): The "directory adapter only reports embedded artwork" gap (AC #2/#3) is now reconfirmed in code and documented in passing across the e2e artwork matrix — capturing the references here so the gap is not lost:
- packages/podkit-core/src/adapters/directory.ts: parseFile() derives hasArtwork purely from music-metadata common.picture (embedded pictures). It never scans the track's directory for cover.jpg/folder.jpg/cover.png/folder.png. No sidecar code path exists.
- test-packages/e2e-tests/src/matrix/artwork-rules.ts predictDirectory(): the C-sidecar scenario 'collapses onto A' with reason 'sidecar invisible to directory adapter'. D-both behaves as B-embedded (only the embedded slot counts).
- test-packages/e2e-tests/src/matrix/reference-model.ts sourceEmbedsArt(): notes 'Sidecar cover.jpg bytes never reach the file body' so C/D embed iff the format's file body embeds.
- backlog/docs/doc-012 (Spec: Transfer Mode Behavior Matrix) documents 'Sidecar Artwork Devices' as Future / Not implemented in v1.
These are documentation/test artifacts of the gap, not a separate fix; this task (AC #2/#3/#6) remains the place that closes the directory-adapter sidecar-read side.

2026-05-30 (TASK-356.05 follow-up): the **device/target-side** matrix model has the same shape of gap as the source-adapter side already noted above. Pinning location so it lands with the executor work in this task, not lost:
- `test-packages/e2e-tests/src/matrix/reference-model.ts` `fileArtworkSurvives(action, transferMode, sourceHadArt, capabilities)` and `expectedFileArtworkSize(sourceSize, capabilities)` branch only on `artworkSources[0] === 'embedded'` (embedded device → keep+resize) vs. anything else (treated as database → portable preserves / optimized strips / fast keeps copies). A sidecar-primary device (`rockbox`: `artworkSources = ['sidecar','embedded']`, max 320) currently falls through the database branch by default — fine while rockbox isn't swept by these matrices, but the moment it is the predictions will be wrong. doc-012 §"Sidecar Artwork Devices (Future)" sketches the expected matrix (transcode: strip embedded + create device-res sidecar; copy: direct/optimized + create device-res sidecar) — pin against it.
- `test-packages/e2e-tests/src/features/art-matrix-transfer.test.ts` sweeps iPod only today; `art-matrix-resize.test.ts` sweeps `RESIZE_DEVICE_IDS = ['ms-generic','ipod-MA147']`. Both should add rockbox once the sidecar transfer-mode model exists. AC added above covers this.
- This is paired with TASK-356.06 on the source side (Subsonic/Navidrome serves sidecar art via API): these two tasks close the sidecar surface from both ends.

## Implementation (2026-06-02)

**Source-side:** `CollectionAdapter.getArtwork?(item): Promise<Buffer | null>` added to the adapter interface. `DirectoryAdapter` detects peer `{cover,folder,front,album}.{jpg,jpeg,png}` (case-insensitive, memoised per album dir). `parseFile` flips `hasArtwork=true` on sidecar hit when no embed present; under `--check-artwork` the sidecar bytes are hashed. `SubsonicAdapter.getArtwork(track)` calls `getCoverArt`, filters the Navidrome placeholder, caches bytes in a bounded FIFO map (`ARTWORK_BYTES_CACHE_MAX=100`). The placeholder probe moved out of the `--check-artwork` gate — fast-mode syncs cannot leak the placeholder onto the device via the new fallback.

**Cache + executor:** `AlbumArtworkCache.get` gained `options.adapterFallback?: () => Promise<Buffer | null>`. Consulted after embedded extraction returns null; positive results promote to the album-level positive cache so siblings share one fetch. `MusicPipeline.transferArtwork(track, sourceFilePath, sourceTrack)` — `sourceTrack` required (defensive). `MusicPipeline.adapter` stored per execute() so `buildAdapterFallback` can close over it.

**E2E matrix:** `reference-model.ts` gained `artworkPrimary(capabilities)` + sidecar-primary branches in `fileArtworkSurvives` and `expectedFileArtworkSize`; `expectedSidecarSize` documents the spec. `predictDirectory`/`predictSubsonic` rewritten: iPod gets art on every non-A scenario via the new fallback; mass-storage gets art only when the source body embeds OR the OGG/Opus copy path applies (`updateTrack({embeddedPictureData})` taglib write). `skipArtworkCell` fences ~60 mass-storage non-OGG-copy C-sidecar cells via `skipBug TASK-370`. `isOggExtension` exported from `@podkit/core` so the matrix re-uses the executor's predicate (no drift).

**Tests (AC #4 + #5):** 29 new unit tests — directory adapter (11: sidecar detection, hash, getArtwork, EACCES, disconnect, D-both embed-wins, per-album memoisation), subsonic adapter (9: getArtwork e2e, placeholder/404/throw, byte-cache reuse, FIFO cap eviction), album-cache (5: adapter fallback interaction), pipeline (4: fallback wiring + dry-run no-I/O contract).

**Verification:** typecheck clean; 2868 unit pass / 5 skip / 0 fail; host artwork matrices 441 pass / 60 skip (`skipBug TASK-370`) / 0 fail; docker subsonic + change matrices 96 pass / 0 fail; full `bun run test:e2e` 33/33 green.

**Sonnet reviews (2):** first pass caught per-album memoisation, unconditional placeholder probe, byte-cache reuse, stale Future-comment, Buffer.from redundancy, getOptions simplification — all applied. Second pass on cleanup caught dead overwrite branch in `cacheArtworkBytes`, duplicated OGG predicate, re-fetch documentation, extname dotfile comment — all applied.

## TASK-142 AC #7 closure (2026-06-03)

The reference-model sidecar-primary branch + rockbox sweep landed across TASK-372 (commit 50a6247f) and TASK-370 (commit 9465faf9). `artworkPrimary`, `fileArtworkSurvives` sidecar branch, `expectedSidecarSize` are in place. `ms-rockbox` is in `RESIZE_DEVICE_IDS` (60 resize cells) and `TRANSFER_ART_DEVICE_IDS` (48 transfer cells). All cells assert `fileHasArt` per transfer-mode rules AND new `sidecarPresent`/`sidecarSize` signals via the new `probeSidecarArtwork` helper. All AC criteria for TASK-142 are now complete.
<!-- SECTION:NOTES:END -->
