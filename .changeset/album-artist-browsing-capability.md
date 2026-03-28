---
"podkit": minor
"@podkit/core": minor
---

Add capability-gated clean artists transform

Devices now declare whether they use Album Artist for browse navigation via `supportsAlbumArtistBrowsing`. When enabled globally, the `cleanArtists` transform is automatically suppressed on devices that support Album Artist browsing (Rockbox, Echo Mini, generic) and auto-applied on devices that don't (iPod). Per-device overrides still take priority.

The dry-run summary shows when the transform is skipped (`Clean artists: skipped (device supports Album Artist browsing)`), and warns when it's force-enabled on a capable device. Both `sync --dry-run` and `device info` surface these in text and JSON output.
