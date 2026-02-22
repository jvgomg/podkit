---
id: TASK-015
title: Implement DirectoryAdapter with music-metadata
status: To Do
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-22 21:55'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-013
  - TASK-011
references:
  - docs/COLLECTION-SOURCES.md
  - docs/adr/ADR-004-collection-sources.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the directory-based collection adapter using the `music-metadata` library.

**Implementation:**
- DirectoryAdapter class implementing CollectionAdapter interface
- Scan directories for audio files (FLAC, MP3, M4A, OGG, OPUS)
- Parse metadata using `music-metadata` library
- Build in-memory track collection

**Key files:**
- `packages/podkit-core/src/adapters/directory.ts`
- `packages/podkit-core/src/adapters/index.ts`

**Testing requirements:**
- Unit tests for adapter with mock data
- Test various audio formats (FLAC, MP3, M4A, OGG)
- Test edge cases: missing metadata, unicode, special characters
- Integration tests with real audio files (small test fixtures)

**Dependencies:**
- `music-metadata` npm package
- `glob` npm package (for file scanning)

**Reference:** See docs/COLLECTION-SOURCES.md for interface design and implementation sketch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DirectoryAdapter implementation complete
- [ ] #2 Scans directories and parses metadata with music-metadata
- [ ] #3 Unit tests with mock data
- [ ] #4 Integration tests with test audio fixtures
- [ ] #5 Handles edge cases (missing metadata, unicode, special chars)
- [ ] #6 Performance acceptable for collections of 10,000+ tracks
<!-- AC:END -->
