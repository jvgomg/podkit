---
id: TASK-042.02
title: Create TrackHandle type and update TypeScript API
status: To Do
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 15:36'
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
<!-- SECTION:NOTES:END -->
