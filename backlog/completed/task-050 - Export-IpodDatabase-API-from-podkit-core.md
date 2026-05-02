---
id: TASK-050
title: Export IpodDatabase API from @podkit/core
status: Done
assignee: []
created_date: '2026-02-25 21:24'
updated_date: '2026-02-25 23:09'
labels:
  - podkit-core
  - implementation
dependencies:
  - TASK-047
documentation:
  - doc-001
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Update `@podkit/core` exports to include the new IpodDatabase API.

## File to Modify

`packages/podkit-core/src/index.ts`

## Exports to Add

```typescript
// iPod database abstraction
export { IpodDatabase } from './ipod/database.js';

export type {
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  TrackInput,
  TrackFields,
  SaveResult,
} from './ipod/types.js';

export { IpodError } from './ipod/errors.js';
export type { IpodErrorCode } from './ipod/errors.js';

export { MediaType } from './ipod/constants.js';
```

## Also Update

- Remove or deprecate the old `IPodTrack` type from `sync/types.ts` (now replaced by new IPodTrack)
- Update any internal references

## Tests

- Verify all exports are accessible
- No breaking changes to existing exports

## Dependencies

- TASK-047 (IpodDatabase implementation)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All IpodDatabase types exported from @podkit/core
- [x] #2 IpodError exported
- [x] #3 MediaType constants exported
- [x] #4 Old IPodTrack type handled (deprecated or removed)
- [x] #5 No breaking changes to existing exports
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Review 2026-02-25

Checked current state of exports in `packages/podkit-core/src/index.ts`.

### Already Exported (TASK-047 or earlier work)
- `IpodDatabase` class
- `IpodError` class
- `IpodErrorCode` type
- `MediaType` constants
- `MediaTypeValue` type
- Types: `TrackInput`, `TrackFields`, `IpodTrackInterface` (aliased from `IPodTrack`), `IpodPlaylist`, `IpodDeviceInfo`, `IpodInfo`, `SaveResult`

### Name Conflict Resolution
The old `IPodTrack` from `./sync/types.ts` conflicts with the new `IPodTrack` from `./ipod/types.js`.

Current solution: The new type is exported as `IpodTrackInterface` to avoid the conflict. The old `IPodTrack` is still exported for sync engine compatibility.

### Tests
- Most exports are already tested in `index.test.ts`
- Missing: Test for `IpodDatabase` export

## Test Migration

The `sync/types.ts` file has been updated to import and re-export `IPodTrack` from `ipod/types.js`. This means all tests using `IPodTrack` with the old `id` field need to be updated.

Test files that need updating:
- `src/sync/differ.test.ts`
- `src/sync/executor.test.ts`
- `src/sync/executor.integration.test.ts`
- `src/sync/matching.test.ts`
- `src/sync/planner.test.ts`

Changes needed:
1. Remove `id` field from mock IPodTrack objects
2. Add required fields: `size`, `mediaType`, `timeAdded`, `timeModified`, `timePlayed`, `timeReleased`, `playCount`, `skipCount`, `rating`, `hasFile`, `compilation`
3. Add method stubs: `update()`, `remove()`, `copyFile()`, `setArtwork()`, `setArtworkFromData()`, `removeArtwork()`
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Completed TASK-050: Export IpodDatabase API from @podkit/core

### What Was Already Done (TASK-047)
The exports were already added to `packages/podkit-core/src/index.ts`:
- `IpodDatabase` class export
- `IpodError` class and `IpodErrorCode` type exports
- `MediaType` constants and `MediaTypeValue` type exports
- All types from `ipod/types.js`: `TrackInput`, `TrackFields`, `IpodTrackInterface`, `IpodPlaylist`, `IpodDeviceInfo`, `IpodInfo`, `SaveResult`

### What This Task Added

1. **Export Test for `IpodDatabase`**
   - Added test verifying `IpodDatabase` is properly exported in `index.test.ts`

2. **Updated Sync Engine to Use IpodDatabase**
   - Updated `executor.ts` to use `IpodDatabase` instead of low-level `Database`
   - Changed `ExecutorDependencies` property from `database` to `ipod`
   - Updated `executeTranscode`, `executeCopy`, and `executeRemove` methods to use the new API

3. **Test Migration to New IPodTrack Interface**
   The `sync/types.ts` was updated to re-export `IPodTrack` from `ipod/types.js`. This required updating all test files that create mock `IPodTrack` objects:
   - `differ.test.ts`
   - `executor.test.ts`
   - `executor.integration.test.ts`
   - `matching.test.ts`
   - `planner.test.ts`

   Changes made to tests:
   - Removed `id` field (not present in new interface)
   - Added required fields: `size`, `mediaType`, `timeAdded`, `timeModified`, `timePlayed`, `timeReleased`, `playCount`, `skipCount`, `rating`, `hasFile`, `compilation`
   - Added method stubs: `update()`, `remove()`, `copyFile()`, `setArtwork()`, `setArtworkFromData()`, `removeArtwork()`
   - Used unique `filePath` for each track (required for differ to correctly identify unmatched tracks)

### Type Conflict Resolution
Two `IPodTrack` types exist:
- New: `ipod/types.ts` - Full interface with methods for the abstraction layer
- Old (now removed): `sync/types.ts` - Was a simple data-only interface

Resolution: `sync/types.ts` now imports and re-exports from `ipod/types.ts`, unifying the types.

### Verification
- `bun run typecheck --filter=@podkit/core` - PASSED
- `bun run lint` - PASSED (only warnings in unrelated files)
- `bun test packages/podkit-core` - 555 pass, 3 skip, 0 fail
<!-- SECTION:FINAL_SUMMARY:END -->
