---
id: TASK-042.03
title: Update libgpod-node tests for TrackHandle API
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 16:45'
labels:
  - libgpod-node
  - testing
dependencies:
  - TASK-042.01
  - TASK-042.02
parent_task_id: TASK-042
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update all existing tests and add new tests for the TrackHandle-based API.

## Existing Test Updates

Update all tests in `packages/libgpod-node/src/__tests__/` to use TrackHandle:
- `database.integration.test.ts`
- `tracks.integration.test.ts`
- `artwork.integration.test.ts`
- `playlists.integration.test.ts`
- Any other test files using track operations

## New Test Cases

### Multi-track operations before save
```typescript
it('can add multiple tracks and operate on each before save', async () => {
  const handle1 = db.addTrack({ title: 'Track 1' });
  const handle2 = db.addTrack({ title: 'Track 2' });
  const handle3 = db.addTrack({ title: 'Track 3' });
  
  // All operations should work on correct tracks
  db.copyTrackToDevice(handle1, mp3Path1);
  db.copyTrackToDevice(handle2, mp3Path2);
  db.copyTrackToDevice(handle3, mp3Path3);
  
  db.setTrackThumbnails(handle2, artworkPath);
  
  await db.save();
  
  // Verify each track has correct data
  const track1 = db.getTrack(handle1);
  const track2 = db.getTrack(handle2);
  const track3 = db.getTrack(handle3);
  
  expect(track1.ipodPath).toBeTruthy();
  expect(track2.ipodPath).toBeTruthy();
  expect(track2.hasArtwork).toBe(true);
  expect(track3.ipodPath).toBeTruthy();
});
```

### Handle validity after save
```typescript
it('handles remain valid after save', async () => {
  const handle = db.addTrack({ title: 'Test' });
  db.copyTrackToDevice(handle, mp3Path);
  
  await db.save();
  
  // Handle should still work
  const track = db.getTrack(handle);
  expect(track.title).toBe('Test');
  
  // Can still operate on track
  db.updateTrack(handle, { title: 'Updated' });
});
```

### Handle invalidation on remove
```typescript
it('throws when using handle after track removed', async () => {
  const handle = db.addTrack({ title: 'Test' });
  db.removeTrack(handle);
  
  expect(() => db.getTrack(handle)).toThrow(/invalid.*handle/i);
});
```

### Existing tracks get handles
```typescript
it('getTracks returns handles for existing tracks', async () => {
  // Add tracks and save
  db.addTrack({ title: 'Existing 1' });
  db.addTrack({ title: 'Existing 2' });
  await db.save();
  db.close();
  
  // Reopen
  const db2 = await Database.open(ipodPath);
  const handles = db2.getTracks();
  
  expect(handles).toHaveLength(2);
  
  // Can operate on loaded tracks
  const track1 = db2.getTrack(handles[0]);
  expect(track1.title).toBe('Existing 1');
});
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All integration tests updated to use TrackHandle API
- [x] #2 Tests pass with new API (257/260 pass, 3 pre-existing failures)
- [x] #3 Lint passes (warnings only, no errors)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed (2026-02-25)

All libgpod-node integration tests have been updated to use the new TrackHandle-based API.

### Files Updated

1. **tracks.integration.test.ts** - Updated all track operations to use handles
2. **database.integration.test.ts** - Updated track CRUD tests
3. **artwork.integration.test.ts** - Updated artwork operations tests
4. **artwork-deduplication.integration.test.ts** - Updated deduplication tests
5. **playlists.integration.test.ts** - Updated playlist track operations
6. **smart-playlists.integration.test.ts** - Updated smart playlist evaluation tests
7. **chapters.integration.test.ts** - Updated chapter operations tests

### Key Changes

- Changed `addTrack()` calls to store returned `TrackHandle` in `handle` variables
- Added `db.getTrack(handle)` calls when track data is needed
- Updated all track operations (`copyTrackToDevice`, `setTrackArtwork`, `updateTrack`, etc.) to use handles instead of `track.id`
- Updated `getTracks()` return handling from `Track[]` to `TrackHandle[]`
- Updated `getPlaylistTracks()` return handling from `Track[]` to `TrackHandle[]`
- Updated `evaluateSmartPlaylist()` return handling from `Track[]` to `TrackHandle[]`
- Removed tests for invalid track ID since the API no longer uses track IDs

### Bug Fix

Fixed a bug in `Database.getTrackByDbId()` where the native layer returns `null` for non-existent tracks, but the TypeScript code only checked for `index < 0`. Added proper null check.

### Test Results

- 257 tests passing
- 3 tests failing (pre-existing TASK-037 artwork deduplication issues, unrelated to this task)
- Lint passes with only warnings (console.log for documentation purposes)

## Implementation Complete

All integration tests updated to use TrackHandle API:
- tracks.integration.test.ts
- database.integration.test.ts
- artwork.integration.test.ts
- artwork-deduplication.integration.test.ts
- playlists.integration.test.ts
- smart-playlists.integration.test.ts
- chapters.integration.test.ts

Also fixed a bug in database.ts getTrackByDbId() - added null check.

Results: 257 tests passing, 3 pre-existing failures (TASK-037).
<!-- SECTION:NOTES:END -->
