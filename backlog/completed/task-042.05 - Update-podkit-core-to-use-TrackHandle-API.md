---
id: TASK-042.05
title: Update podkit-core to use TrackHandle API
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 16:51'
labels:
  - podkit-core
dependencies:
  - TASK-042
parent_task_id: TASK-042
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After libgpod-node is updated, update podkit-core to use the new TrackHandle-based API.

## Executor Changes (`sync/executor.ts`)

The executor currently does:
```typescript
const track = this.database.addTrack(trackInput);
this.database.copyTrackToDevice(track.id, outputPath);
```

Update to:
```typescript
const handle = this.database.addTrack(trackInput);
this.database.copyTrackToDevice(handle, outputPath);
const track = this.database.getTrack(handle);
```

## Review All Database Usage

Search for all usages of:
- `db.addTrack()`
- `db.copyTrackToDevice()`
- `db.removeTrack()`
- `db.updateTrack()`
- `track.id` references
- `db.getTrackById()`

Update each to use TrackHandle.

## Test Updates

Update all integration tests in podkit-core that use libgpod-node:
- `executor.integration.test.ts`
- Any other files using Database operations

## Consider Convenience Methods

If common patterns emerge (e.g., add track + copy file + get data), consider adding convenience methods to podkit-core (not libgpod-node) that wrap multiple operations.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

Updated podkit-core executor to use TrackHandle API:
- executeTranscode(): Returns handle from addTrack, passes to copyTrackToDevice
- executeCopy(): Same pattern
- executeRemove(): Iterates getTracks() to find handle by track.id, then removes

Unit and integration tests updated. All 427 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Updated podkit-core to use the new TrackHandle-based API from libgpod-node. The changes fix the build errors and maintain backward compatibility with the existing sync flow.

## Changes Made

### `/packages/podkit-core/src/sync/executor.ts`

1. **Import TrackHandle type** - Added `TrackHandle` to the imports from `@podkit/libgpod-node`

2. **Updated `executeTranscode()`** - Now returns `TrackHandle` along with `Track`:
   - `addTrack()` returns a `TrackHandle` instead of a `Track`
   - `copyTrackToDevice()` takes the `TrackHandle` directly instead of `track.id`
   - Returns both `track` and `handle` for flexibility

3. **Updated `executeCopy()`** - Same pattern as transcode:
   - Store the `TrackHandle` from `addTrack()`
   - Pass `handle` to `copyTrackToDevice()` instead of `track.id`
   - Returns both `track` and `handle`

4. **Updated `executeRemove()`** - Now finds the track handle by ID:
   - Gets all track handles via `getTracks()`
   - Iterates through handles and uses `getTrack()` to find the one matching the `IPodTrack.id`
   - Throws a descriptive error if track not found
   - Passes the found `TrackHandle` to `removeTrack()`

5. **Updated `executeOperation()` return type** - Now includes optional `handle` field

### `/packages/podkit-core/src/sync/executor.integration.test.ts`

1. **Updated track verification** - `getTracks()` now returns `TrackHandle[]`, so we call `getTrack(handle)` to get the track data
2. **Updated remove operation test** - Uses `TrackHandle` from `addTrack()` with `copyTrackToDevice()` and accesses `savedTrack.id!` with non-null assertion

### `/packages/podkit-core/src/sync/executor.test.ts`

1. **Enhanced mock database** - Added `getTracks` and `getTrack` methods to support the remove operation
2. **Updated `createMockDatabase()`** - Now accepts initial tracks for pre-populating the mock database
3. **Updated remove tests** - Pre-populate mock with tracks to remove, verify `TrackHandle` is passed to `removeTrack()`

## API Change Summary

```typescript
// OLD API
const track = db.addTrack({ title: 'Song' });
db.copyTrackToDevice(track.id, path);
db.removeTrack(track.id);

// NEW API
const handle = db.addTrack({ title: 'Song' });
db.copyTrackToDevice(handle, path);
const track = db.getTrack(handle);
db.removeTrack(handle);
```

## Test Results

All 427 tests pass (55 executor tests specifically).
<!-- SECTION:FINAL_SUMMARY:END -->
