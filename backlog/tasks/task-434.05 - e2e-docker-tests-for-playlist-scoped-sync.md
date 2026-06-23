---
id: TASK-434.05
title: 'e2e:docker tests for playlist-scoped sync'
status: Done
assignee: []
created_date: '2026-06-23 19:05'
updated_date: '2026-06-23 21:15'
labels:
  - collections
  - subsonic
  - testing
  - e2e
dependencies:
  - TASK-434.01
  - TASK-434.02
  - TASK-434.03
  - TASK-434.04
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
modified_files:
  - test-packages/e2e-tests/src/workflows/playlist-scoped-sync.docker.test.ts
parent_task_id: TASK-434
ordinal: 179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-server end-to-end coverage against a live Navidrome container, using the playlist-seeding harness from task-434.02. See RFC doc-049 — do not duplicate. Gated on Docker like the other *.docker.test.ts files (run via `bun run test:e2e:docker`).

Scenarios (PRD testing items 5-8):
- Real playlist sync: seed a library, create a "Workout" playlist over a subset of tracks, sync a playlist-scoped collection, assert ONLY the playlist's tracks land on the device (the rest of the library does not).
- Missing playlist aborts: point a collection at a non-existent playlist name; assert the sync aborts before transfer with the typed not-found error and transfers nothing.
- Empty playlist, headless: seed an empty named playlist; run the sync non-interactively; assert it aborts non-zero and leaves the device untouched, and that --yes / allowEmptyPlaylist lets it proceed.
- `collection info` against a real server: assert it reports the resolved playlist with its real track count (and MISSING / AMBIGUOUS where applicable).

Validates PRD user stories 1, 6, 8, 11, 12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Real playlist sync test: only the playlist's tracks land on the device
- [x] #2 Missing-playlist test: sync aborts before transfer, nothing transferred
- [x] #3 Empty-playlist headless test: aborts non-zero, device untouched; override proceeds
- [x] #4 `collection info` test reports the real resolved track count against a live server
- [x] #5 Tests are Docker-gated (*.docker.test.ts) and pass under `bun run test:e2e:docker`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Test file: test-packages/e2e-tests/src/workflows/playlist-scoped-sync.docker.test.ts

## Strengthened per code review (B1/B2/S1/S2/N2/N3) — strict-subset identity proof

**Scenario 1 — Real playlist sync (B1):** Now proves ONLY the playlist's tracks land, by identity:
- Exact count: `expect(onDevice).toBe(workoutTrackCount)` (was `>0 && <library` — an oversync that landed most-but-not-all would pass).
- Identity: `target.getTracks()` titles sorted == expected playlist titles sorted (MULTISET — duplicates preserved, since fixtures repeat titles across formats).
- Anti-oversync: a known non-playlist (complement) track title is asserted ABSENT from the device.
- Parses the multi-blob sync stdout via `splitJsonObjects` and reads the summary blob (`runCliJson` returns null on multi-blob).

**Scenario 2 — Missing playlist aborts:** unchanged behavior; exit 2, per-collection error blob references "playlist", summary `completed: 0`.

**Scenario 3 — Empty playlist guard (B2 + S1):**
- B2: EMPTY_PLAYLIST_ABORT assertion is now UNCONDITIONAL — parse stdout, assert `success===false` AND `code==='EMPTY_PLAYLIST_ABORT'` (was nested in `if (stdout.startsWith('{') && code)` and silently skippable).
- --yes override test retained (exit 0, success).
- S1 NEW config-override test: `allowEmptyPlaylist = true` in config (TOP LEVEL TOML, no --yes) → exit 0 + success. Genuinely proves "proceeded" (exit 0 + success:true), distinct from a silent abort. This exercises the daemon's config mechanism, which a prior session fixed in loader.ts mergeConfigs (the key was parsed but never merged). The test passes against that fix.

**Scenario 4 — collection info (S2 + N2):**
- S2: `playlistTrackCount` pinned to `toBe(workoutTrackCount)` (was `>0`).
- N2: OK text assertion tightened to `/OK,\s*\d+\s*track/` (was loose `toContain('OK')`).

**S1 TOML fix:** `allowEmptyPlaylist = true` is now emitted at the TOP LEVEL of the generated config (before `[music.workout]`), not inside `[defaults]` — the loader reads `parsed.allowEmptyPlaylist`, so the prior `[defaults]` placement was dead/ignored.

**N3:** `beforeAll` asserts `allSongIds.length >= 2` so a too-small library fails as a clear setup error.

## Flakiness root cause + fix (test-infra only, no product change)

`startNavidromeContainer` returns after `minAlbums` (1) are scanned, but Navidrome keeps indexing the rest of the library asynchronously and REASSIGNS song ids mid-scan. Snapshotting ids mid-scan gave non-deterministic counts (3 / 11 / 70) and orphaned playlist entries (resolving to 0 tracks → empty-guard aborted the "real sync"; collection info showed MISSING). Hardening added (all in the test file):
- `waitForStableSongCount(container)` — polls `listSongIds()` until the count is stable across consecutive reads before seeding.
- `verifyPlaylistsVisible(...)` — asserts `getPlaylists` returns both seeded playlists before tests run (clear setup error otherwise).
- `waitForPlaylistTrackCount(...)` — polls `getPlaylist(id)` entry count after creation (WAL-commit guard).
- `selectWorkoutSubset(...)` — chooses the subset plus a complement song whose title is DISTINCT from all subset titles, so the absence check isn't defeated by duplicate-title fixtures.

Note: an earlier attempt to fetch song titles via Navidrome `getSong` failed (`status: failed` for album-scoped ids) — titles are instead enumerated via `getAlbumList2`→`getAlbum` (same path as `listSongIds`). Title-fetch is deferred until after `createPlaylist` to avoid a request-burst interaction.

## Docker run result

9 tests, all passing. Verified across multiple repeated isolated runs (each `Library: 70 songs`, ~8s/run). One transient batch-failure observed only when running 4 docker suites back-to-back (Docker resource contention, all scenarios fast-fail ~450ms) — not reproducible in isolation; the beforeAll setup guards surface any genuine container-unavailability as a clear setup error rather than a confusing assertion failure.

Quality gates: `bun run typecheck` ✓, `bun run lint` ✓.

## No product bug surfaced by the strengthened assertions

The strengthened S1 config-override path passes because the `allowEmptyPlaylist` mergeConfigs fix is already in loader.ts (prior session, see Final Summary). No assertion in this change surfaced a NEW product bug. Pre-existing product issues (multi-blob `--json` output; exit-code asymmetry 1 vs 2) are filed separately (task-435, draft-016) and are relied upon by the test, not fixed here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
e2e:docker tests for playlist-scoped sync — 9 tests, stable green across repeated runs against a live Navidrome + dummy iPod. Covers: real playlist sync (strict identity — only playlist tracks land, complement absent, titles compared as a multiset), missing playlist aborts (exit 2, nothing transferred), empty playlist headless aborts non-zero, --yes override proceeds, allowEmptyPlaylist CONFIG override proceeds, collection info OK+count / MISSING.

Review (Sonnet) fix-then-ship + hardening surfaced and fixed real issues:
- PRODUCT BUG (story 13): `allowEmptyPlaylist` config/env override was parsed into PartialConfig but never carried through `mergeConfigs` — so the daemon's config-level override silently did nothing (only --yes worked). Fixed in loader.ts mergeConfigs + added merge-level regression tests in loader.test.ts (the existing unit tests only exercised loadConfigFile parse, not the merge — which is why it slipped). Filed-adjacent.
- e2e flakiness root cause: startNavidromeContainer returns after minAlbums, but the scan keeps running and Navidrome reassigns song ids mid-scan, orphaning a playlist seeded from early ids (resolved to 0 tracks). Fixed by waiting for song-count stability before seeding + polling getPlaylist(id) entry count after creation.
- Title-collision in synthetic fixtures (repeated titles) handled by selecting a complement whose title is distinct from the subset and comparing on-device titles as a multiset.

Surfaced two pre-existing product issues, filed as task-435 (sync --json emits concatenated JSON objects) and draft-016 (sync exit-code asymmetry 1 vs 2).
<!-- SECTION:FINAL_SUMMARY:END -->
