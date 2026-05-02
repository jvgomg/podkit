---
id: TASK-042.01
title: Implement pointer-to-handle mapping in native layer
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 15:36'
labels:
  - libgpod-node
  - native
dependencies: []
parent_task_id: TASK-042
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add internal pointer management to DatabaseWrapper in the native C++ layer.

## Changes Required

### DatabaseWrapper class changes (`database_wrapper.h/.cc`)
- Add `std::vector<Itdb_Track*> trackHandles_` to store pointers
- Add `std::unordered_map<Itdb_Track*, size_t> pointerToHandle_` for reverse lookup
- Handle invalidation when tracks are removed

### AddTrack changes
- After `itdb_track_add()`, store pointer in `trackHandles_`
- Return handle index instead of calling `TrackToObject()` directly

### Track operation changes
All methods currently using `itdb_track_by_id()` should instead:
- Accept handle index as parameter
- Look up `Itdb_Track*` from `trackHandles_[index]`
- Validate handle is in bounds

Affected methods:
- `CopyTrackToDevice`
- `RemoveTrack` (must also remove from handles)
- `UpdateTrack`
- `GetTrackFilePath`
- `DuplicateTrack`
- `SetTrackThumbnails`
- `SetTrackThumbnailsFromData`
- `RemoveTrackThumbnails`
- `HasTrackThumbnails`
- `GetTrackChapters`
- `SetTrackChapters`
- `AddTrackChapter`
- `ClearTrackChapters`

### GetTracks changes
- Populate `trackHandles_` with all existing tracks on database open
- Return handle indices

### Database close/cleanup
- Clear `trackHandles_` and `pointerToHandle_`
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed 2026-02-25

Commit: 246fb19

Implemented pointer-based handle system in native C++ layer:
- Added trackHandles_ vector and pointerToHandle_ map
- Added RegisterTrack(), GetTrackByHandle(), InvalidateHandle()
- SetDatabase() populates handles for existing tracks
- Close() clears all handles
- AddTrack() returns handle index
- GetTracks() returns array of handle indices
- Added GetTrackData() to get track object by handle
- Removed GetTrackById
- Updated all track/artwork/playlist operations to use handles
<!-- SECTION:NOTES:END -->
