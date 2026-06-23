---
id: TASK-434.04
title: Display playlist constraint in collection commands
status: Done
assignee: []
created_date: '2026-06-23 19:04'
updated_date: '2026-06-23 20:06'
labels:
  - collections
  - subsonic
  - cli
dependencies:
  - TASK-434.01
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
modified_files:
  - packages/podkit-cli/src/resolvers/collection.ts
  - packages/podkit-cli/src/commands/collection.ts
  - packages/podkit-cli/src/commands/collection-playlist-display.test.ts
parent_task_id: TASK-434
ordinal: 178000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surface the playlist constraint in the music listing commands. See RFC doc-049 — do not duplicate.

- `collection list`: add a PLAYLIST column (`-` when the collection has no playlist).
- `collection info`: show the playlist name plus resolution status — OK with track count / MISSING / AMBIGUOUS. For a playlist-scoped collection this performs a network lookup (the explicit, on-demand validation surface).
- `collection music`: annotate the heading with the playlist name.

`device music` is intentionally NOT modified (no source-collection link on the device DB).

Covers PRD user stories 5, 6, 7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `collection list` shows a PLAYLIST column, `-` when none
- [x] #2 `collection info` for a playlist collection resolves and shows name + status (OK+count / MISSING / AMBIGUOUS)
- [x] #3 `collection music` heading is annotated with the playlist name
- [x] #4 `device music` is unchanged
- [x] #5 JSON output of the affected commands includes the playlist field/status
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### Surface 1: `collection list` — PLAYLIST column
- `formatCollectionTable()` in `packages/podkit-cli/src/commands/collection.ts` now computes a `playlistWidth` (max of column header "PLAYLIST" length and all playlist values), then renders each row with a `PLAYLIST` column between NAME and PATH. Non-playlist and non-music collections show `-`.
- `CollectionInfo.playlist` is populated in `getAllCollections()` in `packages/podkit-cli/src/resolvers/collection.ts` from `col.playlist` when `col.type === 'subsonic'`; undefined otherwise.
- No network call is made for `collection list`.

### Surface 2: `collection info` — playlist name + resolution status
- Logic extracted into exported `runCollectionInfo(options, out, adapterFactory?)` for testability (mirrors the `runCollectionMusic` pattern). The `infoSubcommand` action now just calls it.
- `CollectionInfo` extended with three new optional fields: `playlist?: string`, `playlistStatus?: 'OK' | 'MISSING' | 'AMBIGUOUS' | 'ERROR'`, `playlistTrackCount?: number`.
- For subsonic collections with a `playlist` configured, `runCollectionInfo` calls the adapter factory (default: `createMusicAdapter`), then `adapter.connect()` + `adapter.getItems()`. Typed error dispatch:
  - `PlaylistNotFoundError` → `playlistStatus = 'MISSING'`
  - `AmbiguousPlaylistError` → `playlistStatus = 'AMBIGUOUS'`
  - Any other thrown error → `playlistStatus = 'ERROR'`
  - Success → `playlistStatus = 'OK'`, `playlistTrackCount = tracks.length`
- For non-playlist subsonic and directory collections no network call is made.
- Text output appends a `  Playlist:  <name> (<STATUS>, N track(s))` line inside the subsonic block.
- This does NOT exit non-zero for MISSING/AMBIGUOUS/ERROR — it's an informational display, not an abort gate (that's the sync flow in task-434.02/03).

### Surface 3: `collection music` — heading annotation
- `runCollectionMusic()` computes `playlistAnnotation` from `collectionConfig.playlist` and appends ` (playlist: <name>)` to the heading string before the colon, e.g. `Music in collection 'workout' (playlist: Workout):`.
- Only appended for subsonic collections with a playlist set.

### Surface 4: `device music` — NOT modified (per spec)

### JSON output shapes added
- `collection list` JSON: `CollectionListSuccess.collections[]` now includes `playlist?: string` on each entry.
- `collection info` JSON: same plus `playlistStatus?: 'OK'|'MISSING'|'AMBIGUOUS'|'ERROR'` and `playlistTrackCount?: number` on the music collection entry.
- These fields are absent (not null) when not applicable.

### Error handling
- The `PlaylistNotFoundError` and `AmbiguousPlaylistError` imports were added to `collection.ts` from `@podkit/core`.
- `MusicAdapterFactory` type is exported from `collection.ts` so tests can type the injected fake factory.

### Tests
New file: `packages/podkit-cli/src/commands/collection-playlist-display.test.ts` (17 tests, runs in the unit suite — no `.integration.` suffix, no network required).
- `getAllCollections` — playlist field populated/absent correctly
- `formatCollectionTable` (via `getAllCollections` output) — JSON shape verified
- `runCollectionInfo` — text: OK+count, OK+singular, MISSING, AMBIGUOUS, ERROR, no-playlist subsonic (no Playlist line), directory (factory never called)
- `runCollectionInfo` — JSON: playlist/status/trackCount present for OK; MISSING; AMBIGUOUS; absent for non-playlist
- `runCollectionMusic` — heading not annotated for directory collection (negative case; positive case requires real subsonic server so belongs in e2e:docker)

All quality gates pass: typecheck, lint (oxlint + stderr scanner), build, bun run test --filter podkit (unit + integration).

## Code Review Fixes (post-implementation)

### FIX 1 (BLOCKER) — adapter disconnect in try/finally
`runCollectionInfo` in `packages/podkit-cli/src/commands/collection.ts`: the adapter was created inside the try block, so disconnect was never called on error paths. Restructured so the adapter is created before the try block, then a `try { connect + getItems + set OK/count } catch { map errors } finally { await adapter.disconnect(); }` ensures disconnect is always called regardless of outcome.

Tests: `okAdapterFactory` and `errorAdapterFactory` in `collection-playlist-display.test.ts` now return `[factory, adapter]` tuples instead of just the factory, so the test body can inspect `adapter.disconnect`'s call count. Added `expect(adapter.disconnect.mock.calls.length).toBeGreaterThan(0)` to the OK-path test ('shows Playlist line with OK status') and the MISSING error-path test ('shows MISSING status when PlaylistNotFoundError is thrown'). All other call sites were updated to destructure `[factory]` or `[factory, adapter]`.

### FIX 2 (SHOULD-FIX) — PLAYLIST column comment accuracy
`formatCollectionTable` comment at the `playlistValues` line: was `// PLAYLIST column: only shown when at least one music collection has a playlist`, which contradicted the actual always-shown behavior. Updated to `// PLAYLIST column: always shown; displays the playlist name or '-' when the collection has no playlist`.

### FIX 3 (SHOULD-FIX) — real table-text assertion replacing zombie test
'shows playlist name in table text when collection has one' test was a no-op (ended with `void out; void stdout`). Replaced with a real assertion that invokes `runCollectionList` via the `runWithContext + captured BufferSink` seam (same pattern as other tests in the file). The test now:
- Asserts `stdout.text()` contains `'PLAYLIST'` header
- Asserts the playlist-scoped row value `'Workout'` appears in output
- Asserts the non-playlist row shows `'-'` followed by the subsonic URL via a regex

To enable this, `formatCollectionTable`'s containing logic was extracted into an exported `runCollectionList(options, out)` runner (mirrors `runCollectionInfo`/`runCollectionMusic`), and the list subcommand action now delegates to it. A `runList` helper was added to the test file alongside `runInfo` and `runMusic`.

### FIX 4 (SHOULD-FIX) — no-network assertion for non-playlist subsonic info
'does NOT show Playlist line for non-playlist subsonic collections' test: replaced the passing-but-silent `okAdapterFactory([])` factory with a factory that throws if called, and added `expect(factoryMock.mock.calls.length).toBe(0)` — mirroring the stronger assertion already present in the directory collection test. The test now genuinely fails if the code ever calls the adapter for a non-playlist subsonic collection.

### FIX 5 (SHOULD-FIX) — keep-in-sync comment on demo mock error classes
`packages/demo/src/mock-core.ts`: added `// Keep field names + message shape in sync with packages/podkit-core/src/adapters/subsonic/playlist.ts` above the `PlaylistNotFoundError` class. Field names (`playlistName`, `availablePlaylists`, `matchingIds`) and message templates were verified to match the real implementations exactly — no drift found.

### Quality gates after review fixes
- `bun run typecheck`: 36/36 tasks successful
- `bun run lint`: 0 warnings, 0 errors
- `bun run build`: 20/20 tasks successful
- `bun run test --filter podkit`: 17 unit tests pass (playlist display file), 67 integration tests pass
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Playlist constraint surfaced in collection commands + review-fixed. `collection list` PLAYLIST column (name or `-`, always shown); `collection info` network-resolves status (OK+count / MISSING / AMBIGUOUS / ERROR) via adapter, mapping PlaylistNotFoundError→MISSING, AmbiguousPlaylistError→AMBIGUOUS; `collection music` heading annotation; `device music` untouched; JSON gains playlist/playlistStatus/playlistTrackCount. Review (Sonnet) fix-then-ship: added try/finally adapter.disconnect() in runCollectionInfo (+ test asserts disconnect), corrected always-shown column comment, replaced zombie table-text test with a real rendered-output assertion, asserted no network for non-playlist/directory info, keep-in-sync comment on demo mock errors. Combined tree force-verified green after the fixer process crashed (all edits had landed): typecheck 13/13, tests 20/20 (core 3262 tests). Deferred follow-ups: discriminated-union type for playlistStatus/trackCount (N-1), `collection.config as {playlist?}` cast in sync-presenter.ts (N-3).
<!-- SECTION:FINAL_SUMMARY:END -->
