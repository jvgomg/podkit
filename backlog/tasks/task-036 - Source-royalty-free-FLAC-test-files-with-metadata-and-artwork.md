---
id: TASK-036
title: Source royalty-free FLAC test files with metadata and artwork
status: To Do
assignee: []
created_date: '2026-02-23 12:27'
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
- [ ] #1 At least 6 FLAC files organized as 2 'albums' (3 tracks each)
- [ ] #2 All files have complete metadata: title, artist, album, track number, year
- [ ] #3 Album artwork embedded in files (can be same image for all tracks in an album)
- [ ] #4 Different artwork between the two albums
- [ ] #5 At least one track without embedded artwork (for edge case testing)
- [ ] #6 Files are genuinely royalty-free/CC0 licensed with clear attribution
- [ ] #7 Files stored in a test fixtures directory with documentation of source/license
- [ ] #8 Total size reasonable for repo inclusion (< 10MB ideally, or use git-lfs)
<!-- AC:END -->
