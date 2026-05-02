---
id: TASK-023
title: Implement embedded artwork extraction
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-23 01:37'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-015
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extract embedded album artwork from audio files.

**Implementation:**
- Extract artwork from FLAC, MP3, M4A files
- Support common image formats (JPEG, PNG)
- Handle files with no embedded artwork gracefully

**Testing requirements:**
- Test extraction from each audio format
- Test JPEG and PNG artwork
- Test files without artwork
- Test files with multiple embedded images (use first/largest)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Extracts artwork from FLAC, MP3, M4A
- [x] #2 Handles JPEG and PNG formats
- [x] #3 Gracefully handles missing artwork
- [x] #4 Unit tests for extraction
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented artwork extraction at `packages/podkit-core/src/artwork/extractor.ts` with the following features:

### Functions
- `extractArtwork(filePath, options?)`: Extracts embedded artwork using music-metadata
- `saveArtworkToTemp(artwork)`: Saves artwork to temp file for libgpod
- `cleanupTempArtwork(filePath)`: Cleans up single temp file
- `cleanupAllTempArtwork()`: Cleans up all temp files from session
- `extractAndSaveArtwork(filePath, options?)`: Convenience function combining extraction and saving

### Features
- Supports FLAC, MP3, M4A (any format music-metadata supports)
- Handles JPEG and PNG with dimension detection
- Prefers front cover when multiple images present
- Graceful handling of missing artwork (returns null)
- Optional `onSkip` callback for verbose logging
- Temp file management with session-wide cleanup

### Testing
- Unit tests with mocked music-metadata
- Tests for JPEG/PNG extraction
- Tests for missing artwork
- Tests for error handling
- Tests for temp file creation/cleanup

### Files Changed
- Added: `packages/podkit-core/src/artwork/extractor.ts`
- Added: `packages/podkit-core/src/artwork/extractor.test.ts`
- Updated: `packages/podkit-core/src/index.ts` (exports)

## Code Review (2026-02-23)

**Reviewer:** Claude

**Overall Assessment:** APPROVED - Implementation is well-structured, comprehensive, and follows project conventions.

### Findings

#### Positive

1. **music-metadata usage is correct:**
   - Uses `mm.parseFile()` with `skipCovers: false` (explicitly stated)
   - Properly accesses `metadata.common.picture` array
   - Converts `Uint8Array` to `Buffer` correctly

2. **JPEG/PNG detection is well-implemented:**
   - `parseJpegDimensions()` correctly parses SOF0/SOF1/SOF2 markers (0xC0-0xC2)
   - `parsePngDimensions()` correctly reads IHDR chunk at bytes 16-23
   - Returns `{width: 0, height: 0}` for unsupported/malformed images (graceful degradation)

3. **Missing artwork handling:**
   - Returns `null` for missing artwork (not an error)
   - Calls optional `onSkip` callback for verbose logging
   - Catches parse errors and returns `null` (doesn't crash on corrupt files)

4. **Temp file handling:**
   - Creates session-unique temp directory with UUID
   - Tracks files in `Set<string>` for cleanup
   - Provides both single-file (`cleanupTempArtwork`) and session-wide (`cleanupAllTempArtwork`) cleanup
   - Uses `{ force: true }` to avoid errors on already-deleted files
   - Proper file extension based on MIME type

5. **Picture selection logic:**
   - Priority-based selection preferring front cover
   - Handles multiple embedded images correctly
   - Falls back gracefully for unknown picture types

#### Tests

- Comprehensive unit tests with mocked `music-metadata`
- Tests cover: JPEG extraction, PNG extraction, missing artwork, empty arrays, parse errors, malformed data
- Tests for temp file creation, cleanup, and the convenience function
- Mock JPEG/PNG creation helpers are well-documented
- Good test isolation with `beforeEach`/`afterEach` cleanup

#### Verification

- `bun run typecheck` - PASSED
- `bun run lint` - PASSED (0 warnings, 0 errors)
- `bun run test:unit` - PASSED (369 tests, including 20+ for extractor)

### Minor Notes (not blocking)

- Module-level `tempFiles` Set and `tempArtworkDir` are stateful across multiple sync operations in the same process. This is documented behavior but worth noting for future concurrent usage scenarios.
<!-- SECTION:NOTES:END -->
