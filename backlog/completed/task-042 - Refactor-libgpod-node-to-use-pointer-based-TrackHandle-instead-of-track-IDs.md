---
id: TASK-042
title: Refactor libgpod-node to use pointer-based TrackHandle instead of track IDs
status: Done
assignee: []
created_date: '2026-02-25 13:37'
updated_date: '2026-02-25 16:55'
labels:
  - libgpod-node
  - breaking-change
  - api-design
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

The current libgpod-node implementation incorrectly uses `track->id` and `itdb_track_by_id()` as the primary mechanism for referencing tracks. This is fundamentally broken because:

1. `track->id` is 0 for all newly added tracks until `itdb_write()` is called
2. libgpod's own documentation says `itdb_track_by_id()` is **"not really a good idea"** - it's only for internal use during iTunesDB import
3. Track IDs are **reassigned on every `itdb_write()`** - they're not stable identifiers

Real-world libgpod users (like Strawberry) use `Itdb_Track*` pointers directly and never call `itdb_track_by_id()`.

## Current Broken Behavior

```typescript
const track1 = db.addTrack({ title: 'Song 1' });  // id: 0
const track2 = db.addTrack({ title: 'Song 2' });  // id: 0

// BROKEN: Both have id=0, so this operates on wrong track
db.copyTrackToDevice(track2.id, '/path/to/file.mp3');
```

## Target Design

```typescript
const handle1 = db.addTrack({ title: 'Song 1' });  // Returns TrackHandle
const handle2 = db.addTrack({ title: 'Song 2' });  // Returns TrackHandle

// WORKS: Handle references the actual pointer internally
db.copyTrackToDevice(handle2, '/path/to/file.mp3');

// Get track data snapshot when needed
const track2Data: Track = db.getTrack(handle2);
```

## Key Design Principles

1. **API parity with libgpod** - The wrapper should mirror how libgpod actually works (pointer-based), not invent ID-based semantics
2. **TrackHandle is an opaque reference** - Internally backed by pointer, exposed as numeric index
3. **Track is a data snapshot** - The actual metadata, distinct from the handle
4. **Handles valid after save()** - Because pointers remain valid after `itdb_write()`
5. **Convenience operations belong in podkit-core** - libgpod-node stays thin
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TrackHandle type exists and is returned by addTrack(), getTracks()
- [x] #2 All track operations accept TrackHandle instead of trackId
- [x] #3 Multiple tracks can be added and operated on before save() without issues
- [x] #4 Handles remain valid after save()
- [x] #5 Track (data snapshot) and TrackHandle (reference) are distinct types
- [x] #6 getTrackById() is removed (not exposed) with documentation explaining why
- [x] #7 libgpod ID behavior is documented in LIBGPOD.md
- [x] #8 All existing tests updated and passing
- [x] #9 New tests cover multi-track operations before save
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Refactored libgpod-node to use pointer-based TrackHandle instead of track IDs, fixing a critical bug where multiple tracks added before save() all got the same file copied.

## Problem

The old API used `track->id` for track references, but:
- `track->id` is 0 for ALL newly added tracks until `itdb_write()` is called
- This caused operations like `copyTrackToDevice(track.id, path)` to operate on the wrong track
- libgpod's own docs say `itdb_track_by_id()` is "not really a good idea"

## Solution

Introduced `TrackHandle` - an opaque handle backed by the native track pointer:

```typescript
// OLD (broken for multiple tracks before save)
const track = db.addTrack({ title: 'Song' });
db.copyTrackToDevice(track.id, path);  // track.id is 0!

// NEW (works correctly)
const handle = db.addTrack({ title: 'Song' });
db.copyTrackToDevice(handle, path);    // handle references correct track
const track = db.getTrack(handle);     // get data when needed
```

## Changes Made

### TASK-042.01: Native C++ Layer
- Added pointer-to-handle mapping in DatabaseWrapper
- All native methods accept handle indices instead of track IDs
- `getTracks()` returns handle indices, `getTrackData(handle)` returns Track
- Removed `getTrackById()`

### TASK-042.02: TypeScript API
- Added `TrackHandle` interface with branded type pattern
- Updated `NativeDatabase` interface to match native API
- Updated all `Database` methods to use TrackHandle
- Added `getTrack(handle)` for retrieving track data

### TASK-042.03: libgpod-node Tests
- Updated all 7 integration test files to use TrackHandle pattern
- 257 tests passing (3 pre-existing failures unrelated to this task)
- Fixed bug in `getTrackByDbId()` null handling

### TASK-042.04: Documentation
- Added comprehensive "Track Identification" section to LIBGPOD.md
- Documents why track IDs are unstable and why TrackHandle is used
- Includes Strawberry codebase analysis showing real-world usage patterns

### TASK-042.05: podkit-core Updates
- Updated sync executor to use TrackHandle API
- Remove operation now finds handle by iterating and matching track.id
- All 427 tests passing

### TASK-042.06: API Review
- Confirmed sync APIs are correctly designed
- Sync plans are ephemeral (not persisted), so current design is sound
- Diff algorithm uses metadata matching, not track IDs

## Commits

1. 246fb19 - Implement pointer-based TrackHandle in native layer (TASK-042.01)
2. 76a084b - Update TypeScript API to use TrackHandle (TASK-042.02)
3. 105a413 - Update integration tests for TrackHandle API (TASK-042.03)
4. 09bc3ff - Update podkit-core executor for TrackHandle API (TASK-042.05)
5. 36cbb55 - Document libgpod track ID behavior (TASK-042.04)

## Breaking Changes

All code using libgpod-node must update to use `TrackHandle` instead of track IDs. The migration is straightforward:
- `addTrack()` returns `TrackHandle`, not `Track`
- Use `getTrack(handle)` to get track data
- Pass `handle` to operations instead of `track.id`
<!-- SECTION:FINAL_SUMMARY:END -->
