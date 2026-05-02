---
id: TASK-044
title: Implement IpodDatabase types and error classes
status: Done
assignee: []
created_date: '2026-02-25 21:23'
updated_date: '2026-02-25 22:39'
labels:
  - podkit-core
  - implementation
dependencies: []
documentation:
  - doc-001
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Create the foundational TypeScript types and error classes for the IpodDatabase API in `@podkit/core`.

## Files to Create

```
packages/podkit-core/src/ipod/
├── types.ts        # All interfaces and type definitions
├── errors.ts       # IpodError class and error codes
├── constants.ts    # MediaType constants
└── index.ts        # Re-exports
```

## Types to Implement

From spec (doc-001):

- `TrackInput` - Input for creating tracks
- `TrackFields` - Fields that can be updated
- `IPodTrack` - Track interface (without implementation)
- `IpodPlaylist` - Playlist interface (without implementation)
- `IpodDeviceInfo` - Device information
- `IpodInfo` - Database info
- `SaveResult` - Result from save()
- `MediaType` - Media type flag constants

## Error Types

```typescript
class IpodError extends Error {
  readonly code: IpodErrorCode;
}

type IpodErrorCode = 
  | 'NOT_FOUND'
  | 'DATABASE_CORRUPT'
  | 'TRACK_REMOVED'
  | 'PLAYLIST_REMOVED'
  | 'FILE_NOT_FOUND'
  | 'COPY_FAILED'
  | 'ARTWORK_FAILED'
  | 'SAVE_FAILED'
  | 'DATABASE_CLOSED';
```

## Tests

- Type checking (compile-time)
- IpodError construction and properties
- MediaType constant values match libgpod-node

## Notes

- Reference doc-001 for complete type definitions
- Types should NOT import from libgpod-node (that's the whole point)
- This task has no dependencies and can start immediately
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All type interfaces defined in types.ts
- [x] #2 IpodError class implemented with all error codes
- [x] #3 MediaType constants exported
- [x] #4 Unit tests for IpodError
- [x] #5 Types compile without errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started implementation - creating ipod/ directory with types.ts, errors.ts, constants.ts, and index.ts
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented foundational TypeScript types and error classes for the IpodDatabase API in `@podkit/core`.

## Files Created

- `packages/podkit-core/src/ipod/types.ts` - All interfaces: TrackInput, TrackFields, IPodTrack, IpodPlaylist, IpodDeviceInfo, IpodInfo, SaveResult
- `packages/podkit-core/src/ipod/errors.ts` - IpodError class with IpodErrorCode type (9 error codes)
- `packages/podkit-core/src/ipod/constants.ts` - MediaType constants (Audio, Podcast, Audiobook, MusicVideo, TVShow)
- `packages/podkit-core/src/ipod/index.ts` - Re-exports all types and values
- `packages/podkit-core/src/ipod/errors.test.ts` - 27 tests for IpodError
- `packages/podkit-core/src/ipod/constants.test.ts` - Tests for MediaType constants

## Files Modified

- `packages/podkit-core/src/index.ts` - Added exports for new ipod module (IPodTrack exported as IpodTrackInterface to avoid conflict with existing sync/types.ts IPodTrack)
- `packages/podkit-core/src/index.test.ts` - Added 11 tests verifying new exports work

## Design Decisions

1. **IPodTrack naming**: Exported as `IpodTrackInterface` from main index to avoid conflict with existing `IPodTrack` in sync/types.ts. The sync types IPodTrack is a simpler data-only interface, while the new one has methods. These will be unified when the full migration is complete.

2. **JSDoc documentation**: Added comprehensive JSDoc comments to all public APIs with usage examples.

3. **MediaType subset**: Only included the 5 most common media types (Audio, Podcast, Audiobook, MusicVideo, TVShow) as specified, rather than all types from libgpod-node.

4. **Error.captureStackTrace**: Added for better stack traces in V8 environments.

## Test Coverage

- 27 tests for IpodError (construction, all error codes, error handling patterns)
- Tests for MediaType constants (values, uniqueness, usage patterns)
- 11 new tests in index.test.ts for export verification

## Verification

- `bun run typecheck` passes for podkit-core
- `bun run lint` passes (only pre-existing warnings)
- `bun run test packages/podkit-core` - 465 tests pass
<!-- SECTION:FINAL_SUMMARY:END -->
