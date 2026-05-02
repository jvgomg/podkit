---
id: TASK-040.04
title: Implement track update and utility APIs
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-23 23:43'
labels:
  - libgpod-node
  - tracks
dependencies: []
parent_task_id: TASK-040
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose additional libgpod track APIs:

- `itdb_track_duplicate(track)` - Duplicate a track
- `itdb_filename_on_ipod(track)` - Get full filesystem path
- `itdb_track_by_dbid(itdb, dbid)` - Find by database ID
- Track field setters - Update individual fields after creation (currently can only set at creation time)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 updateTrack(trackId, fields) modifies existing track metadata
- [x] #2 getTrackFilePath(trackId) returns full path on iPod
- [x] #3 duplicateTrack(trackId) creates a copy
- [x] #4 Integration tests verify track updates persist after save()
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented track update and utility APIs for the libgpod-node package, exposing additional libgpod functionality through Node.js bindings.

## Changes

### Native C++ Implementation (`packages/libgpod-node/native/`)

**database_wrapper.h**
- Added method declarations: `GetTrackByDbId`, `UpdateTrack`, `GetTrackFilePath`, `DuplicateTrack`

**track_operations.cc**
- `GetTrackByDbId()`: Finds a track by its 64-bit database ID (iterates through tracks since libgpod doesn't provide `itdb_track_by_dbid`)
- `UpdateTrack()`: Updates track metadata fields selectively (only updates provided fields)
- `GetTrackFilePath()`: Wraps `itdb_filename_on_ipod()` to return the full filesystem path
- `DuplicateTrack()`: Wraps `itdb_track_duplicate()`, clears ipod_path/transferred, and adds to database

**database_wrapper.cc**
- Registered new methods in the N-API class definition

### TypeScript API (`packages/libgpod-node/src/`)

**binding.ts**
- Added native interface declarations for new methods

**types.ts**
- Extended `TrackInput` with `rating`, `playCount`, `skipCount` fields for updates

**database.ts**
- `getTrackByDbId(dbid: bigint)`: Look up track by persistent 64-bit database ID
- `updateTrack(trackId, fields)`: Update existing track metadata with partial updates
- `getTrackFilePath(trackId)`: Get full filesystem path for track on iPod
- `duplicateTrack(trackId)`: Create a copy of a track (metadata only, no file)

### Integration Tests (`packages/libgpod-node/src/__tests__/tracks.integration.test.ts`)

Added comprehensive tests for:
- `updateTrack`: metadata updates, play statistics, persistence after save
- `getTrackFilePath`: full path for transferred tracks, null for non-transferred
- `duplicateTrack`: metadata copying, new dbid assignment, file copying workflow
- `getTrackByDbId`: lookup by dbid, uniqueness verification

## Technical Notes

- The `id` field (32-bit) is re-assigned by libgpod on export, while `dbid` (64-bit) persists
- `itdb_track_by_dbid` doesn't exist in libgpod, so we implemented it by iterating tracks
- Track duplication clears `ipod_path` and `transferred` since the duplicate has no file
- File paths can only be unique after save when tracks have distinct IDs assigned
<!-- SECTION:FINAL_SUMMARY:END -->
