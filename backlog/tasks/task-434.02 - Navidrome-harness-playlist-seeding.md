---
id: TASK-434.02
title: 'Navidrome harness: playlist seeding'
status: Done
assignee: []
created_date: '2026-06-23 19:04'
updated_date: '2026-06-23 19:34'
labels:
  - collections
  - subsonic
  - testing
dependencies: []
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
modified_files:
  - test-packages/e2e-tests/src/docker/navidrome.ts
  - >-
    test-packages/e2e-tests/src/workflows/navidrome-playlist-seeding.docker.test.ts
parent_task_id: TASK-434
ordinal: 176000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Shared test-infra slice. See RFC doc-049 for context — do not duplicate. No dependency on the feature code; can land in parallel with the core slice.

Extend the existing live Navidrome container helper (prior art: the startNavidromeContainer harness used by test-packages/e2e-tests subsonic docker tests) with playlist-seeding capability:
- Create a named playlist holding a chosen set of seeded tracks, via the Subsonic `createPlaylist` endpoint, after the library scan completes.
- Support seeding an empty named playlist (zero tracks) so the headless empty-playlist abort path can be exercised against a real server.

This is reusable infrastructure for the e2e:docker tests slice and future playlist work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Navidrome container helper exposes a way to create a named playlist over seeded tracks after scan
- [x] #2 Helper supports creating an empty (zero-track) named playlist
- [x] #3 Seeded playlist is retrievable via the Subsonic getPlaylists/getPlaylist API from a test
- [x] #4 No dependency on feature code — usable standalone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `listSongIds()` and `createPlaylist(name, songIds)` to the `NavidromeContainer` interface in `test-packages/e2e-tests/src/docker/navidrome.ts`.

**`createPlaylist` signature:**
```ts
createPlaylist(name: string, songIds: string[]): Promise<{ id: string }>
```

**`listSongIds` signature:**
```ts
listSongIds(): Promise<string[]>
```

**How a test obtains song ids:** Call `container.listSongIds()` after the container starts. Internally this paginates `getAlbumList2 → getAlbum` (same pattern as the SubsonicAdapter) and collects all song ids. Tests can then pass a subset to `createPlaylist`.

**Empty playlists:** Passing `songIds: []` works with Navidrome — the server creates a playlist with `songCount: 0` and no `entry` field in the JSON response. `getPlaylist` for an empty playlist returns `{ id, name, songCount: 0 }` with no `entry` key (not even `entry: []`). The helper handles this without any special-casing.

**Navidrome quirk:** `createPlaylist` can transiently fail with "Internal Server Error: file is not a database" immediately after a library scan (SQLite write contention). Added retry logic (5 attempts, 500ms × attempt backoff) for both HTTP 5xx and Subsonic `status: 'failed'` responses.

**URL construction:** Uses `URLSearchParams.append` to repeat the `songId` parameter for each song id, matching the Subsonic REST spec. The `subsonicUrl` helper (already private in navidrome.ts) is reused for auth params.

**New test file:** `test-packages/e2e-tests/src/workflows/navidrome-playlist-seeding.docker.test.ts` — 3 tests: `listSongIds` returns ids after scan, named playlist is created with exact tracks, empty playlist is created with zero tracks. Both playlist tests verify via `getPlaylist` that the server returns the expected shape.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended the live Navidrome test-container helper (`docker/navidrome.ts`) with `listSongIds()` (paginates getAlbumList2→getAlbum like the production adapter) and `createPlaylist(name, songIds[])` (Subsonic createPlaylist; empty playlist supported via empty songIds, reads back zero entries). Retry restricted to HTTP 5xx (Navidrome post-scan SQLite contention); 4xx and Subsonic status!=ok throw immediately; getAlbum failures no longer silently swallowed. New docker test `navidrome-playlist-seeding.docker.test.ts` proves non-empty + empty seeding via getPlaylists/getPlaylist. Test-infra only; no feature code touched. Review (Sonnet) fix-then-ship items applied (Haiku). Typecheck/lint green, docker test 3/3 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
