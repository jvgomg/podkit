---
id: TASK-036
title: Source royalty-free FLAC test files with metadata and artwork
status: Done
assignee: []
created_date: '2026-02-23 12:27'
updated_date: '2026-02-23 15:46'
labels:
  - testing
  - infrastructure
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Acquire or create a set of royalty-free FLAC audio files for use in integration tests. These files need proper metadata tags and embedded album artwork to support testing of the sync pipeline, transcoding, and artwork transfer features.

The test files should cover various scenarios needed for comprehensive testing of the podkit sync workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At least 6 FLAC files organized as 2 'albums' (3 tracks each)
- [x] #2 All files have complete metadata: title, artist, album, track number, year
- [x] #3 Album artwork embedded in files (can be same image for all tracks in an album)
- [x] #4 Different artwork between the two albums
- [x] #5 At least one track without embedded artwork (for edge case testing)
- [x] #6 Files are genuinely royalty-free/CC0 licensed with clear attribution
- [x] #7 Files stored in a test fixtures directory with documentation of source/license
- [x] #8 Total size reasonable for repo inclusion (< 10MB ideally, or use git-lfs)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Notes (2026-02-23)

Researched royalty-free FLAC sources. Key findings:
- HoliznaCC0 on FMA: CC0 licensed lo-fi, but FLAC availability unclear
- Musopen/Internet Archive: Public domain classical, FLAC available but large files
- thetestdata.com: Royalty-free but files are 13-61MB each (too large)
- Could generate synthetic test audio for smallest size

## Implementation Complete

Generated all-synthetic test audio (pivoted from downloading due to licensing/download complexity):

**Album 1: Synthetic Classics** (3 tracks, ~2.9MB)
- 01-harmony.flac - C major chord
- 02-vibrato.flac - Vibrato modulation
- 03-tremolo.flac - Tremolo effect

**Album 2: Test Tones** (3 tracks, ~1.4MB)
- 01-a440.flac - Pure A440 reference
- 02-sweep.flac - Frequency sweep
- 03-dual-tone.flac - Dual tone (NO artwork - edge case)

**Total size: 4.3MB** - no git-lfs needed

All files have complete metadata (artist, album, title, track#, date, genre) and embedded artwork (except 03-dual-tone.flac for edge case testing).
<!-- SECTION:NOTES:END -->
