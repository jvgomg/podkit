---
id: TASK-011
title: Create podkit-core package structure
status: Done
assignee: []
created_date: '2026-02-22 19:09'
updated_date: '2026-02-22 22:52'
labels: []
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-002
references:
  - docs/ARCHITECTURE.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Establish the podkit-core package with initial module structure.

**Package structure:**
```
packages/podkit-core/
├── src/
│   ├── index.ts           # Public API exports
│   ├── adapters/          # Collection source adapters (M2)
│   │   └── interface.ts   # CollectionAdapter interface
│   ├── sync/              # Sync engine (M2)
│   │   └── types.ts       # SyncDiff, SyncPlan types
│   ├── transcode/         # Transcoding (M2)
│   │   └── types.ts       # TranscodePreset types
│   └── types.ts           # Shared types
├── package.json
└── tsconfig.json
```

**Goal:** Establish the shape of the codebase early, even if implementations are stubs. Define key interfaces from ARCHITECTURE.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Package structure created
- [x] #2 Key interfaces defined (CollectionAdapter, SyncDiff, etc.)
- [x] #3 Exports from index.ts
- [x] #4 Depends on libgpod-node package
- [x] #5 TypeScript compiles without errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created the podkit-core package structure with all key interfaces defined based on ARCHITECTURE.md.

### Files Created

1. **src/types.ts** - Shared types:
   - `AudioFileType` - Union type for supported audio formats
   - `TrackMetadata` - Core track metadata interface
   - `TrackFilter` - Filter criteria for querying tracks
   - `PodkitError` - Discriminated union for typed errors
   - `createError()` - Helper function for creating typed errors

2. **src/adapters/interface.ts** - Collection adapters:
   - `CollectionTrack` - Track from a collection source
   - `CollectionAdapter` - Interface for reading tracks from sources
   - `AdapterConfig` - Configuration for creating adapters

3. **src/sync/types.ts** - Sync engine types:
   - `IPodTrack` - Track as stored on iPod (placeholder until libgpod-node types available)
   - `MatchedTrack`, `ConflictTrack` - Track matching results
   - `SyncDiff` - Result of comparing collection to iPod
   - `SyncOperation` - Individual sync operation (transcode/copy/remove/update)
   - `SyncPlan`, `SyncExecutor`, `SyncDiffer`, `SyncPlanner` - Engine interfaces
   - `SyncProgress`, `ExecuteOptions`, `PlanOptions` - Supporting types

4. **src/transcode/types.ts** - Transcoding types:
   - `TranscodePreset` - Quality preset configuration
   - `PRESETS` - Built-in high/medium/low presets
   - `TranscoderCapabilities`, `TranscodeResult`, `AudioMetadata`
   - `Transcoder` - Interface for audio conversion
   - `TranscodeProgress`, `TranscodeOptions` - Progress and options

5. **src/artwork/types.ts** - Artwork processing types:
   - `ArtworkFormat` - iPod artwork format specification
   - `IPOD_ARTWORK_FORMATS` - Predefined formats for different iPod models
   - `ArtworkSource`, `ExtractedArtwork` - Artwork data types
   - `ArtworkProcessor` - Interface for artwork extraction/resizing
   - `EXTERNAL_ARTWORK_NAMES` - Common filenames to search for

6. **src/index.ts** - Updated to export all types and interfaces

### Notes

- The `IPodTrack` type in sync/types.ts is a placeholder. Added a TODO comment to import from @podkit/libgpod-node when TASK-012 implements those types.
- All interfaces follow the patterns defined in ARCHITECTURE.md
- Package already had workspace dependency on @podkit/libgpod-node (from TASK-002)

## Code Review Summary (2026-02-22)

**Reviewer:** Claude Code

**Result:** Approved

### Verification
- TypeScript compiles without errors
- Lint passes (0 warnings, 0 errors)
- All unit tests pass (17 tests)

### Code Quality Assessment

**Strengths:**
1. Clean, well-documented interfaces with comprehensive JSDoc comments
2. Proper TypeScript patterns (discriminated unions, const assertions, satisfies)
3. Good organization with clear module boundaries (adapters, sync, transcode, artwork)
4. All interfaces align with docs/ARCHITECTURE.md specifications
5. Thoughtful design decisions (e.g., TranscodePresetRef vs full TranscodePreset in SyncOperation)
6. Appropriate use of `as const` for immutable data structures

**Additions during review:**
- Expanded test coverage from 1 test to 17 tests
- Added tests for createError helper, PRESETS constant, IPOD_ARTWORK_FORMATS, EXTERNAL_ARTWORK_NAMES
- Added compile-time verification tests for type exports

**Notes:**
- IPodTrack is a placeholder (documented TODO for TASK-012 integration)
- ArtworkProcessor includes a useful loadExternal() method beyond ARCHITECTURE.md spec
- All acceptance criteria verified as complete
<!-- SECTION:NOTES:END -->
