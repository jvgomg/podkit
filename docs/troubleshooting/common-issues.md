---
title: Common Issues
description: Solutions for common podkit issues including device detection, sync errors, and audio problems.
sidebar:
  order: 1
---

# Common Issues

Solutions for frequently encountered problems with podkit.

## Device Issues

### "iPod not found" or "Device path not found"

**Symptoms:** podkit can't detect your iPod

**Solutions:**
1. Make sure the iPod is mounted (visible in Finder/Files)
2. Check the mount point: `ls /Volumes/` (macOS) or `lsblk` (Linux)
3. Try specifying the path directly: `podkit sync --device /Volumes/IPOD`
4. On macOS with large iFlash cards, see [macOS Mounting Issues](/troubleshooting/macos-mounting)

### "Cannot read iPod database"

**Symptoms:** iPod is mounted but podkit can't read it

**Solutions:**
1. The iPod may need initialization. If it's a fresh iPod or was recently restored:
   ```bash
   podkit device init --device /Volumes/IPOD
   ```
2. Check if the iPod_Control folder exists: `ls /Volumes/IPOD/iPod_Control/`
3. Try restoring the iPod with iTunes/Finder first

### "Unknown" Model Detection

**Symptoms:** podkit shows your iPod as "Unknown Generation"

**Solutions:**
1. Check if `iPod_Control/Device/SysInfo` exists on your iPod
2. If missing, create it with your model number:
   ```bash
   echo "ModelNumStr: MA147" > /Volumes/IPOD/iPod_Control/Device/SysInfo
   ```
3. See [iPod Internals](/devices/ipod-internals) for model number reference

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
