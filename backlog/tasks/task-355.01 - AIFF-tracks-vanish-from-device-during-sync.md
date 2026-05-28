---
id: TASK-355.01
title: AIFF tracks vanish from device during sync
status: Done
assignee: []
created_date: '2026-05-26 22:48'
updated_date: '2026-05-26 23:04'
labels:
  - bug
  - aiff
  - sync-pipeline
dependencies: []
references:
  - 'packages/podkit-core/src/adapters/directory.ts:172'
  - 'packages/podkit-core/src/adapters/subsonic.ts:525'
  - 'packages/devices-ipod/src/capabilities.ts:83'
  - test-packages/test-fixtures/fixtures/audio/multi-format/02-aiff-track.aiff
modified_files:
  - test-packages/test-fixtures/src/static/audio-multi-format.ts
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
  - packages/podkit-core/src/adapters/directory.integration.test.ts
parent_task_id: TASK-355
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

Across both adapters (directory + Subsonic) and every artwork scenario, AIFF tracks are read from the source side but never end up in the iPod's iTunesDB. The matrix records `trackPresent: false` for all 16 AIFF cells; the second sync produces no operations for those tracks either — they're absent from both `device.getTracks()` and the second-sync diff.

## Why this is suspicious

iPod 5G (model `MA147`, the dummy test target) supports AIFF — `packages/devices-ipod/src/capabilities.ts:83` adds `'aiff'` to `supportedAudioCodecs` when `supportsAlac` is true. The directory adapter has `'aiff'` and `'aif'` in its default extensions list (`packages/podkit-core/src/adapters/directory.ts:71`). So both the device and the source side claim AIFF support.

Symptom is identical between adapters → not adapter-side; somewhere between scan and database insert. Candidates:

1. `music-metadata` fails to parse the AIFF fixture (warning swallowed by `onWarning?` in the directory adapter scan loop).
2. The classifier or pipeline drops AIFF mid-flight.
3. The fixture itself is malformed.

The fact that `idempotent=true` for AIFF in the matrices (no re-add attempt on sync 2) suggests the source-side adapter never returns AIFF tracks to the planner in the first place — the failure is probably in parsing.

## Where to investigate

- `packages/podkit-core/src/adapters/directory.ts:172-223` — the scan loop. Wrap with a temporary `console.log` of `onWarning` callbacks during a sync of `test-packages/test-fixtures/fixtures/audio/multi-format/02-aiff-track.aiff` to see what `music-metadata` reports.
- If `music-metadata` is the culprit: file may be valid but the parser may reject it. Try `ffprobe -show_format` on the fixture to confirm it's well-formed.
- For the Subsonic side, mirror: log warnings returned by `mapSongToTrack`, and check whether Navidrome even returns AIFF tracks in `getAlbum.songs`.

## Definition of fix

- AIFF source files read by the directory adapter produce a `CollectionTrack` and reach the sync pipeline.
- AIFF tracks land on the dummy iPod and appear in `target.getTracks()`.
- All 16 AIFF cells in the matrices flip; the predictors must be updated to remove the AIFF-specific branches that currently encode `trackPresent: false` (in all three art-matrix files).
- Add a unit test for whichever parser/code path was broken so the failure can't recur silently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AIFF tracks from multi-format fixtures appear on the device after sync (both directory and subsonic adapter)
- [x] #2 AIFF predictor branches in art-matrix.test.ts and art-matrix.docker.test.ts and art-matrix-change.test.ts are removed and replaced with the same predictions used for FLAC/ALAC, with both checkArtwork values
- [x] #3 Root cause documented in a code comment near the fix
- [x] #4 Unit test added covering the specific parse/scan failure that was suppressing AIFF
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Actual root cause (different from the hypothesis in the task body)

AIFF tracks were NOT being dropped by music-metadata or the sync pipeline. They were reaching the device — just under `artist="Unknown Artist"` and `album="Unknown Album"` because the **fixture itself** was missing those tags. The matrix lookup keyed on `(SCENARIO_ARTIST, FORMAT_TITLE)` therefore couldn't find the AIFF row and recorded `trackPresent: false`.

The real bug: ffmpeg's AIFF muxer only writes the native AIFF chunks (`NAME` / `AUTH` / `ANNO` / `(c)`) by default and silently drops `artist`/`album`/`track`/`date`/`genre`. It also refuses an `attached_pic` stream. Both are unblocked by passing `-write_id3v2 1`, which embeds an ID3v2 tag in the AIFF FORM — the same convention Apple/iTunes uses for AIFF in the wild and that `music-metadata` parses correctly.

Repro that proved this: dropped a single `02-aiff-track.aiff` (multi-format-embedded variant) into a temp dir, synced to a dummy iPod, listed device tracks — got `artist="Unknown Artist" title="AIFF Test Track" album="Unknown Album"`. The track was present; only metadata was missing.

## Fix

- `test-packages/test-fixtures/src/static/audio-multi-format.ts` — added `-write_id3v2 1` to the AIFF track's `extraArgs`, flipped `supportsAttachedPic: true`, and updated the surrounding comment block. Regenerated the five multi-format-* fixture sets.
- All three matrix files: flipped `FIXTURE_EMBEDS_ART.aiff` to `true` and removed the AIFF special-case branch from each `predict()`. Stale "AIFF tracks do not land" comment in `art-matrix-change.test.ts` docstring removed too.

## Test added

`packages/podkit-core/src/adapters/directory.integration.test.ts` — new `describe('DirectoryAdapter — AIFF multi-format fixture')` block. Two cases: (a) plain AIFF round-trips artist/album/track/title, (b) embedded AIFF round-trips artist + has artwork. If `-write_id3v2 1` ever gets removed, these fail immediately and clearly — much faster signal than the matrix test, which only catches it via cascading scenario-key misses.

## Verification

- `bun run test:e2e --filter @podkit/e2e-tests -- art-matrix` — host matrix + host change-matrix both green (2 files).
- `bun run test:docker --filter @podkit/e2e-tests -- art-matrix.docker` — Subsonic/Navidrome matrix green.
- `bun run test:integration --filter @podkit/core -- directory.integration.test` — pinning tests green.
- `bun run typecheck` for `@podkit/core`, `@podkit/test-fixtures`, `@podkit/e2e-tests` — clean.

## Knock-on effect on the matrix

AIFF now behaves identically to FLAC/ALAC in every cell:
- `trackPresent: true` everywhere (was false).
- `deviceHasArtwork: true` in B/D (was false — now embeds attached_pic via id3v2).
- `idempotent: true` across both `--check-artwork` values (same as FLAC/ALAC).

So the 16 AIFF cells across host+docker+change matrices collapsed from a single "trackPresent: false / idempotent: true" branch into the regular FLAC-equivalent rules. No new branches needed in the predictors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task assumed the bug was in podkit (parser swallowing AIFF or pipeline dropping it). Repro showed it wasn't — AIFF reached the device fine, just with `Unknown Artist`/`Unknown Album` because the **fixture** itself was missing tags. ffmpeg's native AIFF muxer only writes `NAME`/`AUTH`/`ANNO`/`(c)` chunks and silently drops `artist`/`album`/`track`/`genre`; it also rejects `attached_pic`. Both are unblocked by `-write_id3v2 1`.

Fix:
- Added `-write_id3v2 1` to the AIFF track's `extraArgs` in `test-packages/test-fixtures/src/static/audio-multi-format.ts` with a root-cause comment.
- Flipped `supportsAttachedPic: true` for AIFF (id3v2 also enables attached_pic).
- Regenerated the multi-format-* fixture sets.
- Flipped `FIXTURE_EMBEDS_ART.aiff` to `true` and removed the AIFF special-case branches from all three matrix files (`art-matrix.test.ts`, `art-matrix.docker.test.ts`, `art-matrix-change.test.ts`). AIFF now uses the same predictions as FLAC/ALAC in every cell.
- Added an `AIFF multi-format fixture` block to `packages/podkit-core/src/adapters/directory.integration.test.ts` that pins the AIFF metadata round-trip (artist/album/track/title + embedded artwork). Faster signal than the matrix if `-write_id3v2 1` ever gets removed.

Verified:
- Host matrix (`art-matrix.test.ts` + `art-matrix-change.test.ts`) green.
- Docker matrix (`art-matrix.docker.test.ts`) green — Subsonic/Navidrome path also passes, so AIFF works through both adapters as required by AC #1.
- New pinning tests green.
- Typecheck clean across affected packages.
<!-- SECTION:FINAL_SUMMARY:END -->
