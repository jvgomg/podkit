---
id: TASK-387
title: >-
  fix(e2e): codec-preference tests count cover.jpg as audio file after TASK-370
  sidecar write
status: To Do
assignee: []
created_date: '2026-06-04 08:12'
labels:
  - e2e
  - regression
  - artwork
  - sidecar
dependencies: []
references:
  - test-packages/e2e-tests/src/features/codec-preference.test.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
priority: high
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Two e2e tests in `test-packages/e2e-tests/src/features/codec-preference.test.ts` fail reproducibly on `main`:

- `syncs FLAC to Opus when codec preference is opus-first`
- `re-syncs with new codec when codec preference changes from AAC to Opus`

Both report **"Received 4 files, expected 3"**.

## Root Cause

The tests use a device config with `artworkSources = ["sidecar"]` (originally added to avoid the embedded-artwork / OGG container incompatibility). Before TASK-370 (`9465faf9`), `artworkSources = ["sidecar"]` was a no-op for the write path — sidecar write wasn't implemented. TASK-370 wired `MassStorageAdapter.writeSidecar()`, so any sync to a device with `artworkSources = ["sidecar"]` now physically writes a `cover.jpg` next to the audio files.

The test's `findMusicFiles()` helper (lines 47–67) recursively finds **all files** in the `Music/` directory — it does not filter to audio extensions. The goldberg-selections fixture has artwork on all three tracks, so one `cover.jpg` is written, producing 4 entries where 3 are expected.

## Complicating factor

The test config also sets `artwork = false` at the top level. `effectiveArtwork = false` is passed to `planner.plan()` (to skip `upgrade-artwork` plan operations) and is threaded through to `MusicSyncConfig.artwork` in `createPlan`. However, in `MusicPresenter.executeSync`, the `executor.execute()` call does **not** forward `artwork: config.effectiveArtwork` — it omits the option entirely, so the pipeline defaults to `artwork = true`. This is a separate pre-existing gap (artwork flag not fully honoured at execution time) but it means `artwork = false` in the TOML config is not preventing the sidecar write.

## Fix options

**Option A (preferred — minimal, surgical):** Change `findMusicFiles` to filter by audio file extension (`.flac`, `.m4a`, `.mp3`, `.opus`, `.ogg`, `.wav`, `.aiff`, `.aac`). The test's intent is to count audio output files, not all device files. This also makes the helper more robust against future device-side writes (sidecar, `.podkit-tmp` remnants, etc.).

**Option B (also correct, more config-level):** Change the device config in these two tests to use `artworkSources = []` (no artwork support) instead of `artworkSources = ["sidecar"]`. The original reason for `sidecar` was to avoid the embedded-artwork OGG path — `[]` also avoids it while genuinely disabling artwork. However, this changes the device under test (no-artwork vs sidecar-artwork), which may mask future sidecar regressions in the codec smoke tests.

**Option C (follow-up, not a blocker):** Also fix `MusicPresenter.executeSync` to pass `artwork: config.effectiveArtwork` to `executor.execute()`, so `artwork = false` in config is fully honoured end-to-end.

Option A is the right first fix. Option C is worth a separate small PR.

## Introduced by

Commit `9465faf9` (feat(core): sidecar device-write for sidecar-primary devices, TASK-370).

## Files to change

- `test-packages/e2e-tests/src/features/codec-preference.test.ts` — restrict `findMusicFiles` to audio extensions (Option A)
- Optionally: `packages/podkit-cli/src/commands/music-presenter.ts` — forward `artwork` option in `executeSync` (Option C)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both codec-preference e2e tests pass: 'syncs FLAC to Opus when codec preference is opus-first' and 're-syncs with new codec when codec preference changes from AAC to Opus'
- [ ] #2 findMusicFiles (or its replacement) counts only audio files, not device-side metadata files like cover.jpg
- [ ] #3 No other e2e tests regress
<!-- AC:END -->
