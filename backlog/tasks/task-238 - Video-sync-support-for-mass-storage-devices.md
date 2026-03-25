---
id: TASK-238
title: Video sync support for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 21:40'
updated_date: '2026-03-25 01:15'
labels:
  - feature
  - core
  - cli
  - refactor
milestone: 'Mass Storage Device Support: Extended'
dependencies:
  - TASK-234
references:
  - packages/podkit-cli/src/commands/video-presenter.ts
  - packages/podkit-core/src/sync/handlers/video-handler.ts
  - packages/podkit-cli/src/commands/sync.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VideoPresenter and VideoHandler are tightly coupled to iPod internals (`ipod.getInfo().device`, `IpodDatabase`). Currently mass-storage devices with `supportsVideo: true` would crash VideoPresenter.

A quick safety gate is being added (TASK-234) to block video sync for non-iPod devices. This task covers the full work to make video sync work on mass-storage devices:

1. **VideoPresenter refactor** — decouple from `IpodDatabase`, use `DeviceAdapter` interface like MusicPresenter
2. **VideoHandler refactor** — remove `IPodTrack` casts (partially addressed by TASK-237), use `DeviceAdapter` for track operations
3. **Video file placement** — define directory structure for video files on mass-storage (analogous to music file placement)
4. **Video capability detection** — use `supportsVideo` from device capabilities to gate video sync planning
5. **Video metadata** — ensure video metadata handling works without iTunesDB

This is a significant refactor. VideoPresenter is the most iPod-coupled presenter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoPresenter uses DeviceAdapter interface instead of IpodDatabase directly
- [x] #2 VideoHandler execution path uses DeviceTrack instead of IPodTrack
- [x] #3 Video files placed in correct directory structure on mass-storage devices
- [x] #4 Video sync works end-to-end for mass-storage devices with supportsVideo: true
- [x] #5 Existing iPod video sync behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed (2026-03-25)

**VideoPresenter refactor:**
- `computeDiff`: checks for `getIpodDatabase()` method to resolve device profile — iPod uses generation-based profile, mass-storage uses `getDefaultDeviceProfile()`
- `executeSync`: passes adapter directly to executor via `device` parameter (was passing ipod database)
- `getDeviceItems`: already compatible (video handler takes DeviceAdapter)

**sync.ts video gate:**
- Replaced dual-check (`!isIpodDevice` + `ipod?.getInfo()`) with single capabilities-based check: `!(deviceCapabilities?.supportsVideo ?? false)`
- Now passes `adapter` instead of `ipod ?? adapter` to video sync

**Video file placement on mass-storage:**
- Added `VIDEO_DIR = 'Video'` constant and `generateVideoPath()` in mass-storage-utils
- Movies: `Video/Movies/{title} ({year}).m4v`
- TV Shows: `Video/{show}/Season {N}/S01E01 - {title}.m4v`
- `addTrack` routes video media types to Video/ directory automatically
- `remove` cleans up empty parent dirs to both Music/ and Video/ boundaries

**Video scanning on mass-storage:**
- Added `VIDEO_EXTENSIONS` set (.m4v, .mp4, .mov, .avi, .mkv)
- `scanTracks` now scans both Music/ and Video/ directories
- `walkDirectory` accepts a filter function for extensibility
- `readVideoMetadata` creates basic tracks from video files with media type flags
<!-- SECTION:NOTES:END -->
