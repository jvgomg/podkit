---
id: TASK-253
title: ReplayGain album gain/peak support for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-30 13:36'
updated_date: '2026-03-30 22:27'
labels:
  - enhancement
  - mass-storage
  - audio-normalization
dependencies: []
references:
  - packages/podkit-core/src/metadata/normalization.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently podkit only carries track-level ReplayGain data (track gain + track peak) through the sync pipeline. Rockbox and other DAPs support album-level normalization too — users can choose between track and album modes in their device settings.

### What's missing

- `CollectionTrack` has `replayGainTrackGain` and `replayGainTrackPeak` but no album equivalents
- The Subsonic adapter has access to `song.replayGain.albumGain` and `song.replayGain.albumPeak` but doesn't store them
- The directory adapter can read `replaygain_album_gain` and `replaygain_album_peak` from music-metadata but doesn't store them
- FFmpeg `-metadata` only writes `REPLAYGAIN_TRACK_GAIN` / `REPLAYGAIN_TRACK_PEAK`
- The tag writer only writes track-level ReplayGain

### What needs to change

1. Add `replayGainAlbumGain?: number` and `replayGainAlbumPeak?: number` to `CollectionTrack`
2. Populate in both adapters (subsonic + directory)
3. Thread through `DeviceTrackInput` / `TrackMetadata`
4. Add to FFmpeg `-metadata` flags in `pushReplayGainMetadata()`
5. Add to `TagWriter.writeReplayGain()` (node-taglib-sharp has `replayGainAlbumGain` and `replayGainAlbumPeak` setters)
6. Thread through the pipeline and adapter the same way track gain is handled

### Context

This was identified during the track-level ReplayGain implementation. Track gain is the more common normalization mode and was prioritized. Album gain is a follow-up for completeness.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Album gain and peak values are extracted from Subsonic API and local file metadata
- [x] #2 Album gain/peak are written via FFmpeg -metadata flags during transcode
- [x] #3 Album gain/peak are written via tag writer for M4A files and soundcheck updates
- [x] #4 Existing track gain behavior is unchanged
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented as part of the audio normalization refactoring. The `AudioNormalization` type was designed with `albumGain` and `albumPeak` fields from the start, so TASK-253 was a matter of populating them from sources and threading through the pipeline.

**Changes:**
- `extractNormalization()` extracts album gain/peak from `replaygain_album_gain`/`replaygain_album_peak` metadata alongside track data
- Subsonic adapter extracts `albumGain`/`albumPeak` from the ReplayGain API response
- FFmpeg writes `REPLAYGAIN_ALBUM_GAIN` and `REPLAYGAIN_ALBUM_PEAK` metadata flags during transcode
- Tag writer writes album gain/peak via node-taglib-sharp (`replayGainAlbumGain`, `replayGainAlbumPeak` setters)
- Pipeline's `buildReplayGainOption()` and mass-storage adapter's `buildReplayGainData()` pass album data through
- Mass-storage file scanning extracts album gain/peak from scanned files
- Tests added for FFmpeg album tag injection, normalization extraction with album data, and subsonic adapter album extraction
<!-- SECTION:FINAL_SUMMARY:END -->
