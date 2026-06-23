---
id: TASK-434.01
title: Core playlist-scoped sync (schema + resolver + adapter)
status: Done
assignee: []
created_date: '2026-06-23 19:04'
updated_date: '2026-06-23 19:34'
labels:
  - collections
  - subsonic
  - sync
dependencies: []
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
modified_files:
  - packages/podkit-core/src/adapters/subsonic/playlist.ts
  - packages/podkit-core/src/adapters/subsonic/playlist.test.ts
  - packages/podkit-core/src/adapters/subsonic.ts
  - packages/podkit-core/src/adapters/subsonic.test.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/adapters/index.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/loader.test.ts
  - packages/podkit-cli/src/utils/source-adapter.ts
  - packages/demo/src/mock-core.ts
  - .changeset/playlist-scoped-subsonic-collections.md
parent_task_id: TASK-434
ordinal: 175000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core tracer bullet for playlist-scoped Subsonic collections. See RFC doc-049 for full design — do not duplicate.

End-to-end behavior: a `subsonic` music collection with `playlist = "<name>"` syncs only that named server playlist's tracks to the device, reusing the same server connection (creds duplicated). A missing or ambiguous playlist name aborts the sync before any transfer.

Cuts through all layers:
- Schema: add optional `playlist?: string` to the music collection config type + raw/config-file type. Parse validation: only valid on `type = "subsonic"`; reject on a directory collection.
- Resolver (deep module): given an injected Subsonic API + playlist name, return `{ id, tracks }`. Name match — 0 → PlaylistNotFoundError, 2+ → AmbiguousPlaylistError, 1 → fetch via getPlaylist. Typed errors mirror SubsonicConnectionError. Reuse the existing song→CollectionTrack mapper.
- Adapter wiring: when `playlist` set, connect() additionally resolves+validates (aborts before transfer on failure); getItems() returns the playlist's tracks instead of the whole-library scan. Existing in-memory getFilteredItems (artist/album/genre/year) layers on top unchanged.

Covers PRD user stories 1, 2, 3, 4, 8, 9, 10, 14, 15, 16.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `playlist` field added to music collection config + raw type
- [x] #2 Parse rejects `playlist` on a directory (non-subsonic) collection with a clear error
- [x] #3 Resolver returns {id, tracks} for exactly one name match
- [x] #4 Resolver throws PlaylistNotFoundError on zero matches and AmbiguousPlaylistError on 2+ matches (typed, SubsonicConnectionError-style)
- [x] #5 connect() resolves+validates the playlist and aborts before any transfer on failure
- [x] #6 getItems() returns only the playlist's tracks when `playlist` is set, full library when not
- [x] #7 CLI track filters still apply on top of playlist scope
- [x] #8 Resolver unit tests (0/1/many), config parse test, and adapter integration test (mock API) pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented core playlist-scoped Subsonic sync per doc-049.

**Resolver (deep module):** `packages/podkit-core/src/adapters/subsonic/playlist.ts`. Public interface `resolvePlaylist(api, name, mapEntry): Promise<{ id, tracks }>`. Decoupled from the adapter's network/cache internals via two injected collaborators: a structural `PlaylistApi` (only `getPlaylists`/`getPlaylist`) and a `PlaylistEntryMapper` callback. A compile-time `extends` assertion pins that the real `SubsonicAPI` satisfies `PlaylistApi`. Name match is exact + case-sensitive (per RFC: 0 → `PlaylistNotFoundError`, 2+ → `AmbiguousPlaylistError`, 1 → `getPlaylist` + map entries). Typed errors mirror `SubsonicConnectionError`: clear actionable messages plus relevant fields (`playlistName`, `availablePlaylists` / `matchingIds`).

**Mapper sharing (refactor-as-you-go):** Playlist entries are bare `Child[]` with no album object, so `mapSongToTrack(song, album)` was changed to `mapSongToTrack(song, album?)`. Album-level fields now fall back to the song's own fields (`song.album`, `song.artist`, etc.) when no album is supplied; added an `'Unknown Album'` fallback for the new path. The adapter passes `(entry) => this.mapSongToTrack(entry)` to the resolver, so playlist tracks go through the exact same mapping (artwork classification, ReplayGain, codec detection) as library tracks — no duplication.

**Adapter wiring:** Added `playlist?: string` to `SubsonicAdapterConfig`. `connect()` resolves+validates after the ping/placeholder probe when `playlist` is set, storing resolved tracks on the instance; the typed resolver errors are intentionally NOT caught, so they abort the sync before any transfer. `getItems()` returns the resolved playlist tracks when scoped, else the whole-library scan (unchanged). `getFilteredItems`/`applyFilter` are untouched and layer on top of whichever set `getItems()` returns. `disconnect()` clears the new `playlistTracks` field. Resolver + errors exported from core's index and adapters/index.

**Config:** `playlist?: string` added to `MusicCollectionConfig` and `ConfigFileMusicCollection`. `parseMusicCollections` rejects `playlist` on any non-subsonic collection at parse time (clear error), validates it is a string on subsonic, and passes it through. Env-var parity: appended `PLAYLIST` to `MUSIC_COLLECTION_FIELDS` and emit `playlist` in the subsonic branch of `loadEnvCollections` (`PODKIT_MUSIC_{NAME}_PLAYLIST`). CLI→core wiring: `createSubsonicAdapterFromConfig` in `source-adapter.ts` forwards `config.playlist`.

**Tests (external behaviour only):** resolver unit suite (0/1/2+ matches, empty-entry playlist, case-sensitivity, missing-array) next to playlist.ts; adapter integration suite in subsonic.test.ts using an in-memory fake api (connect() throws on missing/ambiguous; getItems() returns playlist-only vs full library; getFilteredItems layers on playlist scope); config parse tests (subsonic-with-playlist parses, directory-with-playlist rejected, env named subsonic with playlist).

**Deviation:** also mocked the three new value exports in packages/demo/src/mock-core.ts — the demo package has a static exhaustiveness check (`mock-core.check.ts`) requiring mock-core to export every value @podkit/core exports. Required to keep `bun run typecheck` green; no behaviour change.

**Changeset:** `.changeset/playlist-scoped-subsonic-collections.md` (`@podkit/core`: minor). No CLI changeset (ships as binary).

Quality gates (repo root): typecheck PASS, lint PASS, build PASS, `test --filter @podkit/core` PASS (3255 pass / 0 fail), `test --filter podkit` PASS (CLI pkg name is `podkit`; unit+integration, 0 fail).

**Post-implementation review fixes applied (B-1, S-1, S-2, S-3, S-5):**

**B-1 — Corrupt state machine fix (`subsonic.ts` `connect()`):** Moved `this.connected = true` from inside the ping `try` block to the very end of `connect()`'s successful path. Ping failure and playlist-resolution failure both throw before reaching it, so the adapter can never be observed as `connected === true` while `playlistTracks` is `null`. Also added an explicit invariant guard in `getItems()`: if `playlistName` is set but `playlistTracks` is null, it throws `'playlistTracks is null after successful connect() — this is a bug in SubsonicAdapter'` (unreachable in practice, makes the invariant visible). Test added: after a `connect()` that throws `PlaylistNotFoundError`, a follow-up `getItems()` also rejects (via re-connect re-throwing), proving the adapter is not left in a silently-usable state.

**S-1 — Empty/blank playlist rejected at parse time (`loader.ts`):** Extended the subsonic `playlist` validation from `typeof !== 'string'` to also check `.trim() === ''`. Error message changed to `Invalid "playlist" in [music.${name}]: must be a non-empty playlist name.` Two new loader tests: empty string (`playlist = ""`) and whitespace-only (`playlist = "   "`) both throw.

**S-2 — Reconnect coverage (`subsonic.test.ts`):** Added test: playlist-scoped adapter `connect()` → `disconnect()` → `connect()` again → `getItems()` returns the playlist tracks. Proves `disconnect()` clears `playlistTracks` and reconnect re-resolves.

**S-3 — Mock error class typed-field parity (`mock-core.ts`):** `PlaylistNotFoundError` now mirrors the real class exactly: `constructor(playlistName: string, availablePlaylists: string[])` with `readonly playlistName` and `readonly availablePlaylists`, and identical message shape. Same for `AmbiguousPlaylistError`: `constructor(playlistName: string, matchingIds: string[])` with `readonly playlistName` and `readonly matchingIds`. Needed so the display task (434.04) can reliably access those fields on caught errors.

**S-5 — Env path rejects PLAYLIST on a directory collection (`loader.ts`):** The file parser already rejected `playlist` on a directory collection, but the env-var path silently dropped `PODKIT_MUSIC_{NAME}_PLAYLIST` for directory-type collections. Added a `throw new Error(...)` in the directory branch of `loadEnvCollections` when `fields.PLAYLIST` is set, matching the file-parser's error style. Two new loader tests: unnamed default directory + PLAYLIST, and a named directory collection + PLAYLIST.

Quality gates after fixes: typecheck PASS, lint PASS, build PASS, `test --filter @podkit/core` PASS (3257 pass / 0 fail), `test --filter podkit` PASS (0 fail).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented playlist-scoped Subsonic collections core: `playlist?` field on music collection config (file + env), reject on non-subsonic collections (file + env paths) and reject empty/blank names. New deep module `subsonic/playlist.ts` (`resolvePlaylist` + typed `PlaylistNotFoundError`/`AmbiguousPlaylistError` mirroring `SubsonicConnectionError`). Adapter wiring: `connect()` resolves+validates the playlist (aborts before transfer; `connected=true` only set after full success), `getItems()` returns only playlist tracks when scoped, shared `mapSongToTrack` (album-optional). Changeset `@podkit/core` minor. Review (Sonnet) fix-then-ship: fixed B-1 corrupt-state, S-1 empty-name parse, S-2 reconnect test, S-3 mock field parity, S-5 env directory rejection. All gates green (typecheck/lint/build/core+cli tests).
<!-- SECTION:FINAL_SUMMARY:END -->
