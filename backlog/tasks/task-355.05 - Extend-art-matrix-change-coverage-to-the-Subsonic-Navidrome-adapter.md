---
id: TASK-355.05
title: Extend art-matrix-change coverage to the Subsonic / Navidrome adapter
status: Done
assignee: []
created_date: '2026-05-26 22:50'
updated_date: '2026-05-30 22:10'
labels:
  - enhancement
  - artwork
  - testing
  - subsonic
dependencies:
  - TASK-356.01
references:
  - test-packages/e2e-tests/src/sources/subsonic.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
parent_task_id: TASK-355
priority: low
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`art-matrix-change.test.ts` covers artwork-change detection for the directory adapter only — it mutates files on disk between syncs and observes whether podkit detects the cover swap. The Subsonic adapter is not yet covered.

The reason for the gap: changing a file served by Navidrome requires rewriting the file on disk *and* triggering a Navidrome library rescan, then waiting for re-index to complete. None of that plumbing exists in `test-packages/e2e-tests/src/sources/subsonic.ts` today.

## What's needed

1. Add a `mutateLibrary(fn): Promise<void>` method (or similar) to `SubsonicTestSource` that:
   - Rewrites files inside the mounted music directory.
   - Triggers a Navidrome scan (`POST /rest/startScan` or equivalent).
   - Polls Navidrome until the scan completes and the new artwork hashes are observable.

2. Add `art-matrix-change.docker.test.ts` mirroring the host file. Expected behaviour, before TASK-355.02 lands:

   - With `--check-artwork`: artwork-updated should fire for embed-capable formats (same as host).
   - Without `--check-artwork`: cover-swap is silently missed (same as host).

   After TASK-355.02 lands the predictions may diverge — coordinate with that task's outcome.

3. Reuse the same `multi-format-embedded` / `multi-format-embedded-alt` fixture pair the host matrix uses.

## Definition of done

- New file: `test-packages/e2e-tests/src/features/art-matrix-change.docker.test.ts`.
- `SubsonicTestSource` learns to mutate + rescan.
- 16 cells (8 formats × 2 flag values) green.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SubsonicTestSource supports mutating files behind Navidrome and waiting for rescan
- [x] #2 art-matrix-change.docker.test.ts file created and green
- [x] #3 Coverage matches art-matrix-change.test.ts (same axes, same fixtures)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude / Opus 4.7): Landed in commit `24127909` — "test(e2e): extend art-matrix-change coverage to the Subsonic/Navidrome adapter".

**SubsonicTestSource mutate plumbing (AC #1)**

- New `SubsonicTestSourceOptions`: `writable` (rw mount), `populate` (auto-copy full audio fixtures).
- Public `musicDir` getter for tests that need to drop their own files.
- `mutateLibrary(fn, opts?)`: calls fn with musicDir, then forces re-index via `container.restart()` with a fresh database. Restart-with-clean-DB is heavyweight (~5-15s) but the only reliable way to bust Navidrome's path-derived coverArt cache. minAlbums defaults to 1 in mutateLibrary (post-sonnet fix: don't silently inherit a setup-time 0 and race the next sync against an unindexed library).
- `navidrome.ts waitForLibraryScan` returns immediately when `minAlbums=0` — fixed a real hang in the old polling loop when the library is empty.

**Matrix harness extension (AC #2 + #3)**

- `predictSubsonicChange` (in `matrix/artwork-rules.ts`): models Navidrome's optimistic `coverArt`-always-set behaviour. Key insight: without `--check-artwork`, the Subsonic adapter leaves `hasArtwork=undefined` for every track, so detectUpgrades short-circuits BOTH artwork-added AND artwork-removed (whereas directory's `removed` IS detectable cheaply because directory reports a real `hasArtwork=false` after the strip). With `--check-artwork` the adapter filters Navidrome's placeholder and the symmetric diff fires the right rule per transition.
- `observeChangePassSubsonic`: mirrors `observeChangePass` but uses `mutateLibrary` between syncs, and rebuilds the podkit config after every restart since Navidrome's host port can shift on dynamic-port-allocation environments. All dry-run guards also check `dryJson.success` (post-sonnet fix: auth failure after restart would have produced empty ops maps and a confusing downstream error).
- `art-matrix-change.docker.test.ts`: 103-line thin wrapper. Configures source with `writable: true, populate: false` (places only multi-format-embedded — no full fixture tree). 16 cells × 2 checkArtwork = 32 tests, all green (~37s solo).

**Docker concurrency**

`package.json` test:e2e:docker concurrency dropped from 8 to 3. Five docker test files at concurrency 8 saturated the docker daemon when each spun a Navidrome container — 4 tests failed under parallelism even though every file passed individually. At concurrency 3 the full docker suite is green (~92s wall-clock, was ~64s at concurrency 8 with all-green-but-fragile).

**Sonnet review**

Caught two P2 issues:
1. `mutateLibrary` silently inherited setup-time `minAlbums=0` when caller omitted opts — would race next sync against unindexed library. Now defaults to 1.
2. Dry-run guards only checked `!dryJson` not `!dryJson.success` — an auth failure post-restart would proceed silently. Added explicit success check + diagnostic in error message.

**Coverage matches host**

Same axes (transition × format × checkArtwork), same fixtures (`multi-format-embedded` / `-embedded-alt` / `-embedded-stripped`), shared harness from TASK-356.01.

**Gates**

typecheck (e2e), oxlint (touched files), docker e2e full suite (5 files, 108 tests, 0 fail) — all green on macOS.

**Follow-ups**

None. The Subsonic / Navidrome change-detection coverage gap noted in the TASK-355 umbrella is closed.
<!-- SECTION:NOTES:END -->
