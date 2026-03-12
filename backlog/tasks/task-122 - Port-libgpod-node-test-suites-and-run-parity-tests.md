---
id: TASK-122
title: Port libgpod-node test suites and run parity tests
status: To Do
assignee: []
created_date: '2026-03-12 10:55'
labels:
  - phase-5
  - testing
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-121
references:
  - packages/libgpod-node/src/__tests__/
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port all 11 existing libgpod-node integration test suites to use @podkit/ipod-db, plus create parity tests that run operations on both implementations and compare results.

**Test suites to port (11 total):**

1. `database.integration.test.ts` — Basic DB operations, device info, media types, path conversion
2. `tracks.integration.test.ts` — Track CRUD, metadata, file copying
3. `artwork.integration.test.ts` — Artwork set from file/buffer, remove, has
4. `artwork-deduplication.integration.test.ts` — Artwork sharing across tracks
5. `playlists.integration.test.ts` — Playlist CRUD, track management
6. `smart-playlists.integration.test.ts` — Smart playlists (verify opaque preservation in M1, full CRUD in M2)
7. `chapters.integration.test.ts` — Chapter data (verify opaque preservation in M1, full CRUD in M2)
8. `photos.integration.test.ts` — Skip for M1 (M3 milestone)
9. `video-tracks.integration.test.ts` — Video-specific metadata
10. `video-removal-criticals.integration.test.ts` — Edge cases with video removal
11. `edge-cases-investigation.integration.test.ts` — Empty DBs, playlist edge cases

**Parity tests (`__tests__/parity/`):**
Run identical operations on both libgpod-node and ipod-db, compare:
- Parse same fixture → compare track metadata field by field
- Create DB → add tracks → save → compare resulting iTunesDB bytes
- Playlist operations → compare playlist state
- Artwork operations → compare artwork presence

These tests are temporary — removed when libgpod-node is dropped.

**Property-based tests:**
Add `fast-check` property tests for round-trip validation with random data structures.

**Database integrity checker:**
Implement validation function and run after every write in tests:
- All playlist track references point to existing tracks
- All artwork references are valid
- Master playlist exists and contains all tracks
- Track IDs are unique
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 11 test suites ported (10 active in M1, photos skipped)
- [ ] #2 All ported tests pass with ipod-db implementation
- [ ] #3 Parity tests run both implementations and show identical results
- [ ] #4 Property-based tests pass 1000+ iterations
- [ ] #5 Database integrity checker validates after every write
- [ ] #6 No behavioral differences between libgpod-node and ipod-db for the 24 core methods
<!-- AC:END -->
