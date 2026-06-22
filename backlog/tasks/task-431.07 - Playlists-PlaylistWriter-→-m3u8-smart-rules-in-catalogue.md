---
id: TASK-431.07
title: Playlists (PlaylistWriter → m3u8 + smart rules in catalogue)
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 17:01'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.03
  - TASK-431.06
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `PlaylistWriter`: emit `Playlists/<name>.m3u8` with relative paths into the archive tree, skipping the master/library playlist. Smart playlists are emitted as their resolved track list in M3U, with the rules preserved in `library.sqlite` (the `smart_playlist_rules` table from the catalogue slice).

Spec: doc-047 (Stage 2 — playlists; PlaylistWriter).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each non-master playlist emitted as Playlists/<name>.m3u8 with relative paths resolving into the tree
- [x] #2 Master/library playlist is skipped
- [x] #3 Smart playlists emit resolved track list as M3U; rules persisted in library.sqlite
- [x] #4 PlaylistWriter tested for m3u8 content and master-skip behaviour
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PlaylistWriter implemented in packages/ipod-archive/src/playlist-writer.ts and wired into run-transform.

What it does:
- writePlaylists({ db, playlists, pathMap, archiveDir }) emits one UTF-8 .m3u8 per non-master playlist into <archiveDir>/Playlists/. Master/library playlist is skipped (filtered by isMaster). Playlists/ dir is created only when >=1 non-master playlist exists.
- m3u8 format: #EXTM3U header, then per ordered member either an `#EXTINF:<wholeSeconds>,<artist> - <title>` line + the track path, or (for an un-exported member) a `# skipped (no exported audio): <title>` comment IN THE POSITION it held. Trailing newline. Never emits a dangling path; never aborts.
- Paths are RELATIVE from Playlists/ to the archive file: posix.join('..', exportedPath) → ../Music/<AlbumArtist>/<Album>/NN Title.ext. Always POSIX separators. playlistRelativePath throws a typed IpodArchiveError('PLAYLIST_PATH_INVALID') if exportedPath is absolute (would otherwise leak past posix.join) — caught per-playlist as a failure.
- Track resolution via the shared pathMap (dbid→exportedPath). exportedPath null or absent → skipped.
- Smart playlists emit their RESOLVED track list. Members come from getPlaylistTracks (materialised order) and fall back to evaluateSmartPlaylist when the materialised list is empty (the test harness never materialises smart-playlist membership). Rules are NOT written here — they remain in library.sqlite (smart_playlist_rules) from the catalogue slice.
- Filename collisions: uniquePlaylistBaseName sanitises with sanitizePathSegment, falls back to 'Playlist' for empty, and disambiguates a colliding sanitised name by appending ` [<id>]` then ` (<n>)` deterministically.

DRY: run-transform now reads db.getPlaylists() ONCE after the track loop and threads the array into BOTH writeLibraryDb (new required `playlists` option; it no longer self-fetches) and writePlaylists. TransformResult gains playlistsWritten: WrittenPlaylist[] and playlistFailures: PlaylistFailure[].

Constraints honoured: leaf package (no @podkit/core, no @podkit/ipod-db), typed errors, no console/stderr in lib code (GLib-CRITICAL noise in tests is native libgpod's smart-playlist evaluation, not our code), Ipod casing, no task-ID refs in code/tests.

Tests:
- Unit (playlist-writer.test.ts): playlistRelativePath (POSIX + absolute-path throw), trackExtinf (rounding/clamp/null coercion), serializePlaylistM3u8 (exact strings, in-position skip, empty/all-skipped), uniquePlaylistBaseName (free/collision-by-id/empty/null/index-walk).
- Integration (playlist-writer.integration.test.ts): seeds master + ordered manual playlist (B, no-audio, A) + smart 'Rock Only' + smart 'Nothing Matches'. Asserts: no m3u8 for master; one .m3u8 per non-master with #EXTM3U; manual order + relative ../Music paths that resolve to files that exist in the archive; #EXTINF lines; no-audio member skipped in position (no dangling path); smart playlist lists resolved tracks (excludes the podcast); empty-resolving smart playlist → header-only file; runTransform result reports playlistsWritten/playlistFailures.

Quality gates (all pass):
- bun run build --filter @podkit/ipod-archive --filter podkit → 12 tasks successful (includes tsc typecheck)
- bun run lint → 0 warnings/0 errors
- bun run test:unit --filter @podkit/ipod-archive → 145 pass / 0 fail
- bun run test:integration --filter @podkit/ipod-archive → 45 pass / 0 fail

Files: src/playlist-writer.ts (new), src/playlist-writer.test.ts (new), src/playlist-writer.integration.test.ts (new), src/run-transform.ts, src/library-db-writer.ts, src/errors.ts (new PLAYLIST_PATH_INVALID code), src/index.ts (exports).
<!-- SECTION:NOTES:END -->
