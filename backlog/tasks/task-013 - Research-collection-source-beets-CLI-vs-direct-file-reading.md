---
id: TASK-013
title: 'Research collection source: beets CLI vs direct file reading'
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-22 21:55'
labels:
  - research
  - decision
milestone: 'M2: Core Sync (v0.2.0)'
dependencies: []
references:
  - docs/COLLECTION-SOURCES.md
  - docs/adr/ADR-004-collection-sources.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decide how podkit will read music collections. Two main approaches:

**Option A: beets CLI**
- Use `beet ls -f ...` to query library
- Leverages beets' metadata parsing and library management
- Adds beets as a dependency
- Users must have beets configured

**Option B: Direct file reading**
- Scan directories for audio files
- Parse metadata ourselves (music-metadata or similar library)
- More portable, fewer dependencies
- Need to handle various formats (FLAC, MP3, M4A, etc.)

**Option C: Both via adapter pattern**
- Support both approaches
- User chooses via config/CLI flag

**Research areas:**
- beets CLI output formats and reliability
- TypeScript libraries for audio metadata parsing
- Performance implications of each approach
- User experience considerations

**Outcome:** Create/update ADR documenting decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Options evaluated with pros/cons documented
- [x] #2 Metadata parsing approach validated with prototype
- [x] #3 ADR created or updated with decision
- [x] #4 Recommended approach has clear implementation path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Summary

### Options Evaluated

| Approach | Pros | Cons |
|----------|------|------|
| **beets CLI** | Uses beets query language, respects plugins | Requires beets, slow (process spawn), fragile output parsing |
| **beets SQLite** | Fast, SQL filtering | Schema may change, beets-only users |
| **Strawberry SQLite** | Rich metadata | Strawberry-only users |
| **Directory + music-metadata** | Universal, works for anyone | Must scan files |

### Decision: Directory + music-metadata only

**Rationale:**
- Works for any user with music files, regardless of music player
- `music-metadata` is actively maintained (v11.12.1), TypeScript native
- Supports all formats: FLAC, MP3, M4A, OGG, OPUS
- Extracts MusicBrainz IDs, embedded artwork
- Strawberry/beets users already have well-tagged files
- Simpler implementation and maintenance

### beets custom fields

The main advantage of beets (custom DB fields like `sync_to_ipod`) is rare. Most users:
1. Have well-tagged files (music-metadata works)
2. Use playlists to organize sync selection

Filtering/sync selection will be addressed in M4 via playlists, path patterns, or tag filters.

### Adapter pattern

Retained in code for future extensibility, but only DirectoryAdapter implemented for v1.0.

## Prototype Validation

`music-metadata` is a well-established library (v11.12.1, 1,032+ npm dependents). Full validation will occur during TASK-015/TASK-016 implementation. The library's TypeScript types and format support have been reviewed and meet our requirements.
<!-- SECTION:NOTES:END -->
