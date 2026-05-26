---
id: TASK-355.03
title: >-
  Album artwork cache is order-dependent — sibling track's art bleeds into
  non-embeddable formats
status: To Do
assignee: []
created_date: '2026-05-26 22:49'
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
- [ ] #1 Album artwork cache produces the same outcome regardless of track scan order
- [ ] #2 art-matrix.test.ts and art-matrix.docker.test.ts predictors converge — same predicted deviceHasArtwork for the same (scenario, format) pair
- [ ] #3 Chosen behaviour documented in a code comment at album-cache.ts
- [ ] #4 Unit test added that exercises both orderings and asserts the same result
<!-- AC:END -->
