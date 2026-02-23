---
id: TASK-037
title: Test libgpod album artwork deduplication behavior
status: To Do
assignee: []
created_date: '2026-02-23 12:28'
labels:
  - testing
  - artwork
dependencies:
  - TASK-036
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify that libgpod's built-in artwork deduplication (via `ipod_artwork_mark_new_doubles()`) is working correctly when syncing tracks to iPod.

## Background

Research into libgpod source code revealed that it has internal deduplication for artwork:
- Located in `db-artwork-writer.c:999-1112` (`ipod_artwork_mark_new_doubles` function)
- Creates SHA1 hash of album name + image data
- Reuses artwork IDs for duplicate images within the same album
- Only works on devices supporting "sparse artwork" (iPod Video 5.5G+, Nano 2G+, Classic)

## Test Scenarios

The tests should verify these scenarios:

1. **Single album, all tracks with same artwork**
   - Sync 3 tracks from same album, each with identical embedded artwork
   - Verify only 1 artwork entry exists in iPod database (deduplicated)

2. **Two albums, different artwork each**
   - Sync 3 tracks from Album A (artwork A) and 3 from Album B (artwork B)
   - Verify exactly 2 artwork entries exist (one per album)

3. **Single album, mixed artwork presence**
   - Sync 3 tracks: 2 with embedded artwork, 1 without
   - Verify 1 artwork entry exists, and the track without artwork has no artwork reference

4. **Same image, different albums** (edge case)
   - If same image is used on two different albums, they should NOT deduplicate (album-scoped)
   - Verify 2 artwork entries exist

## Implementation Notes

- Use `@podkit/gpod-testing` to create test iPod environments
- Use the royalty-free FLAC test fixtures from TASK-036
- May need to inspect the iPod database directly to verify artwork deduplication
- Consider adding a helper to `gpod-testing` for inspecting artwork entries
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Integration test for single album with identical artwork on all tracks verifies deduplication
- [ ] #2 Integration test for multiple albums verifies separate artwork entries per album
- [ ] #3 Integration test for mixed artwork presence (some tracks with, some without)
- [ ] #4 Test for same image across different albums confirms album-scoped deduplication
- [ ] #5 Tests pass in CI environment
- [ ] #6 Tests document expected libgpod behavior for future reference
<!-- AC:END -->
