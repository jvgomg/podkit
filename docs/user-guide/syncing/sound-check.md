---
title: Sound Check
description: How podkit reads volume normalization data (ReplayGain, iTunNORM) and writes Sound Check values to the iPod database.
sidebar:
  order: 4
---

Sound Check is the iPod's built-in volume normalization feature. It adjusts playback volume so that all tracks play at a similar perceived loudness, regardless of how they were mastered.

podkit reads existing normalization data from your source files and writes the appropriate Sound Check value to the iPod database during sync. No analysis or scanning step is required — if your files already have normalization tags, podkit will use them automatically.

## How It Works

### Source Detection

podkit reads normalization data from standard audio metadata tags, in priority order:

| Tag | Format | Description |
|-----|--------|-------------|
| iTunNORM | MP3 (ID3v2), M4A, FLAC | Native iTunes normalization values |
| ReplayGain track gain | All formats | Per-track gain adjustment in dB |
| ReplayGain album gain | All formats | Per-album gain adjustment in dB (fallback) |

If a track has both iTunNORM and ReplayGain tags, iTunNORM takes priority since it is the native format the iPod firmware expects.

### Conversion

The Sound Check value stored in the iPod database is a `guint32` that represents a gain multiplier:

- **1000** = unity gain (0 dB, no adjustment)
- **> 1000** = reduce volume (loud track)
- **< 1000** = increase volume (quiet track)

ReplayGain values are converted using the formula: `1000 × 10^(gain_dB / −10)`

### Sync Behavior

- Tracks **with** normalization data: Sound Check value is written to the iPod database
- Tracks **without** normalization data: Sound Check is set to 0 (no adjustment)
- The `--dry-run` output shows how many tracks have normalization data

## Adding Normalization Data to Your Files

If your source files don't have ReplayGain or iTunNORM tags, you can add them with these tools:

### loudgain (recommended for ReplayGain)

```bash
# Scan a single album
loudgain -s e *.flac

# Scan recursively
find /music -name "*.flac" -exec loudgain -s e {} +
```

### foobar2000 (Windows)

1. Select tracks → Right-click → **ReplayGain** → **Scan per-file track gain**
2. For album gain: select all tracks in an album → **Scan as a single album**

### beets

```bash
# Enable the replaygain plugin in config.yaml
# plugins: replaygain

# Then import or update
beet replaygain
```

### iTunes / Apple Music

iTunes automatically writes iTunNORM tags when you enable Sound Check in preferences. These tags are embedded in the file and will be read by podkit.

## Dry Run Output

When running `podkit sync --dry-run`, the output includes a Sound Check line showing how many tracks have normalization data:

```
Changes:
  Tracks to add: 150
    - Transcode: 120
    - Copy: 30
  Already synced: 500

Estimates:
  Size: 1.2 GB
  Time: ~12:30
  Sound Check: 142/150 tracks have normalization data
```

## Viewing Sound Check Values

Both `podkit device music` and `podkit collection music` support displaying Sound Check values.

### On the iPod

Use the `--fields` option with `podkit device music` to see Sound Check values stored on the iPod:

```bash
podkit device music --fields title,artist,soundcheck
```

Or in JSON format:

```bash
podkit device music --format json
```

### In your collection

Use `podkit collection music` to see Sound Check values detected from your source files before syncing:

```bash
podkit collection music --fields title,artist,soundcheck
```

This is useful for verifying which tracks in your collection have normalization data. Tracks without ReplayGain or iTunNORM tags will show an empty soundcheck field.
