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

### `[bitrate].sync` key rejected on startup

**Symptoms:** podkit reports a config error: `[bitrate].sync is not a valid key`.

**Cause:** The `[bitrate].sync` config key (which used to accept `match-cap`, `match-all`, `up-only`, `down-only`, `off`) has been replaced by `[bitrate].reduce` (`auto`, `always`, `never`). The old key is no longer accepted.

**Solution:** Replace the old block with the new one in your config file:

```toml
# Before (no longer valid):
[bitrate]
sync = "match-cap"
toleranceUp = 0.1
toleranceDown = 0.1

# After:
[bitrate]
reduce = "auto"    # auto | always | never
tolerance = 0.25   # source-proximity tolerance (fraction of cap)
```

The default (`auto`) follows the transfer mode: `optimized` converts (reduces over-cap lossy sources); `fast` and `portable` preserve (copy device-native lossy as-is). For the same behaviour as the old `match-cap`, set `reduce = "always"`. See [Lossy Reduction](/reference/config-file#lossy-reduction) for the full reference.

### Raised the quality cap but lossy tracks didn't get re-encoded up

**Symptoms:** You raised your quality preset (e.g., from `medium` to `high`), but MP3/AAC tracks that were previously reduced to the old cap stayed at their smaller bitrate.

**Cause:** Lossy reduction is **down-only**. Re-encoding a lossy track up cannot recover discarded information, so podkit never does it automatically. When you raise the cap, previously-reduced tracks sit below the new target and are surfaced as a `below-cap` report:

```
N tracks below your quality target — re-sync with --force-transcode to lift them
```

**Solution:** If you want to re-encode those tracks up to the new cap, run:

```bash
podkit sync --force-transcode
```

This re-encodes all lossless-source tracks (and lifts any `below-cap` lossy tracks to the cap). Preview with `--dry-run` first. Play counts, ratings, and playlist membership are preserved.

### Tracks keep re-transcoding on every sync

**Symptoms:** Some tracks are re-transcoded every time you sync, even though nothing has changed.

**Cause:** For lossless-source tracks, if a sync tag is missing, podkit falls back to a bitrate comparison which can produce false positives with VBR encoding. For lossy tracks, if the add-path tolerance is tight, a source with a bitrate slightly above the cap gets reduced on every add.

**Solutions:**

1. **Write sync tags (recommended).** Sync tags store the exact preset used for each track, eliminating bitrate-based false positives entirely:
   ```bash
   podkit sync --force-sync-tags
   ```
   This tags all existing tracks with your current preset info. Future syncs use exact comparison for tagged tracks. See [Track Upgrades — Sync Tags](/user-guide/syncing/upgrades#sync-tags) for details.
2. **Increase the source-proximity tolerance** (for lossy tracks cycling near the cap):
   ```toml
   [bitrate]
   tolerance = 0.30    # only reduce when source exceeds cap by more than 30%
   ```
3. **Switch to CBR encoding.** CBR produces stable bitrates that don't trigger false positives on lossless tracks:
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

**Cause:** Encoding-mode detection is exact for lossless-source tracks that carry a sync tag — podkit compares the recorded encoding mode against the current target. For tagged tracks, any change triggers a re-encode. For untagged lossless tracks (synced before sync tags existed), podkit uses a bitrate comparison, which may not catch every track.

Lossy tracks (MP3, AAC) are **never** re-encoded for an encoding-mode change — a CBR/VBR flip on a lossy source is a lossy→lossy degradation that can grow the file with no quality benefit. The mode change applies to future adds only.

**If you need every lossless-source track re-encoded**, use `--force-transcode`:

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

**Symptoms:** Device storage is fuller than expected, or `podkit doctor` reports orphan files.

**Cause:** If a sync was force-quit (double Ctrl+C), crashed, or the device was disconnected mid-sync, audio files may have been copied without being registered in the database (iPod) or the `.podkit/state.json` manifest (mass-storage). These orphaned files waste storage space but don't cause corruption.

**Solution:** Run `podkit doctor` to detect orphans, then `--repair orphan-files` to remove them. The same flag works on iPod and mass-storage devices — doctor dispatches the right walker based on the connected device:

```bash
# iPod (default device)
podkit doctor --repair orphan-files

# Mass-storage (Echo Mini, Rockbox, generic DAPs)
podkit doctor -d mydevice --repair orphan-files
```

Add `--dry-run` to preview the file list before deleting anything.

**For incomplete-write residue (the `.podkit-tmp` leftover from a SIGKILLed sync), you typically don't need to run anything manually** — every `podkit sync` now sweeps these at start (you'll see a `Cleaning N incomplete-write files...` line). doctor is the backstop if a device isn't being synced or the sweep itself failed.

A single Ctrl+C during sync triggers a graceful shutdown that saves all completed work — orphaned files only occur from force-quit, crashes, or disconnection. See [iPod Health Checks](/user-guide/devices/doctor#repairing-orphan-files) for details.

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
