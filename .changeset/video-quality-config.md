---
"podkit": patch
---

Apply the configured video quality during sync

`podkit sync` resolved the video quality before the device was open, when its capabilities are still unknown, and an unknown device resolves to no video quality, so `quality`, `videoQuality` and their per-device and environment-variable forms were ignored and video was always encoded at `high` unless `--quality` or `--video-quality` was passed. The configured chain is now resolved once the device is open; `--video-quality` still overrides `--quality`, which overrides the device and then the global settings.

**One-time effect:** if you configured a video quality other than `high`, the first sync after upgrading re-transcodes the videos that were encoded at `high`, to the quality you configured.
