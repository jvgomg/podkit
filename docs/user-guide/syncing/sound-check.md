---
title: Sound Check
description: How podkit reads volume normalization data (ReplayGain, iTunNORM) and writes Sound Check values to the iPod database.
sidebar:
  order: 6
---

Sound Check is the iPod's built-in volume normalization feature. It adjusts playback volume so that all tracks play at a similar perceived loudness, regardless of how they were mastered.

podkit reads existing normalization data from your source files and writes the appropriate Sound Check value to the iPod database during sync. No analysis or scanning step is required — if your files already have normalization tags, podkit will use them automatically.

:::note[Device-aware normalization]
podkit adapts its normalization behavior based on the `audioNormalization` device capability:

- **`soundcheck`** (iPod) — podkit writes Sound Check values to the iPod database. This is what the rest of this page describes.
- **`replaygain`** (Rockbox) — Rockbox reads ReplayGain tags from audio files natively. If your source files already have ReplayGain tags and you sync them without transcoding, the existing tags are preserved and Rockbox will use them. podkit does not yet write new ReplayGain tags during sync.
- **`none`** (Echo Mini, generic DAPs) — normalization is skipped entirely. podkit hides the Sound Check line from dry-run output and skips soundcheck upgrade detection.

You can override this per device in your config — see [Config File Reference](/reference/config-file#device-capability-overrides).
:::

This works with both [directory](/user-guide/collections/directory/) and [Subsonic](/user-guide/collections/subsonic/) collections. Navidrome and other [OpenSubsonic](https://opensubsonic.netlify.app/)-compatible servers expose ReplayGain data via the API, so podkit can extract Sound Check values without needing direct file access.

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

## Viewing Sound Check Values

### Summary stats

By default, `podkit device music` and `podkit collection music` show a stats summary. When any tracks have Sound Check data, the summary includes a coverage line showing the count and percentage:

```
Music on MYIPOD:
  Tracks:  650
  Albums:  42
  Artists: 28
  Sound Check: 620 (95%)
```

If some tracks have Sound Check data but coverage is not 100%, a tip is shown with a link back to this page:

```
Tips:
  Some tracks are missing Sound Check data. Add normalization tags for consistent volume.
  See: https://jvgomg.github.io/podkit/user-guide/syncing/sound-check/
```

### Dry run output

When running [`podkit sync --dry-run`](/reference/cli-commands/), the output includes a Sound Check line showing how many tracks have normalization data:

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

### Verbose mode

Use `-v` to see a breakdown of which normalization tag formats were found in a collection:

```bash
podkit collection music -v
```

```
Music in collection 'main':
  Source: directory (/Volumes/Music/FLAC)

  Tracks:  650
  Albums:  42
  Artists: 28
  Sound Check: 620 (95%)
    iTunNORM            380
    ReplayGain (track)  200
    ReplayGain (album)   40
```

The source breakdown is only available for collections (not devices), since the iPod database stores only the final Sound Check value without recording which tag format it came from.

The available sources depend on the adapter:

| Adapter | Available sources |
|---------|-------------------|
| [directory](/user-guide/collections/directory/) | iTunNORM, ReplayGain (track), ReplayGain (album) |
| [subsonic](/user-guide/collections/subsonic/) | ReplayGain (track), ReplayGain (album) |

### Per-track values

Use `--tracks --fields` to see individual Sound Check values:

```bash
podkit device music --tracks --fields title,artist,soundcheck
podkit collection music --tracks --fields title,artist,soundcheck
```

Or in JSON format:

```bash
podkit device music --tracks --format json
```

Tracks without ReplayGain or iTunNORM tags will show an empty soundcheck field.

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
