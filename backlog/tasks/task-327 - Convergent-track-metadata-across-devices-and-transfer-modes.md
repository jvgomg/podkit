---
id: TASK-327
title: Convergent track metadata across devices and transfer modes
status: Done
assignee: []
created_date: '2026-05-12 21:03'
updated_date: '2026-05-12 21:30'
labels:
  - mass-storage
  - ipod
  - sync
  - metadata
dependencies: []
modified_files:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.integration.test.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.test.ts
  - packages/podkit-core/src/device/ipod-adapter.ts
  - packages/podkit-core/src/device/ipod-adapter.integration.test.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts
  - .changeset/convergent-track-metadata.md
priority: high
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`MassStorageAdapter.updateTrack` (`packages/podkit-core/src/device/mass-storage-adapter.ts:763-800`) only writes `comment`, OGG/Opus artwork, and ReplayGain to disk. All other metadata fields (title, artist, album, albumArtist, genre, year, trackNumber, discNumber, compilation) update in-memory only — the file's embedded tags on the device are never rewritten. Convergence is broken: after a relocate or metadata-correction sync, the next sync re-detects the same diff every time.

`IpodDeviceAdapter.updateTrack` has a related gap: it updates iTunesDB only, never file tags. Invisible today because iPod firmware reads iTunesDB, but visible under `portable` mode where users intend to pull files off the device.

## Contract by (device, transfer mode)

| Mode | iPod | Mass-storage |
|---|---|---|
| `fast` | iTunesDB only, no file write | File tags ON (firmware reads them) |
| `optimized` | iTunesDB only, no file write (incl. on add) | File tags ON |
| `portable` | iTunesDB + file tags (best-effort, recovery use case) | File tags ON |

Mass-storage always writes file tags because most non-iPod DAP firmware reads tags directly. iPod `optimized` deliberately skips file tags even on first sync — files are F00/F01-style anonymized blobs that only iTunesDB references.

## Out of scope

- **Match-key bug**: title/artist/album corrections produce a remove+add (lost play counts). Accepted as by-design — when those fields change, podkit treats it as a different track.
- Virtual-iPod parity ships when m-17 lands; adapter contract is already correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TagWriter exposes writeTags(filePath, fields) covering title/artist/albumArtist/album/genre/year/trackNumber/discNumber/compilation/comment across FLAC, MP3, M4A, OGG/Opus
- [x] #2 MassStorageAdapter queues all metadata fields in updateTrack and flushes them via Promise.allSettled in save() with per-file warning collection
- [x] #3 IpodDeviceAdapter writes file tags only under transferMode=portable; fast/optimized never touch file tags (add or update)
- [x] #4 addTrack honours transforms under portable mode — collection-adapter corrections land in on-disk tags, not just iTunesDB / scanner cache
- [x] #5 Two consecutive syncs against unchanged source produce a no-op plan on both backends and all transfer modes
- [x] #6 Locked-in test asserting old broken behaviour is inverted (mass-storage-adapter.test.ts: 'updateTrack without comment change does not queue a write')
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What shipped

Five-step rollout completed in one sitting.

**Step 1 — `TagWriter.writeTags(filePath, fields: TagFields)`** (`packages/podkit-core/src/device/mass-storage-tag-writer.ts`): single entry point covering `title`, `artist`, `albumArtist`, `album`, `genre`, `year`, `trackNumber`, `discNumber`, `compilation`, `comment`. `writeReplayGain` and `writePicture` stay separate (different concerns, distinct payloads). Integration tests round-trip every field across FLAC, MP3, M4A, and Opus (OGG dropped due to libvorbis absence in CI ffmpeg builds — Opus exercises the same Vorbis-comments codepath). Edge cases covered: partial updates leave untouched fields alone, Unicode round-trips, `compilation` toggles cleanly.

**Step 2 — Mass-storage adapter wiring** (`packages/podkit-core/src/device/mass-storage-adapter.ts`): replaced `pendingCommentWrites` with `pendingTagWrites: Map<string, TagFields>` accumulating per-file. `updateTrack` diffs every field against the current track and queues only what actually changed. `relocateTrack` and `replaceTrackFile` re-key the map alongside the other pending maps. `save()` flushes via `Promise.allSettled`, aggregates per-file failures, and throws a single descriptive error if any writes failed. Locked-in test `updateTrack without comment change does not queue a write` inverted to `updateTrack with changed title queues a tag write`.

**Step 3 — iPod adapter portable-mode writes** (`packages/podkit-core/src/device/ipod-adapter.ts`): added `IpodDeviceAdapterOptions { tagWriter? }`. `updateTrack` consults `transferMode` (passed via metadata payload) and queues tag rewrites only under `portable`. `fast` and `optimized` never touch the on-disk file. `save()` persists iTunesDB first, then flushes pending tag writes via `Promise.allSettled` and surfaces failures as `console.warn` (best-effort recovery, iTunesDB is the authoritative store for playback). Pending writes are keyed by `IpodTrack` instance but resolved to absolute paths at flush time via `TrackHandle.index` — necessary because `addTrack` returns a track with empty `ipodPath` and `copyFile` later returns a new wrapper with the populated path, and `updateTrack` returns yet more new wrappers each time.

**Step 4 — `addTrack` consistency** (`packages/podkit-core/src/sync/music/pipeline.ts`): `transferMode: this.transferMode` injected into every `addTrack` call (transcode, copy, upgrade) and `updateTrack` / relocate call. Mass-storage always writes tags regardless of mode; iPod writes only under `portable`. When the collection adapter applied transforms (clean-artists, Subsonic-side corrections), the resulting input tags now land on disk under portable rather than being lost behind FFmpeg's `-map_metadata 0`.

**Step 5 — Virtual-iPod parity**: no work needed. m-17's adapter inherits iPod behaviour through the same `DeviceAdapter` contract.

## Tests

Total ~60 new test cases added across layers, all green alongside the pre-existing suite:

- **`mass-storage-tag-writer.integration.test.ts`**: 20 round-trip cases across FLAC/MP3/M4A/Opus covering each field individually, full-field round-trips, and edge cases (partial updates, successive writes, compilation toggle, Unicode, cleanup, error handling).
- **`mass-storage-adapter.test.ts`**: existing 123 cases still pass; added queue-merging, full-field diff, and no-op coalescing tests. The pre-fix locked-in test was inverted.
- **`ipod-adapter.integration.test.ts`**: 8 new transfer-mode cases — `fast` and `optimized` never write file tags on add or update; `portable` mirrors metadata on add, writes only diffed fields on update, coalesces multiple updates of the same track into one writeTags call, and surfaces tag-write failures as warnings rather than failing `save()`.
- **`mass-storage-sync.e2e.test.ts`**: existing `relocate on albumArtist change` test now asserts convergence in the follow-up sync (was previously documented as broken). Added a dedicated convergence-invariant test that mutates four metadata fields (albumArtist, album, genre, year) and asserts the third sync produces an empty plan.

Full suite: 27/27 E2E, 2441 core unit tests, all CLI tests, no regressions.

## Notes

- **Migration churn**: as expected and accepted, the first sync after upgrade on existing mass-storage devices will produce a `metadata-correction` op for every previously-touched track with stale on-disk tags. Zero-byte work but visible. Documented in the changeset.
- **`compilation` setter**: prior agent's report claimed no first-class setter exists in `node-taglib-sharp`. They were wrong — `Tag.isCompilation` works across all relevant containers.
- **Match-key fields** (title, artist, album corrections): still trigger remove+add, losing play counts. Accepted as by-design per session decision; could be a follow-up ADR if play-count preservation across renames becomes important.
<!-- SECTION:FINAL_SUMMARY:END -->
