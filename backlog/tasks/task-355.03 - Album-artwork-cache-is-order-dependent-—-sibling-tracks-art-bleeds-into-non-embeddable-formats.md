---
id: TASK-355.03
title: >-
  Album artwork cache is order-dependent — sibling track's art bleeds into
  non-embeddable formats
status: Done
assignee: []
created_date: '2026-05-26 22:49'
updated_date: '2026-05-27 00:47'
labels:
  - bug
  - artwork
  - album-cache
  - non-determinism
dependencies: []
references:
  - 'packages/podkit-core/src/artwork/album-cache.ts:82'
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
modified_files:
  - test-packages/test-fixtures/src/static/audio-multi-format.ts
  - test-packages/test-fixtures/src/static/shared.ts
  - packages/podkit-core/src/artwork/album-cache.ts
  - packages/podkit-core/src/artwork/album-cache.test.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
parent_task_id: TASK-355
priority: medium
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

`packages/podkit-core/src/artwork/album-cache.ts:82-99` caches the artwork bytes extracted from the FIRST track of an album, then returns the same bytes for every subsequent track in the same album. Whether a given track ends up with embedded art on the iPod therefore depends on which track in its album is processed first.

The two art-matrix files surface this directly:

- `art-matrix.test.ts` (directory adapter): WAV files in scenarios B-embedded and D-both end up on the device with `hasArtwork=false`. Glob ordering puts `01-wav-track.wav` first → extract returns null → cache stores null for the whole album → FLAC/ALAC siblings (alphabetically later) re-use the cached null. The matrix predicts `deviceHasArtwork: false` and asserts it.
- `art-matrix.docker.test.ts` (Subsonic adapter): the same WAV files end up with `hasArtwork=true`. Navidrome's `getAlbum.songs` ordering puts FLAC/ALAC ahead of WAV → cache stores FLAC's art → WAV inherits it. The matrix predicts `deviceHasArtwork: true` and asserts it.

Same code, same fixtures, opposite outcomes for the same logical track. Whichever outcome is "correct" depends on intent, but the *order-dependence itself* is the bug — it makes podkit's behaviour non-deterministic from the user's point of view.

## What the cache is trying to do

The cache exists for legitimate reasons: tracks that share an album typically share the cover, and re-extracting per-track wastes ffprobe spawns. The goal is the optimisation, not the side-effect.

## Suggested directions

1. **Extract once, deterministically**: scan the whole album up-front, pick a track to extract from (prefer one whose container can carry attached_pic), cache that. WAV and OGG/Opus then deterministically inherit from FLAC/ALAC siblings if any exists.
2. **Cache only the positive result**: never cache `null`. On a miss, try the next track; only cache when extraction succeeds. Easier change; converges to the same outcome.
3. **Pass artwork from the adapter, not from the file**: ties into TASK-142's `adapter.getArtwork()` — if the adapter is the source of truth for "what art does this album have", the cache becomes a thin per-album helper rather than a per-file extraction race.

## Definition of fix

- After the fix, the host matrix and the docker matrix predict the *same* `deviceHasArtwork` value for the same `(scenario, format)` pair. WAV in B/D should be either `true` on both or `false` on both — pick deliberately, document why.
- The predictor and reason strings in both matrix files updated; the comment block in `art-matrix.docker.test.ts` that documents the order-dependence can be deleted or shortened to "fixed in TASK-355.03".
- A unit test that pins the chosen behaviour at the cache level (not just via E2E).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Album artwork cache produces the same outcome regardless of track scan order
- [x] #2 art-matrix.test.ts and art-matrix.docker.test.ts predictors converge — same predicted deviceHasArtwork for the same (scenario, format) pair
- [x] #3 Chosen behaviour documented in a code comment at album-cache.ts
- [x] #4 Unit test added that exercises both orderings and asserts the same result
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Design choice (AC #3)

**Picked iTunes-compatible behaviour**: the album cache pre-resolves the album using a prioritised sibling-candidate list and shares the resolved cover across every track in the album. WAV / OGG / Opus tracks whose source files don't carry embedded art still get the album cover on the device when an embed-capable sibling (FLAC / ALAC / MP3 / AAC / AIFF) has one. Matches what iTunes / Apple Music do; also matches the existing (accidental) Docker behaviour rather than flipping it.

Rationale documented in the new doc-comment block at the top of `AlbumArtworkCache` in `packages/podkit-core/src/artwork/album-cache.ts`.

## Implementation

1. **Fixture generator** (`test-packages/test-fixtures/src/static/audio-multi-format.ts` + `shared.ts`): every multi-format track now opts into a working embed strategy.
   - FLAC / ALAC / MP3 / AAC / AIFF: `-c:v mjpeg -disposition:v attached_pic` (AIFF additionally needs `-write_id3v2 1`, fixed in 355.01).
   - OGG / Opus: new `buildMetadataBlockPicture()` helper builds a base64-encoded FLAC PICTURE block, passed as `-metadata METADATA_BLOCK_PICTURE=<base64>` to libvorbis / libopus.
   - WAV: new `injectId3v2ApicIntoWav()` helper post-processes the ffmpeg output to append an `id3 ` RIFF chunk carrying an ID3v2.3 tag with APIC + text frames (TIT2/TPE1/TALB/TRCK/TYER/TCON). ffmpeg's WAV muxer flatly refuses video streams; the post-process is the only path. Text frames are critical: TagLib (Navidrome) prefers ID3 over LIST INFO and would index the track as Unknown if only APIC were present.
   - The `MultiFormatTrack.embedStrategy` field replaces the old `supportsAttachedPic: boolean` and dispatches the generator.

2. **AlbumArtworkCache** (`packages/podkit-core/src/artwork/album-cache.ts`): `get()` gained an optional `options.candidates` parameter — an ordered list of sibling source paths. On a cache miss with candidates, it iterates them and caches + returns the first that yields art (or caches null only when every candidate is exhausted). Without candidates the cache extracts only `sourceFilePath` and *never* caches a null result, so single-source callers (the artwork-repair routine) can't accidentally poison an album.

3. **Pipeline integration** (`packages/podkit-core/src/sync/music/pipeline.ts`): new `buildAlbumCandidates(plan, adapter)` runs once per `execute()` and groups operation sources by album, sorting paths with `artworkContainerRank()` so FLAC/ALAC/MP3/AAC/AIFF come before WAV/OGG/Opus. Only runs when `adapter.adapterType === 'directory'` — Subsonic's `source.filePath` is a `subsonic://` URI or server-side path that's not locally readable, so passing it as a candidate would just fail extraction and poison the album. Subsonic transparently uses the cache's single-source mode.

4. **Predictors** (3 matrix files): `FIXTURE_EMBEDS_ART` flipped to `true` for wav/ogg/opus. The Docker predictor's "WAV inherits from sibling" special-case + cross-adapter divergence comment block are gone — host and docker now predict the same `deviceHasArtwork` for every `(scenario, format)` pair. AC #2 satisfied.

## Tests

- `packages/podkit-core/src/artwork/album-cache.test.ts`: existing "caches null" test renamed to assert the new "doesn't poison in single-source mode" behaviour, plus two new tests:
  - "caches null in candidates mode once every candidate yields null"
  - "with candidates: returns first positive regardless of which track called"
  - "with candidates: order-independent outcome across two different first-track orderings" — the AC #1 + AC #4 pinning test.

## Verification

- Host matrices (`art-matrix.test.ts` + `art-matrix-change.test.ts`): green.
- Docker matrix (`art-matrix.docker.test.ts`): green (all 64 cells, both --check-artwork values).
- `album-cache.test.ts` unit tests: 11/11 green.
- `directory.integration.test.ts` (the AIFF fixture pinning from 355.01): still green.
- Typecheck: clean for `@podkit/core`, `@podkit/test-fixtures`, `@podkit/e2e-tests`.

## Knock-on for other 355.x subtasks

- 355.04 (MP3 codec-changed): the change-matrix predictor for MP3 still asserts `upgrade-direct-copy:codec-changed`; nothing in this PR addresses that. Independent fix.
- 355.05 (Subsonic art-matrix-change): the change-matrix docstring still says "Subsonic / Navidrome coverage of artwork-change is deferred" — coordinate with 355.05 when it lands.
- 355.02 (Subsonic optimistic-true loop): the Docker predictor still encodes the loop. This PR's pipeline candidate change doesn't apply to Subsonic, and the underlying optimistic-true bug is in the adapter — independent fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Decision

Picked **iTunes-compatible behaviour**: the album cache pre-resolves each album using a prioritised sibling-candidate list and shares the resolved cover across every track in the album. WAV / OGG / Opus tracks whose source files lack embedded art still get the album cover on the device when an embed-capable sibling has one. Matches iTunes and Apple Music; also matches the existing (accidental) Docker outcome rather than flipping it.

## What changed

1. **Fixture generator**: every multi-format track now opts into a working embed strategy.
   - FLAC/ALAC/MP3/AAC/AIFF: standard `-c:v mjpeg -disposition:v attached_pic`.
   - OGG/Opus: new `buildMetadataBlockPicture()` helper → ffmpeg `-metadata METADATA_BLOCK_PICTURE=<base64>`.
   - WAV: new `injectId3v2ApicIntoWav()` helper post-processes the ffmpeg output to append an `id3 ` RIFF chunk with an ID3v2.3 tag containing APIC + text frames. ffmpeg's WAV muxer refuses video streams; post-process is the only path. Text frames are critical — TagLib (Navidrome) prefers ID3 over LIST INFO and would otherwise index the track as Unknown.
   - `MultiFormatTrack.embedStrategy` dispatches the generator.

2. **AlbumArtworkCache.get()** takes an optional `options.candidates` (ordered sibling paths). On a miss with candidates: iterate, cache + return the first positive, cache null only when every candidate is exhausted. Without candidates: extract only `sourceFilePath` and *never* cache a null, so single-source callers (the artwork-repair routine) can't poison an album.

3. **Pipeline** pre-computes per-album candidates from the sync plan in `buildAlbumCandidates(plan, adapter)`, sorting paths with a new `artworkContainerRank()` (FLAC/ALAC/MP3/AAC/AIFF first). Gated on `adapter.adapterType === 'directory'` — Subsonic's `source.filePath` is a `subsonic://` URI or server path that ffmpeg can't read, so it transparently uses single-source mode.

4. **Matrix predictors**: `FIXTURE_EMBEDS_ART` set to `true` for wav/ogg/opus. The Docker predictor's WAV-inherits-from-sibling special-case + cross-adapter divergence comment are gone — host and docker now predict the same outcome for every `(scenario, format)` pair.

## Tests added

`packages/podkit-core/src/artwork/album-cache.test.ts`:
- Renamed the old "caches null" test to assert the new single-source-mode "doesn't poison" behaviour.
- "caches null in candidates mode once every candidate yields null".
- "with candidates: returns first positive regardless of which track called".
- "with candidates: order-independent outcome across two different first-track orderings" — the AC #1 + #4 pinning.

## Verification (all green)

- `art-matrix.test.ts` + `art-matrix-change.test.ts` (host).
- `art-matrix.docker.test.ts` (Subsonic/Navidrome — 64/64 cells).
- `album-cache.test.ts` (11/11).
- `directory.integration.test.ts` (the AIFF fixture pinning from 355.01).
- Typecheck for `@podkit/core`, `@podkit/test-fixtures`, `@podkit/e2e-tests`.
<!-- SECTION:FINAL_SUMMARY:END -->
