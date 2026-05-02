---
id: TASK-042.02
title: Create TrackHandle type and update TypeScript API
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 16:27'
labels:
  - libgpod-node
  - typescript
dependencies: []
parent_task_id: TASK-042
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the TypeScript types and Database class to use TrackHandle.

## Type Changes (`types.ts`)

```typescript
/**
 * Opaque handle to a track in the database.
 * 
 * This is the primary way to reference tracks for operations.
 * The handle remains valid until the database is closed or the
 * track is removed.
 * 
 * To get track metadata, use db.getTrack(handle).
 */
export interface TrackHandle {
  readonly __brand: 'TrackHandle';
  readonly index: number;
}

/**
 * Track metadata snapshot.
 * 
 * This is a point-in-time copy of track metadata. Changes to the
 * track in the database will not be reflected here.
 */
export interface Track {
  // ... existing fields, but id becomes optional or removed
}
```

## Database class changes (`database.ts`)

- `addTrack(input: TrackInput): TrackHandle`
- `getTracks(): TrackHandle[]`
- `getTrack(handle: TrackHandle): Track` - NEW: get data snapshot
- `copyTrackToDevice(handle: TrackHandle, path: string): Track`
- `removeTrack(handle: TrackHandle): void`
- `updateTrack(handle: TrackHandle, fields: Partial<TrackInput>): Track`
- All other track operations updated similarly

## Deprecation/Removal

- `getTrackById(id: number)` - Mark as deprecated or remove
- `getTrackByDbId(dbid: bigint)` - Keep but document limitations
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TrackHandle interface added to types.ts with branded type pattern
- [ ] #2 Track.id made optional with documentation about re-assignment
- [ ] #3 NativeDatabase interface updated to match native handle-based API
- [ ] #4 Database class updated with all methods using TrackHandle
- [ ] #5 TrackHandle exported from index.ts
- [ ] #6 TypeScript build succeeds with no errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision: Remove getTrackById

After analysis, `getTrackById()` should be **removed entirely**, not deprecated:

1. libgpod docs explicitly say `itdb_track_by_id()` is "not really a good idea"
2. Track IDs are reassigned on every `itdb_write()` - stored IDs become invalid
3. No application code in podkit uses it
4. Strawberry (major libgpod user) never uses ID-based lookup

With TrackHandle, the use cases are covered:
- `addTrack()` → returns handle
- `getTracks()` → returns all handles
- To find a specific track → iterate handles and match by metadata

Document this exclusion in LIBGPOD.md explaining why the function exists in libgpod but isn't exposed.

## Ready to implement

Native layer is complete (TASK-042.01). TypeScript layer needs:

1. **types.ts**: Add TrackHandle interface, make Track.id optional
2. **binding.ts**: Update NativeDatabase interface to match native API
3. **database.ts**: Update all methods to use TrackHandle
4. **index.ts**: Export TrackHandle type

The native API now:
- addTrack() returns number (handle index)
- getTracks() returns number[] (handle indices)
- getTrackData(handle) returns Track object
- All operations accept handle instead of trackId
- getTrackById removed

## Implementation Complete

All TypeScript API changes implemented:
- Added TrackHandle interface with branded type pattern
- Updated NativeDatabase interface to match native handle-based API
- Updated Database class with all track operations using TrackHandle
- Exported TrackHandle from index.ts

Build succeeds. Tests need updating in TASK-042.03.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Updated the libgpod-node TypeScript API to use pointer-based TrackHandle instead of track IDs.

## Changes Made

### 1. `packages/libgpod-node/src/types.ts`
- Added `TrackHandle` interface with branded type pattern to prevent accidental use of plain numbers
- Made `Track.id` optional with documentation explaining it's re-assigned on every save

### 2. `packages/libgpod-node/src/binding.ts`
- Updated `NativeDatabase` interface to match new native API:
  - `getTracks()` returns `number[]` (handle indices)
  - `addTrack()` returns `number` (handle index)
  - Added `getTrackData(handle: number)` for getting track data
  - `getTrackByDbId()` returns `number` (-1 if not found)
  - `duplicateTrack()` returns `number` (new handle index)
  - `getPlaylistTracks()` returns `number[]`
  - `evaluateSmartPlaylist()` returns `number[]`
  - Removed `getTrackById()` method
  - All track operations now accept `handle: number` instead of `trackId: number`

### 3. `packages/libgpod-node/src/database.ts`
- Added `createHandle(index: number)` helper method
- Updated all public methods:
  - `getTracks(): TrackHandle[]`
  - `getTrack(handle: TrackHandle): Track` (NEW)
  - `addTrack(input: TrackInput): TrackHandle`
  - `getTrackByDbId(dbid: bigint): TrackHandle | null`
  - `copyTrackToDevice(handle, path): Track`
  - `removeTrack(handle): void`
  - `updateTrack(handle, fields): Track`
  - `getTrackFilePath(handle): string | null`
  - `duplicateTrack(handle): TrackHandle`
  - `setTrackArtwork(handle, path): Track`
  - `setTrackArtworkFromData(handle, data): Track`
  - `removeTrackArtwork(handle): Track`
  - `hasTrackArtwork(handle): boolean`
  - `addTrackToPlaylist(playlistId, track): Playlist`
  - `removeTrackFromPlaylist(playlistId, track): Playlist`
  - `playlistContainsTrack(playlistId, track): boolean`
  - `getPlaylistTracks(playlistId): TrackHandle[]`
  - `evaluateSmartPlaylist(playlistId): TrackHandle[]`
  - `getTrackChapters(handle): Chapter[]`
  - `setTrackChapters(handle, chapters): Chapter[]`
  - `addTrackChapter(handle, startPos, title): Chapter[]`
  - `clearTrackChapters(handle): void`
- Removed `getTrackById()` method
- Updated all JSDoc comments and examples

### 4. `packages/libgpod-node/src/index.ts`
- Added `TrackHandle` to the type exports

## Verification

- TypeScript build succeeds with no errors
- Generated declaration files have correct method signatures
- TrackHandle is properly exported

## Next Steps

TASK-042.03 needs to update tests to use the new TrackHandle-based API.
<!-- SECTION:FINAL_SUMMARY:END -->
