---
id: TASK-067
title: Implement ftintitle transform
status: Done
assignee: []
created_date: '2026-02-27 14:42'
updated_date: '2026-03-02 21:32'
labels:
  - feature
  - sync
  - metadata
  - transforms
dependencies:
  - TASK-065
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Implement the ftintitle transform feature as designed in TASK-065. This moves "featuring" artists from the Artist field to the Title field during sync, matching the beets ftintitle plugin behavior.

**Before:** Artist: `"Artist A feat. Artist B"`, Title: `"Song Name"`
**After:** Artist: `"Artist A"`, Title: `"Song Name (feat. Artist B)"`

## Implementation Phases

### Phase 1: Core Transform Infrastructure
Create the transform types, pipeline, and ftintitle logic (pure functions, no integration).

**Files:**
- `packages/podkit-core/src/transforms/types.ts` - Transform interfaces
- `packages/podkit-core/src/transforms/pipeline.ts` - Transform pipeline
- `packages/podkit-core/src/transforms/ftintitle/index.ts` - Main transform
- `packages/podkit-core/src/transforms/ftintitle/patterns.ts` - Regex patterns (ported from beets)
- `packages/podkit-core/src/transforms/ftintitle/extract.ts` - Featured artist extraction
- `packages/podkit-core/src/transforms/index.ts` - Public exports

**Deliverables:**
- [ ] Transform interface defined
- [ ] ftintitle patterns ported from beets with attribution
- [ ] ftintitle transform implemented with `enabled`, `drop`, `format` options
- [ ] Unit tests for extraction logic and edge cases

### Phase 2: Config Schema
Add transform configuration to core config types.

**Files:**
- `packages/podkit-core/src/config/types.ts` - New file for core config types
- `packages/podkit-core/src/config/index.ts` - Exports
- `packages/podkit-cli/src/config/types.ts` - Import/extend core types

**Deliverables:**
- [ ] `TransformsConfig` and `FtInTitleConfig` types defined in core
- [ ] CLI config loader updated to parse `[transforms.ftintitle]` section
- [ ] Default config values defined

### Phase 3: Differ Integration
Update the differ for dual-key matching and add `toUpdate` category.

**Files:**
- `packages/podkit-core/src/sync/types.ts` - Add `UpdateTrack`, `UpdateReason`, extend `SyncDiff`
- `packages/podkit-core/src/sync/matching.ts` - Add transform-aware key generation
- `packages/podkit-core/src/sync/differ.ts` - Dual-key matching algorithm

**Deliverables:**
- [ ] `SyncDiff.toUpdate` with `UpdateReason` (transform-apply, transform-remove, metadata-changed)
- [ ] Dual-key matching: check both original and transformed keys
- [ ] Tests for config change scenarios (enable/disable transform)

### Phase 4: Planner & Executor Integration
Generate and execute update operations for transform changes.

**Files:**
- `packages/podkit-core/src/sync/planner.ts` - Generate update operations from `toUpdate`
- `packages/podkit-core/src/sync/executor.ts` - Call `updateTrack()` for metadata updates

**Deliverables:**
- [ ] Planner generates `update-metadata` ops from `toUpdate` tracks
- [ ] Executor handles metadata updates (preserves play counts, ratings)
- [ ] Integration tests for full sync with transforms

### Phase 5: CLI Output
Update CLI to show transform information in dry-run and sync output.

**Files:**
- `packages/podkit-cli/src/commands/sync.ts` - Show transform stats

**Deliverables:**
- [ ] Dry-run shows "Transforms: ftintitle: enabled (format: ...)"
- [ ] Summary shows "Tracks to update: N (Apply ftintitle: X, Metadata changed: Y)"
- [ ] Verbose mode shows before/after for transformed tracks

---

## Beets Feature Parity

### Implemented (from spec)
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the transform |
| `drop` | boolean | `false` | Drop feat. info instead of moving to title |
| `format` | string | `"feat. {}"` | Format string for title suffix |

### Omitted (from beets, not in spec)
| Option | Reason |
|--------|--------|
| `auto` | N/A - we apply during sync, not import |
| `keep_in_artist` | Not requested - may add later |
| `preserve_album_artist` | See compilation handling notes |
| `custom_words` | Not requested - may add later |

### Compilation Handling
The primary use case is albums where most tracks have `artist == albumArtist` but some tracks feature guests:
- Album Artist: "Artist A"
- Track Artist: "Artist A feat. B" → transforms to "Artist A" + title "(feat. B)"

For compilations (`albumArtist = "Various Artists"`), the track artist is the primary metadata. Current implementation will still process these - the featuring info will move to title. This may or may not be desired. Consider adding `preserve_album_artist` option in future if users request it.

---

## File Structure

```
packages/podkit-core/src/
├── config/
│   ├── index.ts                    # Public exports
│   └── types.ts                    # Core config types (TransformsConfig, etc.)
├── transforms/
│   ├── index.ts                    # Public API exports
│   ├── types.ts                    # Transform interfaces
│   ├── pipeline.ts                 # Transform pipeline (apply in order)
│   └── ftintitle/
│       ├── index.ts                # ftintitle transform implementation
│       ├── patterns.ts             # Regex patterns (ported from beets)
│       ├── extract.ts              # Featured artist extraction logic
│       └── ftintitle.test.ts       # Tests
├── sync/
│   ├── differ.ts                   # Update for dual-key matching
│   ├── types.ts                    # Add toUpdate, UpdateReason
│   └── planner.ts                  # Generate update operations
```

## Core Interfaces

```typescript
// transforms/types.ts

export interface TransformableTrack {
  artist: string;
  title: string;
  album: string;
  albumArtist?: string;
}

export interface TransformResult<T extends TransformableTrack> {
  original: T;
  transformed: T;
  applied: boolean;  // true if any changes were made
}

export interface TrackTransform<TConfig = unknown> {
  name: string;
  defaultConfig: TConfig;
  apply(track: TransformableTrack, config: TConfig): TransformableTrack;
}

// config/types.ts

export interface FtInTitleConfig {
  enabled: boolean;   // default: false
  drop: boolean;      // default: false
  format: string;     // default: "feat. {}"
}

export interface TransformsConfig {
  ftintitle: FtInTitleConfig;
}

// sync/types.ts additions

export type UpdateReason = 
  | 'transform-apply'    // Need to apply transform (config enabled)
  | 'transform-remove'   // Need to remove transform (config disabled)  
  | 'metadata-changed';  // Source metadata changed

export interface UpdateTrack {
  source: CollectionTrack;
  ipod: IPodTrack;
  reason: UpdateReason;
  changes: MetadataChange[];
}

export interface MetadataChange {
  field: 'artist' | 'title' | 'album' | 'albumArtist';
  from: string;
  to: string;
}

export interface SyncDiff {
  toAdd: CollectionTrack[];
  toRemove: IPodTrack[];
  existing: MatchedTrack[];
  toUpdate: UpdateTrack[];  // NEW
  conflicts: ConflictTrack[];
}
```

## Attribution

All files ported from beets must include:

```typescript
/**
 * Ported from beets ftintitle plugin
 * Original: Copyright 2016, Verrus, <github.com/Verrus/beets-plugin-featInTitle>
 * Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
 * License: MIT
 */
```

## Test Cases

```typescript
const TEST_CASES = [
  // Basic cases
  { input: { artist: 'A feat. B', title: 'Song' }, expected: { artist: 'A', title: 'Song (feat. B)' } },
  { input: { artist: 'A featuring B', title: 'Song' }, expected: { artist: 'A', title: 'Song (feat. B)' } },
  { input: { artist: 'A ft. B', title: 'Song' }, expected: { artist: 'A', title: 'Song (feat. B)' } },
  
  // Bracket positioning
  { input: { artist: 'A ft. B', title: 'Song (Remix)' }, expected: { artist: 'A', title: 'Song (feat. B) (Remix)' } },
  { input: { artist: 'A ft. B', title: 'Song (Radio Edit)' }, expected: { artist: 'A', title: 'Song (feat. B) (Radio Edit)' } },
  
  // Skip cases
  { input: { artist: 'A', title: 'Song (feat. B)' }, expected: { artist: 'A', title: 'Song (feat. B)' } }, // already has feat
  { input: { artist: 'A', title: 'Song' }, expected: { artist: 'A', title: 'Song' } }, // no feat
  
  // Drop mode
  { input: { artist: 'A feat. B', title: 'Song' }, config: { drop: true }, expected: { artist: 'A', title: 'Song' } },
  
  // Custom format
  { input: { artist: 'A feat. B', title: 'Song' }, config: { format: 'with {}' }, expected: { artist: 'A', title: 'Song (with B)' } },
];
```

## Reference

- Beets ftintitle docs: https://beets.readthedocs.io/en/stable/plugins/ftintitle.html
- Beets source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
- Design task: TASK-065
- Architecture docs: docs/TRANSFORMS.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Phase 1: Transform types and interfaces created (types.ts, pipeline.ts)
- [x] #2 Phase 1: ftintitle patterns ported from beets with attribution
- [x] #3 Phase 1: ftintitle transform implemented with enabled/drop/format options
- [x] #4 Phase 1: Unit tests for ftintitle logic and edge cases
- [x] #5 Phase 2: Core config types created (TransformsConfig, FtInTitleConfig)
- [x] #6 Phase 2: CLI config loader parses [transforms.ftintitle] section
- [x] #7 Phase 3: SyncDiff extended with toUpdate and UpdateReason
- [x] #8 Phase 3: Differ uses dual-key matching (original + transformed)
- [x] #9 Phase 4: Planner generates update-metadata ops from toUpdate
- [x] #10 Phase 4: Executor calls updateTrack() for metadata-only updates
- [x] #11 Phase 5: CLI dry-run shows transform stats and before/after
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 1 Complete (2026-03-02)

Implemented core transform infrastructure:

### Files Created
- `packages/podkit-core/src/transforms/types.ts` - Transform interfaces and config types
- `packages/podkit-core/src/transforms/pipeline.ts` - Transform pipeline with `applyTransforms()`
- `packages/podkit-core/src/transforms/ftintitle/patterns.ts` - Regex patterns (ported from beets)
- `packages/podkit-core/src/transforms/ftintitle/extract.ts` - Featured artist extraction logic
- `packages/podkit-core/src/transforms/ftintitle/index.ts` - Main transform implementation
- `packages/podkit-core/src/transforms/index.ts` - Public exports
- `packages/podkit-core/src/transforms/ftintitle/ftintitle.test.ts` - 74 unit tests
- `packages/podkit-core/src/transforms/pipeline.test.ts` - Pipeline tests

### Key Features
- `TrackTransform` interface for extensible transforms
- `applyTransforms()` pipeline function
- ftintitle with `enabled`, `drop`, `format` options
- Bracket positioning (feat before Remix/Edit)
- Title duplicate detection (skip if feat already in title)
- All 616 unit tests pass

### Exports Added to @podkit/core
- Types: `TransformableTrack`, `TransformResult`, `TrackTransform`, `FtInTitleConfig`, `TransformsConfig`
- Functions: `applyTransforms`, `hasEnabledTransforms`, `getEnabledTransformsSummary`
- Transform: `ftintitleTransform`
- Utilities: `applyFtInTitle`, `extractFeaturedArtist`, `insertFeatIntoTitle`, `titleContainsFeat`

## Code Review Fixes (2026-03-02)

Sub-agent compared implementation against beets source. Fixed:

### Bugs Fixed
1. **Typo**: `'a]capella'` → `'a capella'` in BRACKET_KEYWORDS
2. **titleContainsFeat too narrow**: Now detects both bracketed `(feat. X)` and unbracketed `Song feat. X`

### Documented Differences (intentional omissions per spec)
- No comma splitting fallback for artist fields
- No `preserve_album_artist` option
- No `custom_words` option  
- No `find_feat_part` album artist context logic
- No angle/curly bracket support (`<>`, `{}`)
- No `artist_sort` field handling

These can be added later if users request them.

## Session End State (2026-03-02)

**Phase 1 complete and reviewed.** All typecheck, lint (for transforms), and 620 unit tests pass.

### Files Created/Modified

**New transform files:**
- `packages/podkit-core/src/transforms/types.ts`
- `packages/podkit-core/src/transforms/pipeline.ts`
- `packages/podkit-core/src/transforms/pipeline.test.ts`
- `packages/podkit-core/src/transforms/index.ts`
- `packages/podkit-core/src/transforms/ftintitle/patterns.ts`
- `packages/podkit-core/src/transforms/ftintitle/extract.ts`
- `packages/podkit-core/src/transforms/ftintitle/index.ts`
- `packages/podkit-core/src/transforms/ftintitle/ftintitle.test.ts`

**Modified:**
- `packages/podkit-core/src/index.ts` - Added transform exports
- `packages/podkit-cli/src/config/loader.test.ts` - Fixed TypeScript errors (unrelated to transforms)
- `packages/podkit-core/src/sync/executor.test.ts` - Fixed missing `warnings` property in SyncPlan (unrelated)
- `packages/podkit-core/src/sync/executor.integration.test.ts` - Same fix
- `packages/podkit-core/src/transforms/pipeline.test.ts` - Fixed TS strict mode issues

### Ready for Phase 2

Phase 2 involves creating config schema in core and updating CLI to parse `[transforms.ftintitle]` TOML section. See task description for full details.

## Phase 2 Complete (2026-03-02)

Implemented config schema for transforms:

### Files Created
- `packages/podkit-core/src/config/types.ts` - Re-exports transform config types from transforms module
- `packages/podkit-core/src/config/index.ts` - Public exports for config module

### Files Modified
- `packages/podkit-cli/src/config/types.ts` - Added TransformsConfig import, updated PodkitConfig and ConfigFileContent
- `packages/podkit-cli/src/config/defaults.ts` - Added DEFAULT_TRANSFORMS_CONFIG to DEFAULT_CONFIG
- `packages/podkit-cli/src/config/loader.ts` - Added parseTransformsConfig(), updated mergeConfigs for deep merge
- `packages/podkit-cli/src/config/index.ts` - Export TransformsConfig and DEFAULT_TRANSFORMS_CONFIG
- `packages/podkit-cli/src/config/loader.test.ts` - Added 12 tests for transforms config parsing
- `packages/podkit-cli/src/context.test.ts` - Fixed mock config to include transforms

### TOML Config Example
```toml
source = "/path/to/music"
device = "/Volumes/iPod"
quality = "high"

[transforms.ftintitle]
enabled = true
drop = false
format = "feat. {}"
```

### Validation
- Format string must contain `{}` placeholder (throws error otherwise)
- Boolean and string type checking for all options
- Partial config supported (missing options use defaults)

### Ready for Phase 3
Phase 3 involves differ integration with dual-key matching for transforms.

## Code Review Improvements (2026-03-02)

Addressed feedback from code review:

### Type Validation Errors
Added strict type checking for transform config values. Now throws descriptive errors when TOML has wrong types:
- `enabled = "true"` (string) → `Invalid type for "enabled". Expected boolean, got string.`
- `drop = "yes"` (string) → `Invalid type for "drop". Expected boolean, got string.`
- `format = 123` (number) → `Invalid type for "format". Expected string, got number.`

This matches the error behavior for `quality` values.

### Tests Added
- 3 tests for type validation errors
- 2 integration tests for `loadConfig` with transforms
- Improved deep merge test with distinct values for all fields

### Code Comments
- Added extensibility note to `mergeConfigs`: "NOTE: When adding new transforms, update this block to include them"

### Not Addressed (Low Priority)
- ENV var support for transforms - would need flattened naming like `PODKIT_TRANSFORMS_FTINTITLE_ENABLED`. Deferred to future if users request it.

## Phase 3 Complete (2026-03-02)

Implemented dual-key matching for transforms in the differ:

### Files Modified
- `packages/podkit-core/src/sync/types.ts` - Added UpdateTrack, UpdateReason, MetadataChange types; extended SyncDiff with toUpdate; added DiffOptions interface
- `packages/podkit-core/src/sync/matching.ts` - Added getTransformMatchKeys() for dual-key generation
- `packages/podkit-core/src/sync/differ.ts` - Updated computeDiff() with dual-key matching algorithm
- `packages/podkit-core/src/index.ts` - Added new type exports
- `packages/podkit-core/src/sync/differ.test.ts` - Added 16 tests for transform scenarios
- `packages/podkit-core/src/sync/planner.test.ts` - Fixed createEmptyDiff() to include toUpdate

### Key Algorithm Details

Dual-key matching detects when tracks need metadata updates due to transform config changes:

1. **transform-apply**: Transforms enabled, iPod has original metadata → need to apply transform
2. **transform-remove**: Transforms disabled, iPod has transformed metadata → need to revert

**Critical insight**: `getTransformMatchKeys()` force-enables transforms when computing the transformed key. This is necessary because:
- When disabled, we still need to compute what the transformed key *would be*
- This lets us find iPod tracks that were previously synced with transforms enabled

### Test Results
- 634 unit tests pass (16 new for transforms)
- 226 integration tests pass
- Typecheck passes

### Code Review Notes (from sub-agent)
- Algorithm is correct
- Code is well-documented
- One future extensibility note: when adding new transforms, forceEnabledConfig pattern will need updating
- Suggestion: nested conditionals in main loop could be refactored into helper functions for clarity (not blocking)

### Ready for Phase 4
Phase 4: Planner & Executor Integration - Generate and execute update operations from toUpdate tracks.

## Phase 4 Complete (2026-03-02)

Implemented planner and executor integration for update-metadata operations:

### Files Modified

**packages/podkit-core/src/sync/planner.ts**
- Added `changesToMetadata()` helper to convert MetadataChange[] to Partial<TrackMetadata>
- Added `createUpdateMetadataOperation()` to create SyncOperation from UpdateTrack
- Added `planUpdateOperations()` to generate update-metadata ops from diff.toUpdate
- Updated `createPlan()` to include update operations in the plan

**packages/podkit-core/src/sync/executor.ts**
- Implemented `executeUpdateMetadata()` method
- Finds track in database by filePath (primary) or metadata (fallback)
- Converts TrackMetadata to TrackFields for IPodTrack.update()
- Only includes changed fields in update call
- Preserves play statistics (update() doesn't touch playCount, rating, etc.)

### Test Coverage Added

**packages/podkit-core/src/sync/planner.test.ts** - 11 new tests:
- Creates update-metadata operations for toUpdate tracks
- Includes correct metadata in operations
- Preserves iPod track reference
- Creates multiple operations for multiple tracks
- Orders updates after transcodes
- Handles transform-remove reason
- Does not count updates in estimated size
- Includes updates in getPlanSummary

**packages/podkit-core/src/sync/executor.test.ts** - 12 new tests:
- Executes update-metadata operation
- Finds track by filePath
- Falls back to metadata matching
- Throws error when track not found
- Reports updating-db phase
- Does not transfer bytes
- Skips in dry-run mode
- Updates only specified fields
- Handles all metadata fields
- getOperationDisplayName for update-metadata

### Integration with Differ

The complete flow now works:
1. `computeDiff()` detects tracks needing transform apply/remove → `diff.toUpdate`
2. `createPlan()` converts toUpdate → `update-metadata` operations
3. `executor.execute()` applies metadata changes to iPod tracks

### Test Results
- 652 unit tests pass
- Typecheck passes
- All existing tests unaffected

### Ready for Phase 5
Phase 5 involves CLI output updates to show transform information in dry-run and sync output.

## Phase 5 Complete (2026-03-02)

Implemented CLI output for transforms during sync:

### Changes to `packages/podkit-cli/src/commands/sync.ts`

**Transforms config passed to differ:**
- `computeDiff()` now receives `{ transforms: config.transforms }` for dual-key matching

**Dry-run header:**
- Added `Transforms: ftintitle: enabled (format: "feat. {}")` line after Quality

**Summary stats with reason breakdown:**
- Added `Tracks to update: N (Apply ftintitle: X, Revert ftintitle: Y)` line
- Groups updates by reason: `transform-apply`, `transform-remove`, `metadata-changed`

**Operations display:**
- Update operations use `~` symbol instead of `+`
- In verbose mode, shows before/after for each changed field:
  ```
  ~ [update-metadata ] Artist - Song
        artist: "Artist feat. B" → "Artist"
        title: "Song" → "Song (feat. B)"
  ```

**JSON output:**
- Added `transforms` array with `{ name, enabled, mode, format }`
- Added `tracksToUpdate` and `updateBreakdown` to plan object
- Added `changes` array to update-metadata operations

### Test Results
- All 243 unit tests pass
- Typecheck passes

### All 5 Phases Complete

The ftintitle transform feature is now fully implemented:
1. ✅ Core transform infrastructure
2. ✅ Config schema and parsing
3. ✅ Differ integration with dual-key matching
4. ✅ Planner & executor for update operations
5. ✅ CLI output showing transform info
<!-- SECTION:NOTES:END -->
