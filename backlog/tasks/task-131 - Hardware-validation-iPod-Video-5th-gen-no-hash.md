---
id: TASK-131
title: 'Hardware validation: iPod Video 5th gen (no hash)'
status: To Do
assignee: []
created_date: '2026-03-12 11:11'
labels:
  - phase-5
  - hardware-validation
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-123
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Validate @podkit/ipod-db on a real iPod Video 5th gen (the device available for testing). This device uses no hash algorithm, making it the simplest hardware validation target.

**Device details:**
- iPod Video 5th gen (or 5.5th gen)
- Models: A002/A146 (30GB), A003/A147 (60GB), A452 (U2), A444/A446/A664/A448/A450 (5.5th gen)
- Hash: NONE
- Artwork: RGB565 LE (format IDs 1028 100x100, 1029 200x200)
- Video support: Yes
- Music directories: F00-F19

**Validation checklist:**
1. Create database with ipod-db → write to device
2. Device boots and loads database (no "connect to iTunes" error)
3. Tracks appear in Music menu
4. Track playback works (audio plays correctly)
5. Album artwork displays on Now Playing screen
6. Playlists appear and contain correct tracks
7. Track metadata correct (title, artist, album, genre, etc.)
8. Add/remove tracks via sync → database updates correctly
9. Large collection (500+ tracks) loads without issues
10. Video tracks play (if tested)

**When to run:** After TASK-123 (swap to ipod-db) is complete, before TASK-124 (cleanup).

**Document results** in `docs/devices/supported-devices.md` verification table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 iPod Video 5th gen loads database created by ipod-db
- [ ] #2 Track playback works
- [ ] #3 Album artwork displays correctly
- [ ] #4 Playlists appear with correct tracks
- [ ] #5 Track metadata displays correctly
- [ ] #6 Results documented in supported-devices.md
<!-- AC:END -->
