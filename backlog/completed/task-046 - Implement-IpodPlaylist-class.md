---
id: TASK-046
title: Implement IpodPlaylist class
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

Implement the `IpodPlaylist` class that wraps libgpod-node's playlist operations and provides fluent methods.

## File

`packages/podkit-core/src/ipod/playlist.ts`

## Implementation

```typescript
class IpodPlaylistImpl implements IpodPlaylist {
  // Internal state
  private readonly _db: IpodDatabaseImpl;
  private readonly _playlistId: bigint;
  private _removed: boolean = false;

  // Read-only properties
  readonly name: string;
  readonly trackCount: number;
  readonly isMaster: boolean;
  readonly isSmart: boolean;
  readonly isPodcasts: boolean;
  readonly timestamp: number;

  constructor(db: IpodDatabaseImpl, playlistId: bigint, data: Playlist);

  // Methods
  rename(newName: string): IpodPlaylist;
  remove(): void;
  getTracks(): IPodTrack[];
  addTrack(track: IPodTrack): IpodPlaylist;
  removeTrack(track: IPodTrack): IpodPlaylist;
  containsTrack(track: IPodTrack): boolean;
}
```

## Behavior

- Methods delegate to parent IpodDatabase
- `rename()`, `addTrack()`, `removeTrack()` return NEW snapshot for chaining
- `remove()` marks playlist as removed
- Master playlist cannot be removed or renamed (throw IpodError)
- Smart playlists are read-only for modification methods

## Tests

- Constructor correctly copies all fields
- `rename()` returns new instance
- `addTrack()` / `removeTrack()` work and return new snapshot
- `containsTrack()` correctly checks membership
- Cannot remove/rename master playlist
- Operations on removed playlist throw
- Smart playlist restrictions enforced

## Dependencies

- TASK-044 (types) must be complete
- Can be done in parallel with TASK-045 (IPodTrack)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IpodPlaylistImpl class implemented
- [x] #2 All IpodPlaylist interface methods working
- [x] #3 Methods return new snapshots (immutable)
- [x] #4 Master playlist protection working
- [x] #5 Removed playlist throws on operations
- [x] #6 Unit tests with good coverage
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented `IpodPlaylistImpl` class that wraps libgpod-node's playlist operations and provides fluent methods for playlist manipulation.

## Files Created/Modified

- **Created:** `/packages/podkit-core/src/ipod/playlist.ts` - Main implementation
- **Created:** `/packages/podkit-core/src/ipod/playlist.test.ts` - Unit tests
- **Modified:** `/packages/podkit-core/src/ipod/index.ts` - Added exports

## Implementation Details

### IpodPlaylistImpl Class

The class implements the `IpodPlaylist` interface with:

1. **Read-only snapshot properties:**
   - `name`, `trackCount`, `isMaster`, `isSmart`, `isPodcasts`, `timestamp`

2. **Fluent methods that return new snapshots:**
   - `rename(newName)` - Returns new IpodPlaylist
   - `addTrack(track)` - Returns new IpodPlaylist
   - `removeTrack(track)` - Returns new IpodPlaylist

3. **Other methods:**
   - `remove()` - Marks playlist as removed
   - `getTracks()` - Returns IPodTrack[]
   - `containsTrack(track)` - Returns boolean

4. **Internal state:**
   - `_internalId` getter for playlist bigint ID
   - `_markRemoved()` method for database to mark as removed

### PlaylistDatabaseInternal Interface

Defined internal interface with methods the playlist delegates to:
- `renamePlaylist()`, `removePlaylist()`, `getPlaylistTracks()`
- `addTrackToPlaylist()`, `removeTrackFromPlaylist()`, `playlistContainsTrack()`

### Protections

- **Master playlist:** Cannot be renamed or removed (throws IpodError with code PLAYLIST_REMOVED)
- **Removed playlist:** All operations check `_removed` flag and throw IpodError before delegating

## Test Coverage

35 unit tests covering:
- Constructor field copying including null name handling
- All method delegation to database
- Master playlist protection (rename and remove blocked)
- Removed playlist operations throwing PLAYLIST_REMOVED error
- All methods checking removed status before delegating

## Verification

- `bun run typecheck` (podkit-core): Pass
- `bun run lint`: Pass (0 errors)
- `bun test packages/podkit-core`: 518 pass, 3 skip, 0 fail
<!-- SECTION:FINAL_SUMMARY:END -->
