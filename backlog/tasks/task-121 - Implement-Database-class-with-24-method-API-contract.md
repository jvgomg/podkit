---
id: TASK-121
title: Implement Database class with 24-method API contract
status: To Do
assignee: []
created_date: '2026-03-12 10:55'
labels:
  - phase-4
  - api
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-117
  - TASK-118
  - TASK-119
  - TASK-120
references:
  - doc-003
  - packages/podkit-core/src/ipod/database.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the high-level `Database` class that provides the API contract podkit-core depends on. This is the primary public interface of @podkit/ipod-db.

**Static methods:**
- `Database.open(mountpoint)` — Read iTunesDB + ArtworkDB from iPod mount, parse, return Database instance
- `Database.create()` — Create in-memory database with master playlist
- `Database.initializeIpod(mountpoint, options?)` — Create iPod directory structure + empty database. Auto-create directories with `fs.mkdir` (matching our behavioral deviation fix)
- `Database.IpodModels` — Constants for model strings

**Database lifecycle:**
- `save()` — Serialize database, compute hash, atomic write (temp file + rename)
- `close()` — Release resources, mark as closed

**Track operations (10 methods):**
- `getTracks()` — Return all track handles
- `addTrack(input)` — Create track from TrackInput, return handle
- `getTrack(handle)` — Return immutable Track snapshot
- `updateTrack(handle, fields)` — Update metadata fields
- `removeTrack(handle)` — Remove from all playlists first (behavioral deviation #1), then remove track
- `copyTrackToDevice(handle, sourcePath)` — Copy file to F00-F49 directory with random filename
- `getTrackFilePath(handle)` — Return filesystem path for track

**Artwork operations (4 methods):**
- `setTrackArtwork(handle, imagePath)` — Load image, resize to all device formats, write .ithmb
- `setTrackArtworkFromData(handle, imageData)` — Same from Buffer
- `removeTrackArtwork(handle)` — Remove artwork association
- `hasTrackArtwork(handle)` — Check if track has artwork

**Playlist operations (9 methods):**
- `getPlaylists()`, `getMasterPlaylist()`, `getPlaylistByName(name)`
- `createPlaylist(name)`, `removePlaylist(id)`, `renamePlaylist(id, newName)`
- `addTrackToPlaylist(playlistId, handle)`, `removeTrackFromPlaylist(playlistId, handle)`
- `playlistContainsTrack(playlistId, handle)`

**Info (2 methods):**
- `getInfo()` — DatabaseInfo with device, track/playlist counts
- `device` property — DeviceInfo

**File operations (`files/copy.ts` and `files/paths.ts`):**
- `copyTrackToDevice`: Pick random F00-F49 directory, generate random filename, copy file, set track path
- `ipodPathToFilePath(path)` — Convert colon-separated to OS path
- `filePathToIpodPath(path)` — Convert OS path to colon-separated

**Behavioral deviations (built-in by design):**
1. removeTrack removes from all playlists before deletion
2. create() auto-creates master playlist
3. initializeIpod() auto-creates directory structure
4. clearTrackChapters creates empty chapterdata instead of NULL (relevant in M2)

**Track handle design:**
Since we're pure TypeScript, handles can be simple numeric indices or object references rather than branded C pointer wrappers. Must be stable across save/reload cycles via track ID mapping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 24 methods implemented matching libgpod-node type signatures
- [ ] #2 Database.open() reads iTunesDB + ArtworkDB + SysInfo and returns working instance
- [ ] #3 Database.create() produces valid database with master playlist
- [ ] #4 Database.initializeIpod() creates full directory structure and empty database
- [ ] #5 save() uses atomic write (temp file + rename)
- [ ] #6 save() computes correct hash based on device type
- [ ] #7 removeTrack removes from all playlists before deletion
- [ ] #8 copyTrackToDevice copies to random F00-F49 directory with random filename
- [ ] #9 Path conversion handles colon-separated iPod paths correctly
- [ ] #10 Artwork operations resize to all device-supported formats
- [ ] #11 Track handles remain valid across save operations
- [ ] #12 getInfo() returns correct device info, track count, playlist count
<!-- AC:END -->
