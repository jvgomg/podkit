---
id: TASK-250
title: Artwork embedding fails for OGG/Opus and FLAC containers
status: Done
assignee: []
created_date: '2026-03-28 13:09'
updated_date: '2026-03-30 14:21'
labels:
  - bug
  - transcoding
  - artwork
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts (pushArtworkArgs helper)
  - packages/podkit-core/src/transcode/codecs.ts (CODEC_METADATA)
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `pushArtworkArgs()` helper in `packages/podkit-core/src/transcode/ffmpeg.ts` uses `-c:v mjpeg -disposition:v attached_pic` to embed artwork in transcoded audio files. This works for M4A (AAC/ALAC) and MP3 containers, but **fails for OGG and FLAC containers** because they don't support MJPEG video streams.

**Root cause:** OGG and FLAC containers use a different artwork mechanism — `METADATA_BLOCK_PICTURE` via Vorbis comments — rather than video stream attachment. The current implementation assumes the M4A/MP3 approach universally.

**Current impact:** Low. No device profile today combines Opus with `artworkSources: ['embedded']`. Opus-capable devices (Rockbox, Echo Mini) use sidecar artwork, so the problematic code path is never hit. But this is a latent bug that will surface when a device profile is added that needs embedded artwork with Opus or FLAC output.

**If triggered:** FFmpeg would error with a container/codec incompatibility when trying to embed MJPEG in an OGG container during transcoding.

**Proposed solution (two options, simplest first):**

1. **Strip artwork for OGG/FLAC containers:** In `pushArtworkArgs()`, check the target container format. For OGG and FLAC, always use `-vn` (strip artwork) and rely on the sidecar artwork system. This is the simplest fix and works today since all Opus/FLAC-capable devices support sidecar artwork.

2. **Implement METADATA_BLOCK_PICTURE embedding:** Use FFmpeg's Vorbis comment metadata to embed artwork via the `METADATA_BLOCK_PICTURE` field. This is more complex but would enable embedded artwork in OGG/Opus and FLAC files for future devices that require it.

Option 1 is recommended as the immediate fix. Option 2 can be a follow-up if a device ever needs embedded artwork in OGG/FLAC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Transcoding to Opus (OGG container) with artwork enabled does not cause FFmpeg errors
- [x] #2 Transcoding to FLAC with artwork enabled does not cause FFmpeg errors
- [x] #3 Artwork is still delivered via sidecar for OGG/FLAC output when device supports sidecar artwork
- [x] #4 Existing M4A and MP3 artwork embedding behavior unchanged
- [x] #5 Unit test: buildOpusArgs with artworkResize > 0 produces -vn (strip) not -c:v mjpeg
- [x] #6 Unit test: buildFlacArgs with artworkResize > 0 produces -vn (strip) not -c:v mjpeg
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Fix: Strip artwork for OGG/FLAC containers instead of attempting MJPEG embedding

**Problem:** `pushArtworkArgs()` unconditionally used `-c:v mjpeg -disposition:v attached_pic` for artwork embedding, which fails for OGG and FLAC containers that don't support MJPEG video streams.

**Solution (Option 1 from task):** Added container-format awareness to artwork handling. OGG and FLAC containers now always get `-vn` (strip artwork), relying on sidecar artwork delivery. M4A and MP3 containers continue to use MJPEG embedding as before.

**Changes:**
- `packages/podkit-core/src/transcode/ffmpeg.ts`:
  - Added `MJPEG_ARTWORK_FORMATS` set (`ipod`, `mp3`) to identify containers that support MJPEG artwork
  - Added `ffmpegFormat` option to `pushArtworkArgs()` and `CodecBuilderOptions`
  - Updated all 5 codec builders (AAC, Opus, MP3, FLAC, ALAC) to pass `ffmpegFormat` through
  - Updated `buildOptimizedCopyArgs()` to check format before attempting MJPEG embedding
- `packages/podkit-core/src/transcode/ffmpeg.test.ts`:
  - Updated Opus artwork tests to expect `-vn` instead of MJPEG
  - Updated FLAC artwork test to expect `-vn` instead of MJPEG

All 2203 podkit-core tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
