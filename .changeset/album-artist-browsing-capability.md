---
"podkit": minor
"@podkit/core": minor
---

Add supportsAlbumArtistBrowsing device capability

Devices now declare whether they use Album Artist for browse navigation. iPods return `false` (stock firmware only uses the Artist field), while all mass-storage presets (Rockbox, Echo Mini, generic) default to `true`. Shown in `podkit device info` text and JSON output. Configurable per-device via `supportsAlbumArtistBrowsing` in device config or the `PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING` environment variable. This is a foundation for capability-gated artist transforms in a future release.
