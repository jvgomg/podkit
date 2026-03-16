---
"@podkit/core": minor
"podkit": minor
---

Redesign quality presets to be device-aware with 4 tiers: `max`, `high`, `medium`, `low`.

The `max` preset automatically selects ALAC (lossless) on devices that support it (Classic, Video 5G/5.5G, Nano 3G-5G) and falls back to high-quality AAC on other devices. The `high` preset (VBR ~256 kbps) is the new default.

Add `encoding` config option to choose between VBR (default) and CBR encoding, available globally or per-device. Add `customBitrate` option (64-320 kbps) to override the preset target, and `bitrateTolerance` option to tune preset change detection sensitivity.

Introduce sync tags — metadata stored in the iPod track's comment field that record what transcode settings produced each file. Sync tags enable exact preset change detection, eliminating false re-transcoding caused by VBR bitrate variance. Tags are written automatically to newly transcoded tracks and can be added to existing tracks with `--force-sync-tags`. Tracks without sync tags fall back to percentage-based bitrate tolerance detection (30% for VBR, 10% for CBR).

Add `--force-transcode` flag to re-transcode all lossless-source tracks while preserving play counts, ratings, and playlist membership.

Cap transcoding bitrate for incompatible lossy sources (OGG, Opus) at the source file's bitrate to avoid creating larger files with no quality benefit.

Show sync tag presence in `podkit device info`, `podkit device music`, and track listings.

**Breaking:** Quality presets are now `max`, `high`, `medium`, `low`. The `encoding` option replaces CBR preset variants. The `lossyQuality` config option is removed.
