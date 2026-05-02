---
id: TASK-041
title: Investigate and address libgpod CRITICAL assertion failures in tests
status: Done
assignee: []
created_date: '2026-02-25 12:21'
updated_date: '2026-03-09 15:12'
labels:
  - libgpod
  - testing
  - investigation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During test runs of `@podkit/libgpod-node`, GLib CRITICAL assertion failures are logged to stderr even though all tests pass. This suggests we may be using libgpod incorrectly - potentially missing required initialization steps or calling APIs in the wrong order.

## Observed Errors

```
CRITICAL: itdb_playlist_mpl: assertion 'pl' failed
CRITICAL: prepare_itdb_for_write: assertion 'mpl' failed
CRITICAL: mk_mhla: assertion 'fexp->albums' failed
CRITICAL: mk_mhli: assertion 'fexp->artists' failed
CRITICAL: itdb_chapterdata_free: assertion 'chapterdata' failed
```

## Context

- GLib CRITICAL errors are non-fatal by default (log and continue)
- Functions return NULL/early when assertions fail
- Tests pass because the code handles NULL returns gracefully
- However, this may indicate improper library usage

## Concerns

1. **Missing initialization**: libgpod may require creating certain structures (master playlist, albums list, artists list) before other operations
2. **Wrong API call order**: We may be calling write/export APIs before the database is properly set up
3. **Cleanup issues**: `itdb_chapterdata_free` assertion suggests we're freeing NULL or already-freed data
4. **Silent failures**: Operations may be silently failing and we're not detecting it
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Identify which specific test scenarios trigger each CRITICAL error
- [x] #2 Understand what libgpod expects (required initialization, API call order)
- [x] #3 Determine if current behavior causes actual bugs or just noise
- [x] #4 Fix improper library usage if found
- [x] #5 Tests run without CRITICAL errors (or document why they're acceptable)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root Causes Identified

### 1. Track Removal Playlist Bug (Primary Issue)
**Location:** `track_operations.cc:RemoveTrack()`

`itdb_track_remove()` does NOT remove tracks from playlists - only from `itdb->tracks`. This left stale references causing:
- `prepare_itdb_for_write: assertion 'link' failed` - playlist references track not in tracks list
- `Itdb_Track ID '0' not found` - corrupt playlist entries on reopen

**Fix:** Remove track from all playlists before calling `itdb_track_remove()`.

### 2. Master Playlist Missing (Database.create())
**Location:** `gpod_binding.cc:Create()`

`itdb_new()` creates empty database without master playlist. Operations that need it fail:
- `itdb_playlist_mpl: assertion 'pl' failed`
- `prepare_itdb_for_write: assertion 'mpl' failed`
- `mk_mhla: assertion 'fexp->albums' failed`
- `mk_mhli: assertion 'fexp->artists' failed`

**Fix:** Create master playlist after `itdb_new()` using:
```cpp
Itdb_Playlist* mpl = itdb_playlist_new("iPod", FALSE);
itdb_playlist_set_mpl(mpl);
itdb_playlist_add(db, mpl, -1);
```

### 3. Chapter Data NULL Pointer
**Location:** `track_operations.cc:ClearTrackChapters()`, `SetTrackChapters()`

Setting `track->chapterdata = nullptr` after freeing caused:
- `itdb_chapterdata_free: assertion 'chapterdata' failed`

This is a libgpod bug - `itdb_track_free()` calls `itdb_chapterdata_free()` without NULL check.

**Fix:** Create new empty chapterdata instead of leaving NULL.

## Files Changed
- `native/track_operations.cc` - RemoveTrack playlist cleanup, chapterdata fixes
- `native/gpod_binding.cc` - Create() master playlist initialization

## Test Coverage
- Added `video-removal-criticals.integration.test.ts` to verify video removal scenario
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary
Fixed all libgpod CRITICAL assertion failures in libgpod-node tests.

### Changes Made
1. **RemoveTrack**: Now removes tracks from all playlists before deletion
2. **Database.create()**: Creates master playlist for new databases
3. **ClearTrackChapters/SetTrackChapters**: Creates empty chapterdata instead of NULL

### Result
- All 277 tests pass
- No CRITICAL or WARNING messages
- Video removal scenario (user-reported issue) now works cleanly
<!-- SECTION:FINAL_SUMMARY:END -->
