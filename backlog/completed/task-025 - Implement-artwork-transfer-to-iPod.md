---
id: TASK-025
title: Implement artwork transfer to iPod
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-23 01:46'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-024
  - TASK-021
references:
  - docs/LIBGPOD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transfer artwork to iPod via libgpod.

**Implementation:**
- Extract embedded artwork (from TASK-023)
- Pass to libgpod (itdb_track_set_thumbnails or equivalent)
- libgpod should handle resizing/format conversion based on device capabilities

**Note:** TASK-024 will confirm libgpod handles resize/format. Adjust implementation if preprocessing needed.

**Testing requirements:**
- Integration test with test iPod environment
- Verify artwork appears correctly on device
- Test tracks with and without artwork in same sync
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Artwork extracted and passed to libgpod
- [x] #2 libgpod handles device-specific formatting
- [x] #3 Integration test verifies artwork works
- [x] #4 Handles tracks without artwork gracefully
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Findings from TASK-024

**libgpod handles all artwork resizing and format conversion automatically.**

### Implementation Approach

1. **Extract artwork** from source audio files using music-metadata (TASK-023)
2. **Write to temp file** (JPEG or PNG) - file-based approach is more reliable than raw bytes
3. **Call `itdb_track_set_thumbnails(track, temp_path)`** - libgpod does the rest
4. **Delete temp file** after `itdb_write()` completes

### What libgpod Does Automatically

- Detects iPod model from SysInfo
- Queries supported artwork formats (sizes, pixel formats)
- Generates all required thumbnail sizes
- Converts to correct pixel format (RGB565, JPEG, etc.)
- Writes to `.ithmb` files

### Binding Function Needed

```cpp
Napi::Value SetTrackArtwork(const Napi::CallbackInfo& info) {
    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    std::string imagePath = info[1].As<Napi::String>().Utf8Value();
    
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    gboolean success = itdb_track_set_thumbnails(track, imagePath.c_str());
    
    return Napi::Boolean::New(env, success);
}
```

### Prerequisites

- SysInfo file must exist (gpod-tool init handles this)
- Artwork directory must exist (gpod-tool init handles this)
- libgpod compiled with gdk-pixbuf support (standard)

### Caveats

- Thumbnails generated lazily during `itdb_write()` - temp files must exist until then
- iTunes may "lose" artwork if it accesses tracks (expected behavior)

## Implementation Summary (2026-02-23)

### Native Binding Added

Added `setTrackThumbnails(trackId, imagePath)` method to `gpod_binding.cc` that calls libgpod's `itdb_track_set_thumbnails(track, filename)` function.

### TypeScript Wrapper

Added `setTrackArtwork(trackId, imagePath)` and `setTrackArtworkAsync(trackId, imagePath)` methods to the `Database` class in `database.ts`. The methods:
- Accept a track ID and path to an image file (JPEG/PNG)
- Call the native binding to set artwork via libgpod
- Throw `LibgpodError` on failure
- Return the updated track with `hasArtwork` set to `true`

### Integration Tests

Added comprehensive integration tests for artwork functionality:
- Setting artwork from JPEG file
- Setting artwork from PNG file
- Handling tracks without artwork gracefully
- Setting artwork on multiple tracks
- Error handling for non-existent image files
- Error handling for invalid track IDs
- Combining artwork with audio file copy
- Async API testing

### Files Changed

1. `packages/libgpod-node/native/gpod_binding.cc` - Added `SetTrackThumbnails` native method
2. `packages/libgpod-node/src/binding.ts` - Added `setTrackThumbnails` to interface
3. `packages/libgpod-node/src/database.ts` - Added `setTrackArtwork` and `setTrackArtworkAsync` methods
4. `packages/libgpod-node/src/index.integration.test.ts` - Added artwork test suite

### Usage Example

```typescript
import { Database } from '@podkit/libgpod-node';
import { extractAndSaveArtwork, cleanupTempArtwork } from '@podkit/core';

const db = Database.openSync('/media/ipod');
const track = db.addTrack({ title: 'Song', artist: 'Artist' });

// Extract artwork from source file
const artworkPath = await extractAndSaveArtwork('/path/to/song.flac');
if (artworkPath) {
  db.setTrackArtwork(track.id, artworkPath);
}

// Save changes (thumbnails are generated during write)
await db.save();

// Cleanup temp files after save
if (artworkPath) {
  await cleanupTempArtwork(artworkPath);
}

db.close();
```

## Review Completed (2026-02-23)

### Verification Results

1. **Native module build**: SUCCESS
   - `bun run build` in `packages/libgpod-node` completes successfully
   - node-gyp compiles the C++ binding with the new `SetTrackThumbnails` method
   - Linker warnings about macOS version mismatch are cosmetic only

2. **Type checking**: PASS
   - `bun run typecheck` succeeds across all packages

3. **Linting**: PASS
   - `bun run lint` reports 0 warnings and 0 errors

4. **Integration tests**: ALL 28 TESTS PASS
   - Tests cover JPEG and PNG artwork
   - Tests cover tracks with and without artwork
   - Tests cover error handling (invalid paths, invalid track IDs)
   - Tests cover async API
   - Tests cover combined audio file + artwork workflow

### Code Review Summary

**Native binding (`gpod_binding.cc`):**
- `SetTrackThumbnails` method correctly validates inputs
- Uses `itdb_track_by_id` to find track, then `itdb_track_set_thumbnails` to set artwork
- Returns updated track object with `hasArtwork` flag
- Proper error handling for track not found and thumbnail failure

**TypeScript wrapper (`database.ts`):**
- `setTrackArtwork(trackId, imagePath)` provides clean sync API
- `setTrackArtworkAsync(trackId, imagePath)` provides async API for consistency
- Wraps errors in `LibgpodError` with appropriate error codes
- Good JSDoc documentation with usage example

**Binding interface (`binding.ts`):**
- `setTrackThumbnails` method correctly typed in `NativeDatabase` interface

### Implementation Quality
- All acceptance criteria verified
- Implementation follows established patterns in the codebase
- Tests are thorough and cover edge cases
- Documentation is complete
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary\n\nImplemented artwork transfer to iPod via libgpod's `itdb_track_set_thumbnails` function.\n\n### Changes\n\n1. **Native binding** (`packages/libgpod-node/native/gpod_binding.cc`):\n   - Added `SetTrackThumbnails(trackId, imagePath)` method\n   - Validates inputs and calls libgpod's `itdb_track_set_thumbnails`\n   - Returns updated track object with `hasArtwork` flag\n\n2. **TypeScript wrapper** (`packages/libgpod-node/src/database.ts`):\n   - Added `setTrackArtwork(trackId, imagePath)` sync method\n   - Added `setTrackArtworkAsync(trackId, imagePath)` async method\n   - Proper error handling with `LibgpodError`\n\n3. **Type definitions** (`packages/libgpod-node/src/binding.ts`):\n   - Added `setTrackThumbnails` to `NativeDatabase` interface\n\n4. **Integration tests** (`packages/libgpod-node/src/index.integration.test.ts`):\n   - Setting artwork from JPEG file\n   - Setting artwork from PNG file\n   - Handling tracks without artwork\n   - Setting artwork on multiple tracks\n   - Error handling for non-existent images\n   - Error handling for invalid track IDs\n   - Async API testing\n   - Combined audio file + artwork workflow\n\n### Verification\n\n- Build: SUCCESS\n- TypeCheck: PASS\n- Lint: PASS (0 errors)\n- Integration tests: 28/28 PASS
<!-- SECTION:FINAL_SUMMARY:END -->
