---
title: First Sync
description: A detailed walkthrough of your first music sync with podkit, including troubleshooting tips.
sidebar:
  order: 3
---

# First Sync Walkthrough

This guide walks you through your first sync in detail, explaining what happens at each step and how to troubleshoot common issues.

## Before You Begin

Ensure you have:

- podkit installed and configured (see [Quick Start](/getting-started/quick-start))
- A supported iPod connected and mounted
- Music files in your configured collection path

## Understanding the Sync Process

When you run `podkit sync`, here's what happens:

1. **Scan your collection** - Read metadata from all audio files
2. **Compare with iPod** - Identify new, changed, and removed tracks
3. **Plan operations** - Determine which files need transcoding
4. **Execute** - Transcode if needed, copy files, update iPod database
5. **Finalize** - Save the database and report results

## Step 1: Preview with Dry Run

Always start with a dry run to see what will happen:

```bash
podkit sync --dry-run
```

Example output:

```
=== Sync Plan (Dry Run) ===

Source: /Users/you/Music
Device: /Volumes/IPOD
Quality: high (VBR ~256 kbps)

Collection:
  Total tracks: 1,247
  Lossless: 892 (FLAC)
  Lossy: 355 (MP3, M4A)

Changes:
  Tracks to add: 1,247
    - Transcode: 892 (FLAC → AAC)
    - Copy: 355 (already compatible)
  Tracks to remove: 0
  Already synced: 0

Estimates:
  Size: 8.2 GB
  Time: ~45 minutes
  Available space: 48.2 GB
```

### What to Look For

- **Track counts** - Do the numbers match your expectations?
- **Transcode count** - FLAC files will be transcoded to AAC
- **Size estimate** - Will everything fit on your iPod?
- **Time estimate** - Transcoding is the slowest part

## Step 2: Run the Sync

When you're ready:

```bash
podkit sync
```

With verbose output:

```bash
podkit sync -v
```

For maximum detail:

```bash
podkit sync -vvv
```

### Progress Display

During sync, you'll see:

```
Syncing 1,247 tracks...

[Transcoding] 1/892 - Artist - Album - Track Name.flac
  → AAC ~256 kbps, 4.2 MB

[Copying] 893/1,247 - Artist - Track.mp3

[====================================] 100%

Syncing complete!
  Added: 1,247
  Time: 42m 18s
```

## Step 3: Verify and Eject

After sync completes:

```bash
# Check device status
podkit device info

# List tracks on iPod
podkit device music

# Eject safely
podkit eject
```

Then disconnect your iPod and test playback!

## Quality Presets

podkit transcodes lossless files (FLAC, WAV, ALAC) to AAC. Available presets:

| Preset | Bitrate | Use Case |
|--------|---------|----------|
| `alac` | Lossless | Keep original quality (larger files) |
| `max` | ~256 kbps VBR | Highest AAC quality |
| `high` | ~192 kbps VBR | Good quality, reasonable size (default) |
| `medium` | ~128 kbps VBR | Smaller files |
| `low` | ~96 kbps VBR | Maximum compression |

Change quality via CLI or config:

```bash
podkit sync --quality medium
```

```toml
# In config.toml
[transcode]
quality = "high"
```

## Incremental Syncs

After your first sync, future syncs are much faster:

```bash
podkit sync --dry-run
```

```
Changes:
  Tracks to add: 12
  Already synced: 1,247
```

Only new tracks are processed. podkit matches tracks by artist, album, and title.

## Removing Deleted Tracks

By default, podkit only adds tracks. To remove tracks from your iPod that are no longer in your collection:

```bash
podkit sync --delete
```

Always preview with `--dry-run` first:

```bash
podkit sync --delete --dry-run
```

## Troubleshooting First Sync

### "iPod not found"

**Problem:** podkit can't detect your iPod

**Solutions:**
1. Make sure the iPod is mounted (visible in Finder/Files)
2. Check the mount point: `ls /Volumes/` (macOS) or `lsblk` (Linux)
3. Try specifying the path directly: `podkit sync --device /Volumes/IPOD`
4. On macOS with large iFlash cards, see [macOS Mounting Issues](/troubleshooting/macos-mounting)

### "Cannot read iPod database"

**Problem:** iPod is mounted but podkit can't read it

**Solutions:**
1. The iPod may need initialization:
   ```bash
   podkit device init --device /Volumes/IPOD
   ```
2. Check if the iPod_Control folder exists: `ls /Volumes/IPOD/iPod_Control/`
3. Try restoring the iPod with iTunes/Finder first

### "FFmpeg not found"

**Problem:** Sync fails because FFmpeg isn't available

**Solutions:**
1. Install FFmpeg (see [Installation](/getting-started/installation))
2. Verify it's in your PATH: `which ffmpeg`
3. Check it has AAC support: `ffmpeg -encoders 2>/dev/null | grep aac`

### Sync is slow

**Tips to speed up sync:**
1. Use `--no-artwork` to skip artwork transfer
2. Use a lower quality preset (`--quality medium`)
3. Pre-convert your files to AAC/MP3 (no transcoding needed)
4. Use a fast SD card if using iFlash

### Tracks appear corrupted on iPod

**Problem:** Tracks skip, won't play, or show wrong duration

**Solutions:**
1. Eject properly with `podkit eject` before disconnecting
2. Check the source files play correctly on your computer
3. Try re-syncing with `--delete` to remove and re-add tracks

## Getting Verbose Output

For debugging, use multiple `-v` flags:

```bash
podkit sync -v      # Verbose
podkit sync -vv     # More verbose
podkit sync -vvv    # Debug level
```

## Getting Help

```bash
podkit --help           # General help
podkit sync --help      # Sync command help
```

## Next Steps

- [Configuration](/user-guide/configuration) - Full configuration reference
- [Music Sources](/user-guide/music-sources) - Set up multiple collections or Subsonic
- [Transcoding](/user-guide/transcoding) - Quality settings and encoder options
- [Video Sync](/user-guide/video-sync) - Sync movies and TV shows
