---
id: TASK-045
title: Implement IPodTrack class
status: Done
assignee: []
created_date: '2026-02-25 21:23'
updated_date: '2026-02-25 22:46'
labels:
  - podkit-core
  - implementation
dependencies:
  - TASK-044
documentation:
  - doc-001
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Implement the `IPodTrack` class that wraps libgpod-node's TrackHandle and provides fluent methods for track operations.

## File

`packages/podkit-core/src/ipod/track.ts`

## Implementation

```typescript
class IpodTrackImpl implements IPodTrack {
  // Internal state
  private readonly _db: IpodDatabaseImpl;
  private readonly _handle: TrackHandle;
  private _removed: boolean = false;

  // Read-only properties from Track snapshot
  readonly title: string;
  readonly artist: string;
  // ... all other fields from IPodTrack interface

  constructor(db: IpodDatabaseImpl, handle: TrackHandle, data: Track);

  // Methods
  update(fields: TrackFields): IPodTrack;
  remove(): void;
  copyFile(sourcePath: string): IPodTrack;
  setArtwork(imagePath: string): IPodTrack;
  setArtworkFromData(imageData: Buffer): IPodTrack;
  removeArtwork(): IPodTrack;
}
```

## Behavior

- All methods delegate to the parent IpodDatabase
- `update()`, `copyFile()`, `setArtwork()` return NEW snapshot instances
- `remove()` marks track as removed; subsequent operations throw IpodError
- Track holds reference to database for operations

## Tests

- Constructor correctly copies all fields from Track
- `update()` returns new instance with updated values
- `remove()` marks track as removed
- Operations on removed track throw IpodError('TRACK_REMOVED')
- `copyFile()` delegates to database and returns new snapshot
- Artwork methods delegate correctly

## Dependencies

- TASK-044 (types) must be complete
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IpodTrackImpl class implemented
- [x] #2 All IPodTrack interface methods working
- [x] #3 Methods return new snapshots (immutable)
- [x] #4 Removed track throws on operations
- [x] #5 Unit tests with good coverage
- [x] #6 Integration tests with mock database
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented `IpodTrackImpl` class that wraps libgpod-node's TrackHandle and provides fluent methods for track operations.

## Files Created

- `/packages/podkit-core/src/ipod/track.ts` - IpodTrackImpl implementation
- `/packages/podkit-core/src/ipod/track.test.ts` - Comprehensive unit tests

## Files Modified

- `/packages/podkit-core/src/ipod/index.ts` - Added exports for IpodTrackImpl and IpodDatabaseInternal
- `/packages/podkit-core/src/ipod/playlist.test.ts` - Fixed to use bun:test instead of vitest (pre-existing issue)

## Implementation Details

1. **IpodTrackImpl class** - Implements IPodTrack interface with:
   - All read-only properties copied from Track snapshot at construction time
   - Internal `_handle` for libgpod-node TrackHandle
   - Internal `_removed` flag for tracking removed state
   - All methods delegate to parent database via IpodDatabaseInternal interface

2. **IpodDatabaseInternal interface** - Defines operations the track can delegate:
   - `updateTrack()`, `removeTrack()`, `copyFileToTrack()`
   - `setTrackArtwork()`, `setTrackArtworkFromData()`, `removeTrackArtwork()`

3. **Removed track protection** - All methods call `assertNotRemoved()` before delegating, throwing IpodError with code 'TRACK_REMOVED'

4. **Immutable snapshot pattern** - Methods like `update()`, `copyFile()`, `setArtwork()` return new IPodTrack instances

## Test Coverage (18 tests passing)

- Constructor tests: Field copying, default value handling, handle preservation
- Method delegation tests: All 6 methods verified to delegate correctly
- Removed track behavior: All methods throw appropriate errors
- Read-only property verification

## Verification

- `bun run typecheck` (podkit-core): Passes
- `bun run lint`: Passes (no new errors)
- `bun test packages/podkit-core`: 518 tests pass, 3 skipped
<!-- SECTION:FINAL_SUMMARY:END -->
