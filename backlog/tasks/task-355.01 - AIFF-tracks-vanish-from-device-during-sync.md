---
id: TASK-355.01
title: AIFF tracks vanish from device during sync
status: To Do
assignee: []
created_date: '2026-05-26 22:48'
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
- [ ] #1 AIFF tracks from multi-format fixtures appear on the device after sync (both directory and subsonic adapter)
- [ ] #2 AIFF predictor branches in art-matrix.test.ts and art-matrix.docker.test.ts and art-matrix-change.test.ts are removed and replaced with the same predictions used for FLAC/ALAC, with both checkArtwork values
- [ ] #3 Root cause documented in a code comment near the fix
- [ ] #4 Unit test added covering the specific parse/scan failure that was suppressing AIFF
<!-- AC:END -->
