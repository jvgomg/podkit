---
id: TASK-010
title: Implement write track to iPod functionality
status: Done
assignee: []
created_date: '2026-02-22 19:09'
updated_date: '2026-02-22 23:18'
labels: []
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-009
references:
  - docs/LIBGPOD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add functionality to write a single track to iPod.

**Implementation:**
- Create new Itdb_Track with metadata
- Add track to database (itdb_track_add)
- Copy audio file to iPod storage (itdb_cp_track_to_ipod)
- Write database changes (itdb_write)

**Considerations:**
- File must be in iPod-compatible format (MP3, AAC) - transcoding is M2
- Metadata must be set before adding
- Handle errors gracefully (disk full, write protected, etc.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Can add a new track to iPod database
- [x] #2 Audio file copied to correct iPod location
- [x] #3 Database written successfully
- [x] #4 Metadata preserved on track
- [x] #5 Error handling for common failure cases
- [x] #6 Unit tests for track writing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Analysis (2026-02-22)

Examined existing implementation:
- `addTrack()` in database.ts only adds metadata (comment confirms this)
- `AddTrack()` in gpod_binding.cc calls `itdb_track_add()` but NOT `itdb_cp_track_to_ipod()`
- The `copyTrackToDevice()` method mentioned in the comment does not exist

**Needs implementation:**
1. Add `copyTrackToDevice()` native method calling `itdb_cp_track_to_ipod()`
2. Add corresponding TypeScript wrapper
3. Update types to include source file path option
4. Error handling for file copy failures

## Implementation Complete (2026-02-22)

**Changes made:**

### Native Binding (gpod_binding.cc)
- Added `CopyTrackToDevice()` method that calls `itdb_cp_track_to_ipod()`
- Takes track ID and source file path
- Returns updated track object with `ipod_path` set
- Proper error handling for missing track, file copy failures

### TypeScript Interface (binding.ts)
- Added `copyTrackToDevice(trackId: number, sourcePath: string): Track` to `NativeDatabase` interface

### Database Wrapper (database.ts)
- Added `copyTrackToDevice()` method with proper error wrapping
- Added `copyTrackToDeviceAsync()` for async consistency
- Full JSDoc documentation with usage example

### Integration Tests (index.integration.test.ts)
- Added 6 new tests covering:
  - Successful file copy to iPod storage
  - Error handling for non-existent source file
  - Error handling for invalid track ID
  - Copying multiple tracks (with ID assignment workaround)
  - Metadata preservation after file copy
  - Async version functionality

**Verification:**
- `bun run typecheck` - PASS
- `bun run lint` - PASS  
- `bun run test` - All 51 tests pass

**Note on track IDs:** Track IDs are 0 until `itdb_write()` is called. When adding multiple tracks, either save between adds or copy immediately after each add.

## Code Review (2026-02-22)

**Reviewer verdict: APPROVED**

### Implementation Quality
- Native binding correctly calls `itdb_cp_track_to_ipod()` with proper GError handling
- TypeScript wrapper provides clean API with proper error wrapping
- Both sync and async methods available for consistency
- Comprehensive JSDoc documentation with usage examples

### Test Coverage
6 integration tests cover:
- Successful file copy with path and file verification
- Error handling for non-existent files
- Error handling for invalid track IDs  
- Multiple track copying
- Metadata preservation
- Async API functionality

### Verification
- `bun run typecheck`: PASS
- `bun run lint`: PASS  
- `bun run build` (libgpod-node): SUCCESS
- `bun run test:integration`: 20/20 tests pass
<!-- SECTION:NOTES:END -->
