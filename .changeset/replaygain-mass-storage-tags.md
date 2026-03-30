---
"@podkit/core": minor
---

Write ReplayGain tags to transcoded files for mass-storage devices with `audioNormalization: 'replaygain'` (e.g., Rockbox).

Previously, ReplayGain data was only stored as iPod soundcheck values in the iTunes database. Mass-storage devices read volume normalization from file tags, but FLAC→AAC transcoding strips ReplayGain metadata. Tracks on Rockbox devices played without normalization.

**What changed:**

- ReplayGain tags (`REPLAYGAIN_TRACK_GAIN`, `REPLAYGAIN_TRACK_PEAK`) are injected via FFmpeg `-metadata` flags during transcoding for MP3, FLAC, and OGG/Opus output
- M4A files (where FFmpeg can't write ReplayGain metadata) get tags written via node-taglib-sharp after transfer
- Raw ReplayGain dB/peak values are preserved from collection sources (Subsonic API, local files) through the sync pipeline, avoiding precision loss from soundcheck integer conversion
- Device scan reads ReplayGain from file tags so the sync engine can detect when normalization data changes and needs updating
- Direct-copy operations skip tag writing since source files already have correct tags
- `soundcheckToReplayGainDb()` reverse conversion function added for back-converting when raw values aren't available

**Bug fix:** `IpodTrackImpl` used `data.soundcheck || undefined` which coerced a valid soundcheck of `0` to `undefined`. Changed to `data.soundcheck ?? undefined`.
