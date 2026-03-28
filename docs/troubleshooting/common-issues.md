---
title: Common Issues
description: Solutions for common podkit issues including device detection, sync errors, and audio problems.
sidebar:
  order: 1
---

Solutions for frequently encountered problems with podkit.

## Device Issues

### Diagnosing device problems

If something isn't working, start with `podkit device scan`. It runs a full readiness check and tells you exactly where the problem is:

```bash
podkit device scan
```

Each of the six stages (USB Connection, Partition Table, Filesystem, Mounted, SysInfo, Database) is shown with a ✓ or ✗. The readiness level at the end tells you what to do next. See [Device Readiness Levels](/reference/cli-commands#device-readiness-levels) for the full reference.

To generate a report you can share for support:

```bash
podkit device scan --report
```

### "iPod not found" or "Device path not found"

**Symptoms:** podkit can't detect your iPod

**Solutions:**
1. Make sure the iPod is mounted (visible in Finder/Files)
2. Run `podkit device scan` to check if podkit can see the iPod
3. Check the mount point: `ls /Volumes/` (macOS) or `lsblk` (Linux)
4. Try specifying the path directly: `podkit sync --device /Volumes/IPOD`
5. If the device is detected but not mounted, run `podkit device scan --mount` to auto-mount it
6. On macOS with large iFlash cards, see [macOS Mounting Issues](/troubleshooting/macos-mounting)

### "Cannot read iPod database"

**Symptoms:** iPod is mounted but podkit can't read it

**Solutions:**
1. Run `podkit device scan` — it will show a readiness level and suggest the correct action
2. If the device needs initialization (`Needs init`):
   ```bash
   podkit device init
   ```
3. If the database is corrupt (`Needs repair`):
   ```bash
   podkit device reset
   ```
4. Check if the iPod_Control folder exists: `ls /Volumes/IPOD/iPod_Control/`
5. Try restoring the iPod with iTunes/Finder first

### "Unknown" Model Detection

**Symptoms:** podkit shows your iPod as "Unknown Generation"

**Solutions:**
1. Check if `iPod_Control/Device/SysInfo` exists on your iPod
2. If missing, create it with your model number:
   ```bash
   echo "ModelNumStr: MA147" > /Volumes/IPOD/iPod_Control/Device/SysInfo
   ```
3. See [iPod Internals](/devices/ipod-internals) for model number reference

### USB / communication errors

If `podkit device scan` shows a hardware error, or you see errno codes in verbose output:

| Error code | Meaning | What to try |
|-----------|---------|------------|
| errno 71 (EPROTO) | Communication protocol failure | Reconnect the device; try a different cable or USB port |
| errno 13 (EACCES) | Permission denied | Run with `sudo`, or check that your user has access to the device |
| errno 19 (ENODEV) | Device not found | Device may have disconnected during the command; reconnect and retry |
| errno 5 (EIO) | I/O error | Possible hardware or cable fault; try a different cable |

For EPROTO errors specifically: unplug the iPod, wait a few seconds, then reconnect. If the error persists on multiple cables and ports, the device connector may need cleaning.

## Dependency Issues

### "FFmpeg not found"

**Symptoms:** Sync fails because FFmpeg isn't available

**Solutions:**
1. Install FFmpeg:
   - macOS: `brew install ffmpeg`
   - Ubuntu: `sudo apt install ffmpeg`
   - Fedora: `sudo dnf install ffmpeg`
2. Verify it's in your PATH: `which ffmpeg`
3. Check it has AAC support: `ffmpeg -encoders 2>/dev/null | grep aac`

### "Failed to load libgpod" or "Library not found"

**Symptoms:** podkit can't load the libgpod library

**Solutions:**
1. Verify libgpod is installed: `pkg-config --modversion libgpod-1.0`
2. On macOS, ensure environment variables are set:
   ```bash
   export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
   export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
   ```
3. Try rebuilding: `cd tools/libgpod-macos && ./build.sh`

## Sync Issues

### Tracks keep re-transcoding on every sync

**Symptoms:** Some tracks are re-transcoded every time you sync, even though nothing has changed.

**Cause:** VBR encoding produces content-dependent bitrates that can vary from the preset's target. When the actual bitrate falls outside the detection tolerance, podkit thinks the preset has changed and re-transcodes the track. The new transcode produces a similarly variable bitrate, creating a cycle.

**Solutions:**

1. **Write sync tags (recommended).** Sync tags store the exact preset used for each track, eliminating bitrate-based false positives entirely:
   ```bash
   podkit sync --force-sync-tags
   ```
   This tags all existing tracks with your current preset info. Future syncs use exact comparison for tagged tracks. See [Track Upgrades — Sync Tags](/user-guide/syncing/upgrades#sync-tags) for details.
2. **Increase the tolerance.** The default VBR tolerance is 30%. You can raise it in your config:
   ```toml
   bitrateTolerance = 0.4  # 40% tolerance
   ```
3. **Switch to CBR encoding.** CBR produces stable bitrates that don't trigger false positives:
   ```toml
   encoding = "cbr"
   ```
4. **Accept some re-transcoding.** With VBR, a small number of tracks may be re-transcoded on each sync. This is inherent to VBR encoding and does not affect audio quality.

To force re-transcoding of all lossless-source tracks (e.g., after changing presets or encoding mode), use `--force-transcode`:

```bash
podkit sync --force-transcode
```

This preserves play counts, ratings, and playlist membership. Preview with `--dry-run` first.

### Not all tracks re-transcoded after switching encoding mode

**Symptoms:** You switched from VBR to CBR (or vice versa) at the same quality preset, but only some tracks were re-transcoded.

**Cause:** The iPod database stores a track's bitrate but not how it was encoded. podkit detects changes by comparing the stored bitrate against the current preset target. When switching VBR to CBR, the tighter CBR tolerance catches tracks whose VBR bitrate landed far from the target, but tracks that are already close are left alone. When switching CBR to VBR, existing tracks at the exact target bitrate are well within VBR tolerance and are left as-is.

This is expected behaviour — tracks left alone are already at the right quality. New tracks added in future syncs will use the new encoding mode.

**If you need every track re-encoded**, use `--force-transcode`:

```bash
podkit sync --force-transcode
```

### Sync is slow

**Tips to speed up sync:**
1. Use `--no-artwork` to skip artwork transfer
2. Use a lower quality preset (`--quality medium`)
3. Pre-convert your files to AAC/MP3 (no transcoding needed)
4. Use a fast SD card if using iFlash
5. Ensure your source drive is fast (avoid network drives for large syncs)

### Tracks appear corrupted on iPod

**Symptoms:** Tracks skip, won't play, or show wrong duration

**Solutions:**
1. Eject properly with `podkit eject` before disconnecting
2. Check the source files play correctly on your computer
3. Try re-syncing with `--delete` to remove and re-add tracks
4. Check the iPod's filesystem for errors (see below)

### Artwork showing wrong album or glitched images

**Symptoms:** Tracks display artwork from a different album, or artwork appears corrupted

**Cause:** The iPod's artwork database has become out of sync with the thumbnail data files. This is a common issue across all iPod management software (including iTunes), usually triggered by disconnecting the iPod before all data is flushed.

**Solution:** Run `podkit doctor` to diagnose. You can either reset artwork quickly with `podkit doctor --repair artwork-reset` (no source collection needed) or rebuild from source with `podkit doctor --repair artwork-rebuild -c <collection>`. See [iPod Health Checks](/user-guide/devices/doctor#repairing-artwork-corruption) for details.

### Artwork not displaying

**Symptoms:** Album art doesn't appear on iPod

**Solutions:**
1. Ensure `SysInfo` file exists (needed for artwork format detection)
2. Check `iPod_Control/Artwork/` directory exists
3. Try syncing again - artwork is generated during database write
4. Some very old iPods have limited artwork support

### Duplicate tracks appearing

**Symptoms:** Same track appears multiple times on iPod

**Solutions:**
1. Check your source for actual duplicates
2. Sync with `--delete` to clean up orphaned tracks
3. Verify tracks have consistent metadata (artist/album/title)

### Orphaned files after interrupted sync

**Symptoms:** iPod storage is fuller than expected, or `podkit doctor` reports orphan files.

**Cause:** If a sync was force-quit (double Ctrl+C), crashed, or the iPod was disconnected mid-sync, audio files may have been copied to the iPod without being registered in the database. These orphaned files waste storage space but don't cause corruption.

**Solution:** Run `podkit doctor` to detect orphans, then `podkit doctor --repair orphan-files` to remove them. A single Ctrl+C during sync triggers a graceful shutdown that saves all completed work — orphaned files only occur from force-quit, crashes, or disconnection. See [iPod Health Checks](/user-guide/devices/doctor#repairing-orphan-files) for details.

## Database Issues

### Database corruption

**Symptoms:**
- iPod shows "No Music"
- Tracks missing after sync
- iPod freezes when browsing

**Solutions:**
```bash
# Backup existing database
cp /Volumes/IPOD/iPod_Control/iTunes/iTunesDB ~/iTunesDB.bak

# Remove and re-sync
rm /Volumes/IPOD/iPod_Control/iTunes/iTunesDB

# Re-initialize and sync
podkit device init --device /Volumes/IPOD
podkit sync
```

### Filesystem errors

**Solutions:**
```bash
# Check filesystem (macOS - must be unmounted)
diskutil verifyVolume /Volumes/IPOD

# Check filesystem (Linux - must be unmounted)
sudo fsck.vfat -n /dev/sdX1

# Repair if needed (Linux)
sudo fsck.vfat -a /dev/sdX1
```

## Getting More Information

### Verbose output

For debugging, use multiple `-v` flags:

```bash
podkit sync -v      # Verbose
podkit sync -vv     # More verbose
podkit sync -vvv    # Debug level
```

### Check device info

```bash
podkit device info
podkit device info --format json
```

### Getting help

```bash
podkit --help           # General help
podkit sync --help      # Sync command help
podkit device --help    # Device command help
```

## See Also

- [macOS Mounting Issues](/troubleshooting/macos-mounting) - iFlash mounting problems
- [Supported Devices](/devices/supported-devices) - Device compatibility
- [iPod Internals](/devices/ipod-internals) - Technical details
- [Device Readiness Levels](/reference/cli-commands#device-readiness-levels) - What each readiness level means and how to resolve it
- [iPod Health Checks](/user-guide/devices/doctor) - Using `podkit doctor` for database diagnostics
