---
id: TASK-048
title: Update sync executor to use IpodDatabase
status: Done
assignee: []
created_date: '2026-02-25 21:23'
updated_date: '2026-02-25 23:09'
labels:
  - podkit-core
  - implementation
dependencies:
  - TASK-047
documentation:
  - doc-001
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Update `DefaultSyncExecutor` to use `IpodDatabase` instead of raw libgpod-node `Database`.

## Files to Modify

- `packages/podkit-core/src/sync/executor.ts`
- `packages/podkit-core/src/sync/types.ts` (if needed)

## Changes

### ExecutorDependencies

```typescript
// Before
interface ExecutorDependencies {
  database: Database;
  transcoder: FFmpegTranscoder;
}

// After
interface ExecutorDependencies {
  ipod: IpodDatabase;
  transcoder: FFmpegTranscoder;
}
```

### Executor Implementation

Update all Database calls to use IpodDatabase:

```typescript
// Before
const handle = this.database.addTrack(trackInput);
this.database.copyTrackToDevice(handle, outputPath);

// After
const track = this.ipod.addTrack(trackInput);
track.copyFile(outputPath);
```

### Remove Operations

```typescript
// Before
const handles = this.database.getTracks();
for (const handle of handles) {
  const track = this.database.getTrack(handle);
  if (track.id === targetTrack.id) {
    this.database.removeTrack(handle);
  }
}

// After
// The IPodTrack from the plan can be used directly
operation.track.remove();
```

## Tests

- Update existing executor tests to use IpodDatabase
- Ensure all sync operations still work
- Integration tests with gpod-testing

## Dependencies

- TASK-047 (IpodDatabase)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ExecutorDependencies updated to use IpodDatabase
- [ ] #2 DefaultSyncExecutor uses IpodDatabase API
- [ ] #3 All existing executor tests pass
- [ ] #4 No direct libgpod-node imports in executor
- [ ] #5 Integration tests verify sync still works
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Updated `DefaultSyncExecutor` to use `IpodDatabase` instead of raw libgpod-node `Database`.

## Changes Made

### Core Changes

1. **`packages/podkit-core/src/sync/executor.ts`**
   - Changed `ExecutorDependencies.database: Database` to `ExecutorDependencies.ipod: IpodDatabase`
   - Updated `DefaultSyncExecutor` to use `this.ipod` instead of `this.database`
   - `executeTranscode()` now uses `this.ipod.addTrack()` and `track.copyFile()`
   - `executeCopy()` now uses `this.ipod.addTrack()` and `track.copyFile()`
   - `executeRemove()` now uses `track.remove()` (fluent API) with fallback to finding by metadata
   - Return types updated from `{ track: Track, handle: TrackHandle }` to `{ track: IPodTrack }`

2. **`packages/podkit-core/src/sync/types.ts`**
   - Removed local `IPodTrack` interface definition
   - Now re-exports `IPodTrack` from `../ipod/types.js` - provides full interface with methods (`remove()`, `update()`, `copyFile()`, etc.)

3. **`packages/podkit-core/src/sync/differ.ts`**
   - Changed track deduplication from using `id` to using `filePath`
   - `filePath` is unique per track and serves as a stable identifier

### Test Updates

4. **`packages/podkit-core/src/sync/executor.test.ts`**
   - Updated mock database from `MockDatabase` to `MockIpodDatabase`
   - Updated `createMockIPodTrack()` and `createIPodTrack()` to return full `IPodTrack` objects with methods
   - Updated tests to verify `track.remove()` is called instead of `database.removeTrack(handle)`
   - Removed assertions for `copyTrackToDevice` (now handled by `track.copyFile()`)

5. **`packages/podkit-core/src/sync/differ.test.ts`**
   - Added unique `filePath` counter for test tracks
   - Removed `id` property usage (IPodTrack no longer has `id`)

6. **`packages/podkit-core/src/sync/matching.test.ts`**
   - Added unique `filePath` counter for test tracks

7. **`packages/podkit-core/src/sync/planner.test.ts`**
   - Added unique `filePath` counter for test tracks
   - Removed `{ id: ... }` usage in test track creation

8. **`packages/podkit-core/src/sync/executor.integration.test.ts`**
   - Updated remove test to use actual `IPodTrack` from `IpodDatabase.getTracks()` instead of manually constructing track object

## Design Decisions

1. **Track Identification**: Switched from `id` to `filePath` for track identification since `IPodTrack` no longer exposes the libgpod internal ID. `filePath` is unique per track on the iPod.

2. **Remove Operation**: The executor checks if the track has a `remove()` method (indicating it came from `IpodDatabase`) and uses it directly. Falls back to finding by metadata for legacy sources.

3. **No `save()`/`close()` in Executor**: The executor does NOT call `ipod.save()` or `ipod.close()` - that remains the caller's responsibility (maintains single-responsibility principle).

## Verification

- `bun run typecheck` (podkit-core): PASS
- `bun run lint`: PASS (only pre-existing warnings in libgpod-node)
- `bun run test --filter=@podkit/core`: 555 pass, 3 skip, 0 fail
<!-- SECTION:FINAL_SUMMARY:END -->
