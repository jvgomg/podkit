---
id: TASK-021
title: Implement sync executor
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-23 00:39'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-020
  - TASK-019
  - TASK-010
references:
  - docs/ARCHITECTURE.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the executor that runs a sync plan.

**Execution flow:**
1. For each operation in plan:
   - Transcode if needed (TASK-019)
   - Extract artwork (can be deferred to M3)
   - Add track to iPod database (TASK-010)
   - Copy file to iPod
   - Report progress
2. Write iPod database

**Implementation:**
- Progress reporting (async iterator or callbacks)
- Error handling and recovery
- Dry-run support (simulate without writing)

**Testing requirements:**
- Unit tests with mocked dependencies
- Integration test with test iPod environment
- Test progress reporting
- Test error recovery
- Test dry-run mode
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Executor runs sync plan correctly
- [x] #2 Progress reporting works
- [x] #3 Dry-run mode implemented
- [x] #4 Error handling and recovery
- [x] #5 Integration test with test iPod environment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented the sync executor at `packages/podkit-core/src/sync/executor.ts` with the following features:

### Core Implementation

1. **DefaultSyncExecutor class** - Implements the `SyncExecutor` interface with async generator for progress reporting

2. **Operation execution**:
   - `transcode`: Uses FFmpegTranscoder to convert audio, then adds to iPod via Database.addTrack() and copyTrackToDevice()
   - `copy`: Directly adds compatible formats to iPod
   - `remove`: Removes tracks from iPod database
   - `update-metadata`: Placeholder for future implementation

3. **Progress reporting** via `ExecutorProgress` extending `SyncProgress`:
   - Phases: preparing, transcoding, copying, removing, updating-db, complete
   - Includes operation details, current index, bytes processed, and errors

4. **Dry-run mode**: Simulates operations without making changes

5. **Error handling**: 
   - `continueOnError` option to continue after failures
   - Errors included in progress events

6. **Abort signal support**: Checks signal before each operation

7. **Database saving**: Calls Database.save() after all operations

### Files Created/Modified

- `packages/podkit-core/src/sync/executor.ts` - Main implementation
- `packages/podkit-core/src/sync/executor.test.ts` - Unit tests (349 tests pass)
- `packages/podkit-core/src/sync/executor.integration.test.ts` - Integration tests
- `packages/podkit-core/src/sync/types.ts` - Added 'preparing' and 'removing' phases
- `packages/podkit-core/src/index.ts` - Exported new types and functions
- `packages/podkit-core/package.json` - Added @podkit/gpod-testing dev dependency

### Exported API

- `DefaultSyncExecutor` - Main executor class
- `createExecutor()` - Factory function
- `executePlan()` - Convenience function that returns ExecuteResult
- `getOperationDisplayName()` - Helper for progress display
- Types: `ExecutorProgress`, `ExtendedExecuteOptions`, `ExecuteResult`, `ExecutorDependencies`

## Review Notes (2026-02-23)

**Verified by:** Code review

### Implementation Quality

The sync executor implementation is well-structured and complete:

1. **Operation Execution**: All operation types are handled correctly:
   - `transcode`: Uses FFmpegTranscoder, then adds track and copies to device
   - `copy`: Direct add to iPod database and copy to device
   - `remove`: Removes track from database
   - `update-metadata`: Placeholder for future implementation (acceptable for current milestone)

2. **Progress Reporting**: Excellent async iterator-based progress reporting:
   - Phases: preparing, transcoding, copying, removing, updating-db, complete
   - Includes operation details, index, bytes processed, errors
   - Clean progress event structure via `ExecutorProgress` type

3. **Dry-Run Mode**: Properly implemented:
   - No database calls in dry-run mode
   - No transcoder calls in dry-run mode
   - Progress events marked with `skipped: true`

4. **Error Handling**: Good design:
   - `continueOnError` option to continue after failures
   - Errors included in progress events
   - Proper error propagation when `continueOnError` is false

5. **Additional Features**:
   - Abort signal support with checks before each operation
   - Temp directory cleanup in finally block
   - Database save after all operations
   - Filetype detection for different audio formats

### Test Coverage

- **Unit tests** (349 tests passing): Comprehensive mocked tests covering:
  - Basic execution flow for all operation types
  - Progress reporting phases and data
  - Dry-run mode behavior
  - Error handling (stop vs continue)
  - Abort signal support
  - Factory functions
  - Filetype detection

- **Integration tests**: Well-structured tests that:
  - Test with real iPod database via gpod-testing
  - Test copy, transcode, and remove operations
  - Verify progress reporting
  - Test dry-run mode
  - Gracefully skip when dependencies unavailable

### Verification

- `bun run typecheck` - PASS
- `bun run lint` - PASS (0 warnings, 0 errors)
- `bun run test:unit` - PASS (349 tests)

### All Acceptance Criteria Met

- [x] Executor runs sync plan correctly
- [x] Progress reporting works
- [x] Dry-run mode implemented
- [x] Error handling and recovery
- [x] Integration test with test iPod environment
<!-- SECTION:NOTES:END -->
