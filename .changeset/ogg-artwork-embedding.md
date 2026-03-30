---
"@podkit/core": minor
---

Embed artwork in OGG/Opus files for mass-storage devices with `artworkSources: ['embedded']`.

FFmpeg's OGG muxer cannot write image streams (upstream tickets #4448, #9044, open since 2015), so OGG output was previously stripped of artwork with `-vn`. Mass-storage devices relying on embedded artwork showed no cover art for Opus tracks.

**What changed:**

- After FFmpeg produces an OGG file (with artwork stripped), the pipeline post-processes it via node-taglib-sharp to embed artwork as a `METADATA_BLOCK_PICTURE` Vorbis comment
- Artwork is resized to the device's `artworkMaxResolution` before embedding, matching the behavior of other formats where FFmpeg handles resize during transcode
- Resize results are cached per-album to avoid redundant FFmpeg image-processing spawns
- New `TagWriter.writePicture()` method and `resizeArtwork()` utility
- Pending picture writes follow the same deferred flush pattern as comment and ReplayGain tag writes (queued by `updateTrack`, flushed by `save()`)
