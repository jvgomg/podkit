---
id: TASK-009
title: Implement read iPod tracks functionality
status: Done
assignee: []
created_date: '2026-02-22 19:09'
updated_date: '2026-02-22 23:12'
labels: []
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-008
references:
  - docs/LIBGPOD.md
  - docs/ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add functionality to read track listing from iPod database.

**Implementation:**
- Iterate libgpod track list (GList)
- Convert Itdb_Track structs to TypeScript Track objects
- Handle all relevant track metadata fields
- Expose via IPodDatabase.tracks property or getTracks() method

**Track fields to extract:**
- Core: title, artist, album, albumArtist
- Info: trackNumber, discNumber, year, genre
- Technical: duration, bitrate, sampleRate, fileSize
- Path: ipod_path (file location on device)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Can read all tracks from iPod database
- [x] #2 Track metadata correctly converted to TypeScript objects
- [x] #3 Handles empty database gracefully
- [x] #4 Unit tests for track reading
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-02-22)

This task was fully implemented as part of TASK-008 (libgpod-node bindings). All acceptance criteria have been verified:

### 1. Can read all tracks from iPod database
- `Database.getTracks()` method implemented in `/packages/libgpod-node/src/database.ts` (lines 176-179)
- Native `GetTracks` function in `/packages/libgpod-node/native/gpod_binding.cc` (lines 347-364) iterates through the libgpod GList of tracks

### 2. Track metadata correctly converted to TypeScript objects
All required fields are extracted in `TrackToObject()` (gpod_binding.cc lines 174-233) and mapped to the `Track` interface (types.ts lines 163-250):

- **Core metadata**: title, artist, album, albumArtist, genre, composer, comment, grouping
- **Track info**: trackNumber, totalTracks, discNumber, totalDiscs, year
- **Technical info**: duration (ms), bitrate (kbps), sampleRate (Hz), size (bytes), bpm
- **File info**: filetype, mediaType, ipodPath
- **Timestamps**: timeAdded, timeModified, timePlayed, timeReleased
- **Statistics**: playCount, skipCount, rating
- **Flags**: hasArtwork, compilation, transferred

### 3. Handles empty database gracefully
- `GetTracks` returns an empty array when `db_->tracks` is null/empty
- Verified by integration test: `expect(info.trackCount).toBe(0);`

### 4. Unit tests for track reading
- **Unit tests**: `/packages/libgpod-node/src/track.test.ts` (31 tests for track utilities)
- **Integration tests**: `/packages/libgpod-node/src/index.integration.test.ts` includes:
  - "can add and retrieve tracks" - tests getTracks() returns added tracks
  - "can open a test iPod database" - tests empty database handling

### Verification commands run:
- `bun run typecheck` - PASS
- `bun run lint` - PASS (0 warnings, 0 errors)
- `bun run test:unit` - PASS (all 101 tests across packages)

## Review Complete (2026-02-22)

**Verified:**
- All 4 acceptance criteria are checked off
- Unit tests: 101 tests pass (31 in track.test.ts, 17 in core, 53 in CLI)
- Integration tests: 29 tests pass (14 in libgpod-node, 15 in gpod-testing)

**Track type verification (`packages/libgpod-node/src/types.ts` lines 163-250):**
- Core: title, artist, album, albumArtist - PRESENT
- Info: trackNumber, discNumber, year, genre - PRESENT
- Technical: duration, bitrate, sampleRate, size - PRESENT
- Path: ipodPath - PRESENT

All required fields are present with correct types. Task was fully implemented as part of TASK-008 libgpod-node bindings work.
<!-- SECTION:NOTES:END -->
