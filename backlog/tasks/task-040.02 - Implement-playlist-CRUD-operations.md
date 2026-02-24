---
id: TASK-040.02
title: Implement playlist CRUD operations
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-23 22:59'
labels:
  - libgpod-node
  - playlists
dependencies: []
parent_task_id: TASK-040
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose libgpod playlist management APIs:

**Create/Delete:**
- `itdb_playlist_new(title, spl)` - Create new playlist
- `itdb_playlist_add(itdb, playlist, pos)` - Add playlist to database
- `itdb_playlist_remove(playlist)` - Remove playlist from database
- `itdb_playlist_duplicate(playlist)` - Duplicate playlist

**Track management:**
- `itdb_playlist_add_track(playlist, track, pos)` - Add track to playlist
- `itdb_playlist_remove_track(playlist, track)` - Remove track from playlist
- `itdb_playlist_contains_track(playlist, track)` - Check membership

**Lookup:**
- `itdb_playlist_by_id(itdb, id)` - Find playlist by ID
- `itdb_playlist_by_name(itdb, name)` - Find playlist by name

**Utilities:**
- `itdb_playlist_is_mpl(playlist)` - Check if master playlist
- `itdb_playlist_is_podcasts(playlist)` - Check if podcasts playlist
- `itdb_playlist_set_name(playlist, name)` - Rename playlist
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Can create new playlists via createPlaylist(name)
- [x] #2 Can add/remove tracks from playlists
- [x] #3 Can delete playlists
- [x] #4 Can rename playlists
- [x] #5 Can find playlists by ID and name
- [x] #6 Integration tests for playlist CRUD operations
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented comprehensive playlist CRUD operations for the libgpod-node package, exposing libgpod's playlist management APIs through Node.js bindings.

### Changes Made

**Native C++ bindings (`packages/libgpod-node/native/gpod_binding.cc`):**
- Added 9 new native methods for playlist operations:
  - `CreatePlaylist` - Create a new playlist
  - `RemovePlaylist` - Delete a playlist (with master playlist protection)
  - `GetPlaylistById` - Find playlist by 64-bit ID
  - `GetPlaylistByName` - Find playlist by name
  - `SetPlaylistName` - Rename a playlist
  - `AddTrackToPlaylist` - Add a track to a playlist
  - `RemoveTrackFromPlaylist` - Remove a track from a playlist
  - `PlaylistContainsTrack` - Check if playlist contains a track
  - `GetPlaylistTracks` - Get all tracks in a playlist
- Fixed `PlaylistToObject` to calculate track count from members list instead of `pl->num` (which isn't kept in sync by libgpod)

**TypeScript types (`packages/libgpod-node/src/binding.ts`):**
- Added interface declarations for all new native methods

**Database class (`packages/libgpod-node/src/database.ts`):**
- Added 10 new public methods with full JSDoc documentation:
  - `createPlaylist(name)` - Create a new playlist
  - `removePlaylist(playlistId)` - Delete a playlist
  - `getPlaylistById(playlistId)` - Find playlist by ID
  - `getPlaylistByName(name)` - Find playlist by name
  - `renamePlaylist(playlistId, newName)` - Rename a playlist
  - `addTrackToPlaylist(playlistId, trackId)` - Add track to playlist
  - `removeTrackFromPlaylist(playlistId, trackId)` - Remove track from playlist
  - `playlistContainsTrack(playlistId, trackId)` - Check track membership
  - `getPlaylistTracks(playlistId)` - Get all tracks in playlist
  - `getMasterPlaylist()` - Convenience method to get master playlist

**Integration tests (`packages/libgpod-node/src/index.integration.test.ts`):**
- Added 18 comprehensive integration tests covering:
  - Playlist creation and persistence
  - Finding playlists by ID and name
  - Renaming playlists
  - Deleting playlists (including master playlist protection)
  - Adding/removing tracks to/from playlists
  - Getting tracks from playlists
  - Verifying playlist track counts
  - Error handling for closed database
  - Error handling for invalid IDs

### Key Implementation Details

- Playlist IDs are 64-bit values passed as `BigInt` in TypeScript
- Track IDs are 32-bit values passed as `number`
- The master playlist (MPL) cannot be deleted - attempting to do so throws an error
- Track count is calculated dynamically from the members GList since libgpod's `pl->num` field isn't kept in sync
- Tests requiring multiple tracks with unique IDs save and reopen the database since libgpod assigns track IDs of 0 until database write

### Files Changed
- `packages/libgpod-node/native/gpod_binding.cc`
- `packages/libgpod-node/src/binding.ts`
- `packages/libgpod-node/src/database.ts`
- `packages/libgpod-node/src/index.integration.test.ts`
<!-- SECTION:FINAL_SUMMARY:END -->
