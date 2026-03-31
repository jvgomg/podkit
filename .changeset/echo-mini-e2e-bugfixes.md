---
"@podkit/core": patch
"podkit": patch
---

Fix multiple bugs discovered during end-to-end Echo Mini hardware validation

**Sync pipeline:**

- Create temp directory for optimized-copy operations (not just transcodes), fixing "No such file or directory" FFmpeg failures on mass-storage devices
- Capture last 1000 chars of FFmpeg stderr (instead of first 500) so actual errors aren't swallowed by the version banner

**Device preset content paths:**

- Pass device preset content paths to adapter even when no user overrides exist, fixing Echo Mini's `musicDir: ''` being ignored and files landing in `Music/` instead of device root

**Artwork:**

- Read embedded artwork during mass-storage device scan (`skipCovers: false`) so artwork presence is correctly detected, preventing false `artwork-added` upgrades on every sync
- Force `yuvj420p` (4:2:0) pixel format in artwork scale filter — JPEG with 4:4:4 chroma subsampling does not display on the Echo Mini

**Sync tag and preset detection:**

- Treat `quality=copy` sync tags as in-sync when the classifier would also route the source as a copy, preventing false preset-upgrade detection on FLAC-capable mass-storage devices
- Route lossless sources to transcode (not copy) when quality preset is non-lossless, even if the device natively supports the source codec (e.g., FLAC device with quality=high should produce AAC)
