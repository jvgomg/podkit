---
title: Subsonic Collection Adapter
description: How the Subsonic collection adapter works — connection, full-library and playlist-scoped sourcing, typed errors, and the empty-playlist guard.
sidebar:
  order: 1
---

Describes the Subsonic (Navidrome-compatible) collection adapter's design,
its two sourcing modes, and the conventions a contributor must follow when
changing it.

Cross-cutting rules (typed errors, no `console.warn` in core,
sink-not-stderr) live in [conventions](../conventions.md). The error and
warning model is described in [sync/error-handling](../sync/error-handling.md).

Design rationale and feature requirements: [doc-049 — RFC: Playlist-Scoped
Subsonic Collections](../../../backlog/docs/doc-049%20-%20RFC-Playlist-Scoped-Subsonic-Collections.md).

---

## 1. Map

The Subsonic adapter (`packages/podkit-core/src/adapters/subsonic.ts`)
implements `CollectionAdapter` for any Subsonic-compatible server
(Navidrome, Subsonic, Airsonic). It has one responsibility: given a config
block, produce the set of `CollectionTrack`s that the sync engine will diff
against the device.

It does **not** own:

- Track diffing or planning — that lives in the sync engine.
- Artwork fetching during sync — the music pipeline handles that via its
  artwork manager.
- Per-device collection assignment — callers use the existing
  `[defaults].music` / `-c` mechanism.
- Any I/O outside the Subsonic API surface it exposes through `PlaylistApi`.

---

## 2. Primitives

### Connection + validation (`connect`)

`connect()` opens and validates the server connection. It always pings the
server (existing behaviour). When a `playlist` is configured, `connect()`
additionally resolves and validates the named playlist — this is the
at-sync-start validation surface. If the playlist is missing or ambiguous
the adapter throws a typed error and the sync aborts before any transfer.

### Two sourcing modes (`getItems`)

`getItems()` returns the full set of tracks the collection exposes to the
planner. The mode is determined by whether `playlist` is set in the
collection config:

| Mode | Config | Source |
|------|--------|--------|
| Full-library | no `playlist` | `getSongsByGenre` scan across all content |
| Playlist-scoped | `playlist: "Name"` | `getPlaylist(id)` resolved at `connect()` |

In both modes the returned tracks go through the same song→track mapper
(artist/title/album/artwork-url normalization). The in-memory
`getFilteredItems` (artist/album/genre/year CLI filters) layers on top of
`getItems` unchanged — playlist scoping only narrows *what the server
returns*, not how filters are applied.

### Playlist resolver (`resolvePlaylist`) — a deep module

`packages/podkit-core/src/adapters/subsonic/playlist.ts` is a self-contained
deep module: given a `PlaylistApi` and a name, it returns `{ id, tracks }`.

The resolution protocol:

1. Call `getPlaylists()` — get the server's full playlist list.
2. Filter to playlists whose `name` matches exactly (case-sensitive).
3. Zero matches → throw `PlaylistNotFoundError` (includes available names
   for quick typo detection).
4. Two or more matches → throw `AmbiguousPlaylistError` (includes matching
   ids for disambiguation).
5. Exactly one → call `getPlaylist(id)` → map entries via the
   caller-supplied `mapEntry` function.

The `mapEntry` function is injected by the adapter so playlist entries go
through the adapter's existing song→track mapper, not a duplicated one.

`PlaylistApi` is a structural interface (not the full `SubsonicAPI` class)
exposing only the two methods the resolver calls. This keeps the module
testable with a small fake and makes its dependency surface explicit. A
compile-time assignability check in `playlist.ts` ensures `SubsonicAPI`
continues to satisfy the interface.

### Typed playlist errors

`PlaylistNotFoundError` and `AmbiguousPlaylistError` are typed errors
thrown by the resolver and propagated by the adapter. They follow the
`SubsonicConnectionError` precedent:

- Named classes (not raw `Error`) so callers can branch on `instanceof`.
- Carry typed fields (`playlistName`, `availablePlaylists` / `matchingIds`)
  for programmatic use, not just string messages.
- Abort the sync before any transfer — the adapter throws from `connect()`,
  where validation runs.

These errors are not `CategorizedSyncError` subclasses — they surface at
the CLI layer as `CliError`s (typed with `SyncErrorCodes`), not as
per-track sync failures.

---

## 3. Responsibility boundaries

### Two boundaries: sourcing vs. device matching

There are two distinct places where track identity matters in a
playlist-scoped sync, and they use different fields:

| Boundary | Identity used | Why |
|----------|--------------|-----|
| **Sourcing** (adapter → planner) | Subsonic song **id** | Playlist entries carry the server's id; tracks are fetched by id via `getPlaylist`. The id is the stable server-side handle. |
| **Device matching** (planner → diff) | Metadata match key (`artist`/`title`/`album`) | The device database does not store Subsonic ids. The planner diffs source tracks against on-device tracks by the same metadata key it uses for full-library syncs. |

A playlist-scoped sync is therefore not "id-based end to end" — sourcing
uses the id, matching uses metadata. The distinction matters when writing
tests: asserting that a playlist sync places the correct tracks on the
device means checking on-device metadata, not Subsonic ids.

### Adapter

Knows: server connection, playlist resolution, song→track mapping.
Throws: `PlaylistNotFoundError`, `AmbiguousPlaylistError`,
`SubsonicConnectionError` (typed).
Never: reaches into the sync engine, logs to console, decides retry policy.

### Playlist resolver (`resolvePlaylist`)

Knows: the two Subsonic calls needed to resolve a name to tracks.
Takes: an injected `PlaylistApi` and `mapEntry` — never calls the broader
adapter.
Throws: `PlaylistNotFoundError`, `AmbiguousPlaylistError`.
Never: caches, retries, or talks to the device.

### CLI (empty-playlist guard)

The guard (`packages/podkit-cli/src/commands/empty-playlist-guard.ts`) is
called **after** `connect()` and `getItems()` resolve, and **before** the
sync plan is built. It is gated to playlist-scoped collections only (an
ordinary empty library/directory collection never reaches it).

The guard is a pure decision function — no I/O, no process exit:

```
decideEmptyPlaylist(trackCount, { interactive, allowEmpty })
  → 'proceed' | 'confirm' | 'abort'
```

The CLI maps the decision onto behaviour:

- `proceed` — build and execute the plan.
- `confirm` — warn the user, prompt via the existing yes/no helper; proceed
  on yes, abort on no.
- `abort` — emit a typed `EMPTY_PLAYLIST_ABORT` `CliError` (registered in
  the exhaustive `SyncErrorCodes`), exit non-zero.

The `allowEmpty` input to the guard is true when either `--yes` (one-off
CLI flag) or the global config key `allowEmptyPlaylist: true` is set.
`allowEmptyPlaylist` is a global boolean in `PodkitConfig` — it applies to
all playlist-scoped collections in the run.

---

## 4. Conventions for new contributors

When modifying the Subsonic adapter:

1. **Resolve once, at `connect()`** — playlist validation must fire at
   connection time, before the sync engine runs. Do not defer validation to
   `getItems()`.
2. **Keep the resolver self-contained.** `resolvePlaylist` takes an API
   handle and a mapper — nothing else from the adapter. If a future variant
   (e.g. id-based reference) needs a different resolution protocol, add a
   second function, do not split the existing one across files.
3. **Mirror typed errors from `SubsonicConnectionError`.** New playlist
   errors must be named classes with typed fields. No raw `Error`.
4. **Test the merge path for any new config field.** See
   [conventions §12](../conventions.md#12-adding-a-config-field-requires-three-changes-not-one)
   — parse + `mergeConfigs` + test the merge.
5. **Do not add playlist awareness to `device music`.** The device database
   has no link to the source collection; showing playlist context there is
   out of scope.

When adding a second collection adapter:

- Read [conventions §4](../conventions.md#4-adapters-never-reach-into-their-callers)
  — adapters emit through contracts, never through caller references.
- The `CollectionAdapter` interface contract is the pending
  `collection-adapters/adapter-contract.md` doc; until it lands, use the
  Subsonic adapter as the reference implementation.

---

## 5. Scope boundaries

This document covers the Subsonic adapter and its playlist resolver. It
does not cover:

- **The full `CollectionAdapter` contract** — pending
  `collection-adapters/adapter-contract.md`.
- **The directory adapter** — a separate (simpler) implementation; no
  playlist concept applies to it.
- **How tracks are diffed against the device** — see
  `sync/planning.md` (pending) and the `SyncDiffer` / `SyncPlanner` in
  `packages/podkit-core/src/sync/`.
- **Artwork fetching during sync** — the music pipeline's
  `MusicArtworkManager` owns that; the adapter only surfaces the
  artwork URL in `CollectionTrack.artworkUrl`.

---

## 6. Open work

- `collection-adapters/adapter-contract.md` — the `CollectionAdapter`
  interface needs a settled architecture doc when a second adapter lands
  or when the interface is refactored.
- Playlist entries are fetched by id (`getPlaylist`) and mapped by
  metadata for device matching. If a future config schema adds id-based
  device tracking (so the device stores the Subsonic song id), the two
  boundaries described in §3 could merge — but that requires changes to
  the device-adapter layer, not just the collection adapter.
- `allowEmptyPlaylist` is a global flag. A per-collection override (allow
  empty for one collection but not another) may be desirable if the global
  becomes a footgun; deferred until a concrete need arises.

---

## 7. References

- `packages/podkit-core/src/adapters/subsonic.ts` — the adapter.
- `packages/podkit-core/src/adapters/subsonic/playlist.ts` — the playlist
  resolver deep module (`resolvePlaylist`, `PlaylistNotFoundError`,
  `AmbiguousPlaylistError`, `PlaylistApi`).
- `packages/podkit-cli/src/commands/empty-playlist-guard.ts` —
  `decideEmptyPlaylist` pure decision function.
- `packages/podkit-cli/src/config/types.ts` — `MusicCollectionConfig`
  (with `playlist?: string`) and `PodkitConfig` (with
  `allowEmptyPlaylist?: boolean`).
- `packages/podkit-cli/src/config/loader.ts` — `loadConfigFile`,
  `mergeConfigs` (the three-place convention in action).
- `packages/podkit-core/src/adapters/subsonic.test.ts` — adapter
  integration tests (mock API, no network).
- `packages/podkit-core/src/adapters/subsonic/playlist.test.ts` —
  resolver unit tests.
- `packages/podkit-cli/src/commands/empty-playlist-guard.test.ts` —
  guard decision matrix tests.
- `test-packages/e2e-tests/src/workflows/navidrome-playlist-seeding.docker.test.ts`
  — real Navidrome e2e tests (Docker-gated).
- [doc-049 — RFC: Playlist-Scoped Subsonic Collections](../../../backlog/docs/doc-049%20-%20RFC-Playlist-Scoped-Subsonic-Collections.md)
  — full design rationale, user stories, and out-of-scope decisions.
- [conventions §12](../conventions.md#12-adding-a-config-field-requires-three-changes-not-one)
  — config field three-place rule.
- [sync/error-handling](../sync/error-handling.md) — the broader
  typed-error model that playlist errors follow.
