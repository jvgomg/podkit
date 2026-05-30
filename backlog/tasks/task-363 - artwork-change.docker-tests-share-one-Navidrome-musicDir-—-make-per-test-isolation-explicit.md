---
id: TASK-363
title: >-
  artwork-change.docker tests share one Navidrome musicDir — make per-test
  isolation explicit
status: Done
assignee:
  - claude
created_date: '2026-05-30 15:00'
updated_date: '2026-05-30 18:08'
labels:
  - testing
  - e2e
  - docker
  - test-isolation
dependencies: []
priority: low
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-359.01 first docker-e2e run failed `expect(syncJson?.result?.completed).toBe(1)` with received: 4.

## Symptom

`test-packages/e2e-tests/src/features/artwork-change.docker.test.ts` declares one `musicDir` and one Navidrome container in `beforeAll`. Three tests run sequentially in that suite:

1. **artwork-updated** — syncs the goldberg fixture, replaces artwork in source, asserts artwork-updated detected.
2. **artwork-removed** — restores goldberg artwork (between-test setup), strips it again, asserts artwork-removed detected.
3. **artwork-added** — copies a dual-tone track into the same musicDir, asserts artwork-added detected for the new track.

The iPod target is fresh per test (`withTarget`), but the Subsonic library is shared. When the artwork-added test does its initial sync to verify the dual-tone is present, the iPod also receives the 3 goldberg tracks still in the library — so `completed` is 4, not 1.

This made the test's "initial sync count" assertion permanently fuzzy and forced TASK-359.01 to revert that assertion to a loose `>= 1` with a comment.

## Why it matters

- Order-dependent test counts hide real regressions (a goldberg track silently disappearing wouldn't fail any assertion).
- The shared library means "artwork-added detection" tests are entangled with whatever state earlier tests left behind.
- The artwork-added test's `breakdown['artwork-added'] === 1` works *only because* the engine doesn't see artwork changes on goldberg between syncs. If the artwork-updated test left goldberg in a half-modified state, the next test's breakdown would silently include it.

## Options

1. **Per-test Navidrome.** Each `it` block creates its own `SubsonicTestSource`. Higher container startup cost but full isolation.
2. **Per-test subfolder under one musicDir.** Each test gets `<musicDir>/<testname>/...` and only its own subfolder is populated. One container, but tests see only their own files. Requires Subsonic config or library scoping to point at the subfolder.
3. **Explicit cleanup between tests.** `afterEach` removes everything except a known base set, then restarts Navidrome. Closest to current shape; brittle.

Option 2 is the cleanest if Subsonic supports scoping; otherwise option 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each test in `artwork-change.docker.test.ts` sees only its own fixture set in the Subsonic library.
- [x] #2 Test order does not affect any assertion in the suite.
- [x] #3 The artwork-added test's initial-sync `completed` count can be asserted exactly (`=== 1`) without a justifying-range comment.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude): Implemented option 3 from the task body (beforeEach + per-test population), not option 1 (per-test container) — same isolation, no container-startup cost. Added a `beforeEach` calling `resetMusicDir()` (wipes musicDir contents); each test populates only the fixtures it needs at the top of its body. Removed the now-unused `restoreArtworkInFixtures` helper that existed only to undo prior-test state. Renumbered the artwork-removed test's steps (7 → 6) since the restore step is gone.

First attempt failed: I tried starting Navidrome with an empty musicDir + `minAlbums: 0`. The waitForLibraryScan helper's `albums && albums.length >= 0` check requires `albums` to be a truthy array, but Navidrome returns no `album` field when the library is empty — never satisfies. Reverted to keeping `createArtworkFixtures(musicDir)` in beforeAll (so Navidrome's initial scan has something to index), with beforeEach wiping that fixture before every test. Each test then populates fresh fixtures + restarts Navidrome.

Sonnet pre-commit review flagged port-sequencing as a potential race (config created with stale port) but verified my implementation is safe: tests that need a config call `restartNavidrome()` BEFORE `createArtworkCheckConfig(serverPort)`, so the port is current. It also confirmed Navidrome's `restart()` wipes the dataDir internally so no artwork-cache state survives between tests. Three P3 tightenings unlocked by clean isolation: (1) preChangeUpdates → exact 0, (2) artwork-added apply completed → exact 1. Applied both. Skipped a third (baseline-pass completed count) as speculative.

Net runtime: 3 tests in 35s (was 128s before). The faster runtime is from removing one full sync per test (the explicit restoreArtworkInFixtures + restartNavidrome in the artwork-removed test) and not the isolation itself — beforeEach wipe + restart adds time but offsets cleanly.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Each test in `artwork-change.docker.test.ts` now sees only its own fixture set in Navidrome, regardless of run order. The artwork-added test's `completed === 1` assertion is tight again (was forced to `>= 1` in TASK-359.01 because earlier tests' goldberg fixtures were still in the shared library).

## Approach

Option 3 from the task body (cleanup between tests), not option 1 (per-test container):

- Added a `beforeEach` calling `resetMusicDir()` (wipes musicDir contents).
- Each test populates only the fixtures it needs at the top of its body via `createArtworkFixtures(musicDir)` + `await restartNavidrome()`.
- The artwork-added test populates only the dual-tone track (no goldberg) so `completed === 1` is now exact.
- Removed the now-unused `restoreArtworkInFixtures` helper that existed only to undo prior-test state.

Kept `createArtworkFixtures(musicDir)` in `beforeAll` so Navidrome's initial scan has at least one album to index — `waitForLibraryScan` doesn't handle an empty library well (the truthy-array check fails when no `album` field is returned).

## Coverage tightenings unlocked by clean isolation

- artwork-updated Step 2 verify: `preChangeUpdates → expect(0)` (was logged but not asserted).
- artwork-added Step 5 apply: `completed → expect(1)` (was only exitCode asserted).

## Tests

- `bun run typecheck --filter @podkit/e2e-tests` ✓
- `bunx oxlint` on touched file ✓
- `bun run test:e2e:docker --filter @podkit/e2e-tests -- artwork-change` → 3/3 pass (35s, was 128s before)
- Full `bun run test:e2e:docker` → 4/4 pass

## Pre-commit review

Sonnet verified the port-sequencing was safe (no race between restartNavidrome and createArtworkCheckConfig), confirmed Navidrome's `restart()` wipes the dataDir internally so no artwork-cache state survives between tests, and surfaced the three P3 tightenings I applied.
<!-- SECTION:FINAL_SUMMARY:END -->
