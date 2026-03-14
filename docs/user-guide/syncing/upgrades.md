---
title: Track Upgrades
description: How podkit detects and upgrades improved source files during sync.
sidebar:
  order: 5
---

When you improve your music collection — replacing MP3s with lossless files, adding artwork, or fixing metadata — podkit detects these changes and upgrades the tracks on your iPod automatically. Play counts, star ratings, and playlist membership are preserved.

## How It Works

During sync, podkit compares metadata between your source files and the tracks already on your iPod. When it finds a matched track where the source has meaningfully improved, it upgrades the iPod copy in place rather than removing and re-adding it.

This detection uses metadata fields (format, bitrate, artwork presence, Sound Check values, genre, year, etc.) rather than file hashing or modification times, so it works with both local directories and remote Subsonic sources.

## Upgrade Categories

podkit recognizes several types of improvements:

| Category | Example | What happens |
|----------|---------|--------------|
| **Format upgrade** | MP3 replaced with FLAC | New file transcoded and copied to iPod |
| **Quality upgrade** | 128 kbps re-ripped at 320 kbps | New file transcoded and copied to iPod |
| **Preset upgrade** | Quality preset changed from low to high | Re-transcoded at new (higher) bitrate |
| **Preset downgrade** | Quality preset changed from high to low | Re-transcoded at new (lower) bitrate |
| **Artwork added** | Artwork embedded into previously bare files | New file copied with artwork |
| **Sound Check update** | ReplayGain tags added to collection | Metadata updated (no file transfer) |
| **Metadata correction** | Genre, year, or track numbers fixed | Metadata updated (no file transfer) |

File-replacement upgrades (format, quality, preset, artwork) require transferring a new audio file to the iPod. Metadata-only updates (Sound Check, metadata corrections) are instant since they only touch the iPod database.

## Preserved User Data

Upgrades preserve everything about the track's history on the iPod:

- Play counts
- Star ratings
- Skip counts
- Playlist membership
- Date added

This is possible because podkit updates the existing database entry rather than deleting and recreating it.

## Preset Changes

When you change your quality preset (e.g., from `low` to `high`), podkit detects that existing transcoded tracks on the iPod don't match the new target bitrate and re-transcodes them on the next sync. Both directions are supported:

- **Preset upgrade**: iPod bitrate is significantly lower than the new preset target (e.g., switching from `low` at 128 kbps to `high` at 256 kbps)
- **Preset downgrade**: iPod bitrate is significantly higher than the new preset target (e.g., switching from `max` at 320 kbps to `medium` at 192 kbps)

This only affects lossless source tracks (FLAC, WAV, AIFF) that are transcoded during sync. Lossy source tracks (MP3, AAC) are copied as-is regardless of the quality preset.

A tolerance of ±50 kbps is used to handle natural VBR bitrate variance. Tracks whose bitrate falls within this tolerance of the preset target are considered in sync.

**VBR overlap note:** Adjacent VBR presets (e.g., medium and high) can produce overlapping bitrate ranges depending on content complexity. Jumps of two or more preset levels (e.g., low → high, low → max) are always detected. Single-step transitions between adjacent VBR presets may miss some tracks in the overlap zone — use CBR presets (e.g., `low-cbr`, `high-cbr`) for guaranteed detection of all preset changes.

Like other file-replacement upgrades, preset changes are suppressed by `--skip-upgrades`.

## Dry-Run Output

Use `--dry-run` to preview upgrades before they happen:

```bash
podkit sync --dry-run
```

```
Sync plan:
  Add:       5 tracks
  Remove:    2 tracks
  Upgrade:  12 tracks
    Format upgrade:     8  (MP3 → FLAC)
    Preset upgrade:     2  (quality preset changed)
    Artwork added:      1
    Sound Check update: 1
  Unchanged: 1,397 tracks
```

## Skipping Upgrades

Upgrades are on by default. To skip file-replacement upgrades (for example, on a device with limited storage), use the `--skip-upgrades` flag:

```bash
podkit sync --skip-upgrades
```

Or set it in your config file, either globally or per device:

```toml
# Skip upgrades on all devices
skipUpgrades = true

# Or skip upgrades on a specific device
[devices.nano]
volumeUuid = "EFGH-5678"
skipUpgrades = true    # Nano has limited space
```

When upgrades are skipped, dry-run still reports available upgrades so you can see what you are missing.

## See Also

- [Music Syncing](/user-guide/syncing/music) — How music syncing works
- [Sound Check](/user-guide/syncing/sound-check) — Volume normalization
- [Config File Reference](/reference/config-file) — `skipUpgrades` option
- [CLI Commands](/reference/cli-commands) — `--skip-upgrades` flag
