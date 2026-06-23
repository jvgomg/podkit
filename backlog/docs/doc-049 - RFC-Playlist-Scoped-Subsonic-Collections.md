---
id: doc-049
title: 'RFC: Playlist-Scoped Subsonic Collections'
type: specification
created_date: '2026-06-23 18:55'
updated_date: '2026-06-23 19:00'
tags:
  - rfc
  - collections
  - subsonic
  - sync
---
## Problem Statement

I sync music to my iPod from a Navidrome (Subsonic) server. Today a `subsonic` music collection pulls the **entire library**. I want to sync only a **specific playlist** on that same server — e.g. a "Workout" playlist — to a given device, without standing up a second server or re-modelling my config.

Concretely I need:

1. To see, in the music listing commands, that a collection is constrained to a playlist.
2. To configure that a given device syncs through that playlist-constrained collection.
3. To validate that the playlist actually exists on the server **before** a sync runs, so a typo or a deleted playlist doesn't silently sync the wrong thing.

The optimisation target is **simplicity** — the smallest change that satisfies the three requirements and fits the existing collection/device model.

## Solution

Add an optional `playlist` field to a `subsonic` music collection. A playlist-scoped collection is an ordinary named `[music.<name>]` block that re-declares its server connection (url/username, password via the existing env-var pattern) and adds one line:

```toml
[music.nav]
type = "subsonic"
url = "https://nav"
username = "james"

[music.workout]
type = "subsonic"
url = "https://nav"
username = "james"
playlist = "Workout"
```

A device targets the playlist-scoped collection the same way it targets any collection today — via `[defaults].music` or the `-c` flag. No new device→collection wiring is introduced.

When a collection carries `playlist`, its Subsonic adapter resolves the playlist **by name** on the server and syncs exactly that playlist's tracks (server-side `getPlaylist`), instead of scanning the whole library. The playlist is validated at sync start (sync aborts on a problem before any transfer) and can be inspected on demand via `podkit collection info`. The constraint is shown in `collection list`, `collection info`, and `collection music`.

A playlist that resolves to **zero tracks** is guarded: interactively the user is warned and must confirm; headlessly (daemon / non-TTY / `--json`) the sync aborts non-zero unless explicitly overridden — so an emptied playlist never silently wipes a device.

## User Stories

1. As a podkit user, I want to add `playlist = "Workout"` to a subsonic music collection, so that syncing that collection transfers only the playlist's tracks rather than my whole library.
2. As a podkit user, I want the playlist-scoped collection to reuse the same server URL and credentials as my full-library collection, so that I don't need a different server.
3. As a podkit user, I want to define multiple playlist-scoped collections against one server (Workout, Focus, Roadtrip), so that I can sync different playlists to different devices.
4. As a podkit user, I want a device to sync through a playlist-scoped collection via `[defaults].music` or `-c <name>`, so that I use the existing device/collection mechanism with no new concepts.
5. As a podkit user, I want `podkit collection list` to show a PLAYLIST column, so that I can see at a glance which collections are playlist-constrained.
6. As a podkit user, I want `podkit collection info <name>` to show the playlist name, whether it resolves, and its track count, so that I can validate the constraint without running a sync.
7. As a podkit user, I want `podkit collection music <name>` to annotate its heading with the playlist, so that I understand why the listed tracks are a subset of the server.
8. As a podkit user, I want a sync against a playlist-scoped collection to abort before transferring anything if the playlist does not exist on the server, so that a typo or deletion fails loudly instead of syncing the wrong set.
9. As a podkit user, I want a clear, typed error when the named playlist is not found, so that I know to fix the name or create the playlist.
10. As a podkit user, I want a clear, typed error when more than one playlist on the server shares the configured name, so that I disambiguate rather than silently syncing an arbitrary one.
11. As a podkit user running an interactive sync, I want to be warned and asked to confirm when the playlist resolves to zero tracks, so that I don't accidentally wipe my device's music.
12. As a podkit daemon operator, I want a zero-track playlist to abort the headless sync non-zero by default, so that an emptied playlist never silently deletes everything on the device.
13. As a podkit user who genuinely wants to sync an empty playlist, I want an explicit override (`--yes` for one-off, an `allowEmptyPlaylist` config key for the daemon), so that I can opt into the behaviour deliberately.
14. As a podkit user, I want `playlist` to be rejected at config-parse time on a non-subsonic (directory) collection, so that I get an early error instead of a silently ignored field.
15. As a podkit user, I want CLI track filters (`--artist`, `--album`, etc.) to still apply on top of the playlist scope, so that I can further narrow a playlist sync if needed.
16. As a podkit user, I want self-healing, artwork detection, and transcoding to behave exactly as they do for a full-library subsonic collection, so that playlist scoping only changes which tracks are in scope, nothing else.

## Implementation Decisions

**Model**
- The playlist constraint is a property of the **collection**, not the device. Devices reference it through the existing `[defaults].music` / `-c` mechanism. No per-device collection assignment is introduced.
- Server connection is **duplicated** in the playlist-scoped collection (no cross-collection reference / inheritance). Chosen for code and schema simplicity.

**Schema**
- Add optional `playlist?: string` to the music collection config type and its raw/config-file counterpart.
- Parse-time validation: `playlist` is only valid when `type = "subsonic"`. Setting it on a directory collection is a parse error.
- Playlist is referenced **by name**. (Id-based reference and server inheritance were considered and rejected for simplicity / config readability.)

**Playlist resolver (the deep module)**
- A self-contained resolver: given an injected Subsonic API client and a playlist name, returns `{ id, tracks }`.
- Resolution: list playlists, match by name. Zero matches → `PlaylistNotFoundError`. Two or more matches → `AmbiguousPlaylistError`. Exactly one → fetch full playlist via the server's `getPlaylist`.
- Errors are typed, following the existing `SubsonicConnectionError` precedent (typed-errors convention).
- Playlist songs are mapped to the existing collection-track shape using the adapter's current song→track mapper.

**Subsonic adapter wiring**
- When `playlist` is configured, `connect()` (which already pings the server) additionally resolves and validates the playlist — this is the at-sync-start validation; a failure aborts before any transfer.
- When `playlist` is configured, `getItems()` returns the resolved playlist's tracks (server-side fetch) instead of the whole-library scan.
- Existing in-memory `getFilteredItems` (artist/album/genre/year) layers on top unchanged.

**Empty-playlist guard**
- A pure decision function: `(trackCount, { interactive, yes }) → 'proceed' | 'confirm' | 'abort'`.
  - Non-empty → proceed.
  - Empty + interactive TTY → confirm (warn, then prompt via the existing yes/no confirm helper).
  - Empty + non-interactive (daemon / non-TTY / json) → abort non-zero, unless overridden.
  - Override: `--yes` (one-off) or an `allowEmptyPlaylist` config key (daemon).
- The guard is wired into the sync flow; the decision logic itself has no I/O.

**Display**
- `collection list`: add a PLAYLIST column (`-` when the collection has no playlist).
- `collection info`: show the playlist name plus resolution status (OK with track count / MISSING / AMBIGUOUS). For a playlist-scoped collection, `collection info` performs a network lookup to resolve — this is the explicit, on-demand validation surface.
- `collection music`: annotate the heading with the playlist name.
- `device music` is intentionally **not** modified: it reads the on-device database and has no link to the source collection; adding one is out of scope.

**Test harness (e2e:docker)**
- Extend the existing live Navidrome container helper with a **playlist-seeding** capability — create a named playlist holding a chosen set of seeded tracks (via the Subsonic `createPlaylist` endpoint) after the library scan completes. This is new harness code, not just a test, and is a prerequisite for real-server playlist coverage.
- Empty-playlist seeding (a named playlist with no tracks) must also be supported so the headless-abort path can be exercised against a real server.

**Unchanged**
- Device config schema, per-device collection assignment, the self-healing / artwork / transcoding pipeline. Playlist scoping only narrows the set of source tracks.

## Testing Decisions

A good test here exercises **external behaviour through a module's public interface**, not its internals: feed inputs, assert outputs/errors. For unit/integration, network is replaced by an injected fake Subsonic API and never hit for real; for e2e:docker, behaviour is asserted against a real Navidrome container. Prior art: `packages/podkit-core/src/adapters/subsonic.test.ts` (mock-API adapter tests), the config loader's table-style parse tests, and `test-packages/e2e-tests/src/workflows/subsonic-sync.docker.test.ts` (full sync against a live Navidrome container).

**Unit / integration (mock API, no network)** — all four modules:

1. **Playlist resolver** — the highest-value suite. Cases: name matches zero playlists → `PlaylistNotFoundError`; matches exactly one → returns `{ id, tracks }` with correct mapping; matches two or more → `AmbiguousPlaylistError`. Driven by a fake API returning canned playlist lists.
2. **Empty-playlist guard** — the pure decision function across its matrix: non-empty → proceed; empty + interactive → confirm; empty + headless → abort; empty + `yes` → proceed. No sync, no I/O.
3. **Config parse** — `playlist` on a `subsonic` collection parses; `playlist` on a `directory` collection is a parse error. Rides the existing config loader test suite.
4. **Adapter integration** — using the existing subsonic mock harness: `connect()` throws when the configured playlist is missing/ambiguous; `getItems()` returns only the playlist's tracks when `playlist` is set, and the full library when it is not.

**End-to-end (real Navidrome, `*.docker.test.ts`)** — added against a live container seeded via the new playlist-seeding harness:

5. **Real playlist sync** — seed a library, create a "Workout" playlist holding a subset of tracks, sync a playlist-scoped collection, assert **only** the playlist's tracks land on the device (and the rest of the library does not).
6. **Missing playlist aborts** — point a collection at a playlist name that does not exist on the server; assert the sync aborts before transfer with the typed not-found error and transfers nothing.
7. **Empty playlist, headless** — seed an empty named playlist; run the sync non-interactively (no TTY); assert it aborts non-zero and leaves the device untouched, and that `--yes` / `allowEmptyPlaylist` lets it proceed.
8. **`collection info` against a real server** — assert it reports the resolved playlist with its real track count (and MISSING / AMBIGUOUS where applicable).

Tests must not assert on private call sequences or internal state — only on returned tracks, thrown typed errors, parse results, guard decisions, on-device track sets, and process exit codes.

## Out of Scope

- Per-device collection assignment (a device block naming its own collection). Tracked separately; this RFC uses the existing defaults / `-c` mechanism.
- Cross-collection connection reuse / inheritance (a collection referencing another's server). Explicitly rejected here in favour of credential duplication.
- Referencing a playlist by id, or surviving server-side playlist renames.
- Showing the playlist constraint in `device music` (no source-collection link on the device DB).
- Playlist support for non-subsonic sources (directory collections have no playlist concept).
- Server-side combination of playlist scope with other Subsonic query filters (CLI filters remain in-memory, post-fetch).
- Smart/auto playlists, starred/favourites, or multi-playlist unions — only a single named playlist per collection.

## Further Notes

- Playlist-scoped fetch (`getPlaylist`) is both simpler and cheaper than the current whole-library scan, since the server returns exactly the playlist's songs.
- The duplicate-credentials decision means changing a server URL requires editing each collection that points at it. Accepted as the simplicity trade-off; cross-collection inheritance can be revisited later if duplication becomes painful.
- The e2e:docker suite gates on Docker like the other `*.docker.test.ts` files (run via `bun run test:e2e:docker`); the playlist-seeding harness extension is shared infrastructure that other future playlist work can reuse.
- Naming convention reminder for implementation: typed errors mirror `SubsonicConnectionError`; no deprecation cycle for any schema change (clean break, minor bump if a public surface shifts).
