---
id: TASK-431.06
title: SQLite catalogue (LibraryDbWriter → library.sqlite)
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 16:49'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.02
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `LibraryDbWriter` to build `library.sqlite` — the parsed, queryable view (no raw blobs; raw iTunesDB in the dump stays the source of truth). Tables: `device` (model/serial/capacity/generation/dump_date/podkit_version), `tracks` (all DB fields + `exported_path` + `dump_path`), `playlists`, `playlist_items` (ordered, per-item timestamp), `albums`, `artwork` (track→image, width/height/format), `smart_playlist_rules`, `schema_version`. Preserve play counts, ratings, last-played, skip counts, date-added exactly as on device.

Use the driver chosen by the SQLite spike (task-431.02).

Spec: doc-047 (library.sqlite schema; SPIKE outcome).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 library.sqlite written with the documented tables and schema_version
- [x] #2 Each track row maps to its exported_path and dump_path
- [x] #3 Play counts, ratings, last-played, skip counts, date-added preserved as stored on device
- [x] #4 Smart-playlist rules persisted
- [x] #5 LibraryDbWriter tested by opening the produced DB and asserting device row, track fields, playlist ordering, smart rules
- [x] #6 Uses `bun:sqlite` (spike outcome: Branch A — CLI ships Bun-only)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented `LibraryDbWriter` (`packages/ipod-archive/src/library-db-writer.ts`) using `bun:sqlite` (`import { Database as SqliteDatabase } from "bun:sqlite"`, aliased to avoid the collision with libgpod-node's `Database`). `writeLibraryDb(opts)` builds `<archiveDir>/library.sqlite` in a single transaction with prepared statements and returns the path.

Schema (schema_version constant = 1):
- `schema_version(version)`
- `device(model, model_name, model_number, serial, capacity_gb, generation, dump_date, podkit_version)` — one row; dump_date + podkit_version injected via opts.
- `tracks(dbid TEXT PK, title, artist, album, album_artist, composer, genre, comment, grouping, track_number, total_tracks, disc_number, total_discs, year, bpm, compilation, duration_ms, bitrate, sample_rate, size, filetype, media_type, rating, play_count, skip_count, time_added, time_modified, time_played, time_released, soundcheck, tv_show, tv_episode, season_number, episode_number, movie_flag, has_artwork, ipod_path, exported_path, dump_path)` — every meaningful libgpod Track field + exported_path (archive-relative, NULL for no-audio) + dump_path (ipodPath).
- `playlists(id TEXT PK, name, is_master, is_smart, is_podcasts, timestamp, match, live_update, check_rules, check_limits, limit_type, limit_sort, limit_value, match_checked_only)` — smart prefs folded in.
- `playlist_items(playlist_id, track_dbid, position, added_timestamp)` — order preserved via getPlaylistTracks; added_timestamp NULL (libgpod exposes no per-item timestamp).
- `albums(album, album_artist, track_count)` — derived (libgpod exposes no album list): group by distinct (album, albumArtist), sorted deterministically.
- `artwork(track_dbid, width, height, format)` — sourced from the ArtworkDecoder index (new `artworkInfo(dbid)` method exposes the largest indexed thumbnail's width/height/formatId without re-parsing ArtworkDB or decoding pixels).
- `smart_playlist_rules(playlist_id, rule_index, field, action, string, from_value, to_value, from_date, to_date, from_units, to_units)` — one row per rule via exported pure `flattenSmartRule`.

bigint strategy: dbid + playlist id stored as decimal TEXT (`.toString()`) — no i64 precision loss for unsigned 64-bit ids. Booleans → 0/1. No raw iTunesDB/ArtworkDB blobs stored (schema is blob-free; raw dump remains source of truth). Play counts / ratings / skip counts / timestamps copied through verbatim.

run-transform wiring: accumulates a `dbid → {exportedPath, dumpPath}` map across the track loop (written, no-audio, traversal-guard, and extraction-failure branches all record an entry so every track is catalogued), shares the existing ArtworkDecoder as the artwork index, and calls writeLibraryDb after the loop. `dump_date` from injected `opts.now()` clock (defaults to new Date()); `podkitVersion` via `opts.podkitVersion` (default 'unknown'). `TransformResult` gains `libraryDbPath`. CLI `device archive --from-dump` passes its build-time `PODKIT_VERSION` through.

Tests:
- `library-db-writer.test.ts` (unit): pins `flattenSmartRule` (string/numeric/range rules; exact 64-bit id stringification).
- `library-db-writer.integration.test.ts`: seeds a fixture dump via gpod-testing + libgpod (varied play counts/ratings/skip counts, a podcast media type, a no-audio track, an ordered manual playlist, a smart playlist with a genre rule, a synthetic ArtworkDB). Runs runTransform with injected dump_date + version, reopens library.sqlite with bun:sqlite, asserts schema_version, the device row, exact preservation of play stats, dbid TEXT exactness, exported_path/dump_path (NULL for no-audio), albums rollup, artwork row matching the index, playlist ordering, master/smart flags, smart rules, and a blob-free schema.

Coverage note: the libgpod test harness DOES support ordered playlists and smart playlists with readable rules (verified), so both are asserted end-to-end — no smart-playlist coverage gap. The smart `match` operator is the only field left NULL on the read path (libgpod's getPlaylists returns plain rows without `match`); the flattened rules are the durable predicate definition, and the column is kept nullable for a future read API.

Quality gates (all pass):
- bun run build --filter @podkit/ipod-archive --filter podkit — OK (ipod-archive build externals `bun:sqlite`).
- typecheck @podkit/ipod-archive + podkit — OK.
- bun run lint — 0 warnings, 0 errors.
- bun run test:unit --filter @podkit/ipod-archive — 130 pass.
- bun run test:integration --filter @podkit/ipod-archive — 35 pass.
- CLI device-archive.unit.test.ts — 9 pass.
<!-- SECTION:NOTES:END -->
