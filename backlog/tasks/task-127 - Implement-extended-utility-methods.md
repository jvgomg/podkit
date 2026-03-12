---
id: TASK-127
title: Implement extended utility methods
status: To Do
assignee: []
created_date: '2026-03-12 10:56'
labels:
  - phase-9
  - api
milestone: ipod-db Extended API
dependencies:
  - TASK-121
references:
  - doc-003
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the remaining libgpod-node methods that aren't in the core 24 but complete full API parity.

**Database lifecycle methods:**
- `openFile(filename)` — Parse database from a file path directly (not a full iPod mount)
- `setMountpoint(path)` — Change mountpoint after creation
- `getFilename()` — Get database file path

**Track utility methods:**
- `duplicateTrack(handle)` — Clone a track (copy all metadata, return new handle)
- `getTrackByDbId(dbid)` — Lookup track by database ID (64-bit)

**Playlist utility methods:**
- `getPlaylistById(id)` — Find playlist by numeric ID
- `getPlaylistTracks(playlistId)` — Get all track handles in a playlist

**Device methods:**
- `getSysInfo(key)` — Read arbitrary SysInfo key
- `setSysInfo(key, value)` — Write SysInfo key-value pair
- `getDeviceCapabilities()` — Return full device capability flags

**Artwork utility methods:**
- `getUniqueArtworkIds()` — Return list of unique artwork IDs in database
- `getArtworkCapabilities()` — Return artwork format support info for device

These methods are not currently used by podkit-core but may be needed by future features or by users of the library directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 12 extended methods implemented
- [ ] #2 openFile works without full iPod directory structure
- [ ] #3 duplicateTrack creates independent copy with new handle
- [ ] #4 getTrackByDbId returns correct track for valid dbid
- [ ] #5 getSysInfo/setSysInfo read and write SysInfo file
- [ ] #6 getDeviceCapabilities returns correct flags for all device generations
- [ ] #7 Unit tests for each method
- [ ] #8 Integration tests cover key scenarios
<!-- AC:END -->
