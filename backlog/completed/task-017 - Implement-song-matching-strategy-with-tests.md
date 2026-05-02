---
id: TASK-017
title: Implement song matching strategy with tests
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-23 00:10'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-016
references:
  - docs/ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the algorithm for matching songs between collection and iPod.

**Matching strategy:**
- Primary: (artist, title, album) tuple - normalized and compared
- Normalization: lowercase, trim whitespace, handle unicode
- Consider: fuzzy matching for slight variations?

**Implementation:**
- Matching function that compares two tracks
- Normalization utilities
- Configurable matching strictness?

**Testing requirements (critical):**
- Exact matches
- Case differences ("The Beatles" vs "the beatles")
- Whitespace differences
- Unicode normalization (é vs e)
- Partial matches / near-misses (should NOT match)
- Edge cases: empty fields, "Unknown Artist", etc.

**This powers the diff engine - needs extensive test coverage.**
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Matching algorithm implemented
- [x] #2 Normalization handles case, whitespace, unicode
- [x] #3 Extensive unit tests for match scenarios
- [x] #4 Tests for non-matches (false positive prevention)
- [x] #5 Edge cases tested and documented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete (2026-02-23)

### Files Created
- `packages/podkit-core/src/sync/matching.ts` - Main matching module
- `packages/podkit-core/src/sync/matching.test.ts` - Comprehensive test suite (83 tests)

### Normalization Rules Implemented
1. **Case**: Convert to lowercase
2. **Whitespace**: Trim leading/trailing, collapse internal whitespace to single space
3. **Unicode**: Normalize to NFD form, remove combining diacritical marks (accents)
4. **Article handling**: "The Beatles" and "Beatles, The" normalize to same form
5. **Unknown placeholders**: Values like "Unknown Artist" treated as empty

### Exported Functions
- `normalizeString(input)` - Base normalization
- `normalizeArtist(artist)` - With article handling
- `normalizeTitle(title)` - With unknown placeholder handling
- `normalizeAlbum(album)` - With unknown placeholder handling
- `getMatchKey(track)` - Generate match key from (artist, title, album)
- `tracksMatch(trackA, trackB)` - Compare two tracks
- `buildMatchIndex(tracks)` - Build index for efficient matching
- `findMatches(collectionTracks, ipodTracks)` - Find matches between collections
- `findOrphanedTracks(collectionTracks, ipodTracks)` - Find iPod tracks not in collection

### Test Coverage
- Exact matches
- Case differences
- Whitespace differences (leading, trailing, internal)
- Unicode normalization (accents, umlauts, precomposed vs decomposed)
- Article handling ("The X" vs "X, The")
- Non-matches (false positive prevention)
- Edge cases (empty fields, unknown placeholders, special characters, CJK)

### Design Decisions
- Conservative matching (false negatives preferred over false positives)
- Unit separator (\u001F) used in match keys to prevent field collision
- German ß preserved (not an accented letter)
- NFD normalization decomposes Korean hangul but matching still works

## Code Review (2026-02-23)

### Review Summary: APPROVED

The implementation is thorough, well-documented, and production-ready.

### Implementation Strengths
- Clear module documentation with explicit matching philosophy
- Robust normalization: case, unicode (NFD + diacritic removal), whitespace, article handling
- Safe match key design using unit separator (U+001F) prevents field collisions
- Efficient O(1) lookups via Map-based index
- Generic type support for different track types

### Test Coverage: Comprehensive (83 tests)
- Basic normalization (case, whitespace, tabs/newlines)
- Unicode (French, German, Nordic, Spanish, precomposed vs decomposed, CJK)
- Article handling ("The X" <-> "X, The")
- Unknown placeholders
- False positive prevention (different fields, similar names, partial/substring matches)
- Edge cases (empty fields, null/undefined, long strings, emoji, special chars)

### Verification Results
- TypeScript: Pass
- Linting: Pass (0 warnings/errors)
- Unit Tests: All 83 matching tests pass

### Minor Observations
- Lines 121-126 contain a no-op conditional (harmless)
- German ß preserved by design (documented in tests)

### Conclusion
No blocking issues. Implementation is solid and ready for use in the sync diff engine.
<!-- SECTION:NOTES:END -->
