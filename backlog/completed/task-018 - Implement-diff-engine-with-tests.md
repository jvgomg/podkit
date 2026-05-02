---
id: TASK-018
title: Implement diff engine with tests
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-23 00:16'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-017
  - TASK-009
references:
  - docs/ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the engine that compares collection tracks to iPod tracks.

**Diff output:**
- toAdd: tracks in collection but not on iPod
- toRemove: tracks on iPod but not in collection
- existing: matched tracks (already synced)

**Implementation:**
- Use song matching from TASK-017
- Efficient comparison (indexing, not O(n²))
- Handle large collections (10k+ tracks)

**Testing requirements (critical):**
- Empty collection / empty iPod
- Identical collection and iPod (nothing to sync)
- All new tracks (fresh iPod)
- Mixed scenario (some new, some existing, some removed)
- Large collection performance test
- Verify no false positives (existing tracks marked as new)
- Verify no false negatives (new tracks missed)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Diff engine produces correct toAdd, toRemove, existing lists
- [x] #2 Uses efficient indexing (not O(n²))
- [x] #3 Handles 10k+ track collections
- [x] #4 Extensive unit tests for all scenarios
- [x] #5 No false positives or negatives in matching
- [x] #6 Performance test for large collections
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes (2026-02-23)

### Files Created
- `packages/podkit-core/src/sync/differ.ts` - Core diff engine implementation
- `packages/podkit-core/src/sync/differ.test.ts` - Comprehensive test suite (50 tests)

### Algorithm
The diff engine uses O(n + m) time complexity:
1. Build hash index from iPod tracks using `buildMatchIndex()` from TASK-017
2. Iterate collection tracks, lookup matches in O(1)
3. Track matched iPod track IDs (not keys) to handle duplicates correctly
4. Remaining unmatched iPod tracks become `toRemove` candidates

### Key Design Decisions

**Conflict Detection**
- Only checks supplementary metadata fields (albumArtist, genre, year, trackNumber, discNumber)
- Does NOT check artist/title/album for conflicts since these are already normalized for matching
- If tracks match via normalized key, case/whitespace/"The" variations are considered equivalent

**Duplicate Handling**
- Uses iPod track IDs (not keys) to track matched tracks
- When iPod has duplicate tracks with same metadata, only the first is matched
- Duplicate iPod tracks appear in `toRemove` as expected

### Test Coverage (50 tests)
- Empty scenarios (empty collection, empty iPod, both empty)
- Identical collections (nothing to sync)
- Fresh iPod scenarios (all tracks to add)
- Mixed scenarios (new, existing, removed)
- Conflict detection (genre, year, trackNumber, discNumber, albumArtist)
- False positive prevention (similar but different tracks)
- False negative prevention (matching despite case/whitespace/accents)
- Duplicate handling (collection and iPod duplicates)
- Performance tests (10k+ tracks in < 1 second, O(n) complexity verification)
- Edge cases (empty strings, long strings, special characters, CJK)

## Code Review (2026-02-23)

### Verification Results
- **TypeScript**: All types check (no errors)
- **Linting**: 0 warnings, 0 errors
- **Unit Tests**: All 191 tests pass (50 tests in differ.test.ts specifically)

### Algorithm Review
The diff engine correctly uses O(n + m) time complexity:
1. `buildMatchIndex()` from matching.ts creates a hash map from iPod tracks - O(m)
2. Iteration over collection tracks with O(1) lookups - O(n)
3. Final pass to find unmatched iPod tracks - O(m)

Total: O(n + m), not O(n*m)

### Edge Cases Handled
- Empty collection / empty iPod / both empty
- Identical collections (nothing to sync)
- Fresh iPod (all tracks to add)
- Mixed scenarios
- Duplicate handling (uses track IDs not keys to correctly handle iPod duplicates)

### Matching Module Integration
Correctly uses:
- `buildMatchIndex()` for O(1) lookup creation
- `getMatchKey()` for normalized key generation
- Leverages TASK-017's normalization (case, whitespace, accents, "The" article handling)

### Test Coverage
Comprehensive test suite covering:
- Empty scenarios (3 tests)
- Identical collections (6 tests)
- Fresh iPod (2 tests)
- Mixed scenarios (5 tests)
- Conflict detection (11 tests) - genre, year, trackNumber, discNumber, albumArtist
- False positive prevention (6 tests)
- False negative prevention (4 tests)
- Duplicate handling (2 tests)
- Performance tests (3 tests) - 10k+ tracks < 1s, O(n) complexity verification
- Edge cases (6 tests)

### Implementation Quality
- Well-documented with JSDoc comments
- Clean separation of concerns (conflict detection in separate function)
- Implements SyncDiffer interface with DefaultSyncDiffer class
- Factory function `createDiffer()` for easy instantiation

**Approved**: Implementation is correct, efficient, and well-tested.
<!-- SECTION:NOTES:END -->
