---
"podkit": minor
"@podkit/core": minor
---

Add three-tier transfer mode system controlling how files are prepared for the device.

**Transfer modes:**
- `fast` (default): optimizes for sync speed — direct-copies compatible files, strips artwork from transcodes
- `optimized`: strips embedded artwork from all file types (including MP3, M4A, ALAC copies) via FFmpeg stream-copy, reducing storage usage without re-encoding
- `portable`: preserves embedded artwork in all files for use outside the iPod ecosystem

**Configuration:**
- `transferMode` config option (global and per-device)
- `--transfer-mode` CLI flag
- `PODKIT_TRANSFER_MODE` environment variable

**Selective re-processing:**
- `--force-transfer-mode` flag re-processes only tracks whose transfer mode doesn't match the current setting
- `PODKIT_FORCE_TRANSFER_MODE` environment variable
- Works on all file types including direct copies (unlike `--force-transcode` which only affects transcoded tracks)

**Device inspection:**
- `podkit device music` and `podkit device video` stats show transfer mode distribution
- Missing transfer field flagged alongside missing artwork hash in sync tag summary
- New `syncTagTransfer` field available in `--tracks --fields` for querying transfer mode data
- Dry-run output shows configured transfer mode

**Under the hood:**
- Granular operation types: `add-direct-copy`, `add-optimized-copy`, `add-transcode` (and upgrade equivalents)
- Sync tags written to all tracks including direct copies (`quality=copy`)
- `DeviceCapabilities` abstraction for device-aware sync decisions
- Sync tag field `transfer=` tracks which mode was used per track
