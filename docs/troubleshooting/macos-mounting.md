---
title: macOS Mounting Issues
description: Troubleshoot and fix mounting issues for large-capacity iPods using iFlash adapters on macOS.
sidebar:
  order: 2
---

Large-capacity iPods using iFlash adapters (SD card storage replacements) may fail to mount automatically on macOS. This issue was [originally documented by u/Efficient_Pattern on Reddit](https://www.reddit.com/r/IpodClassic/comments/1o6nk41/mounting_issues_workaround_with_1tb_ipodsiflash/).

## Why this happens

macOS refuses to automatically mount very large FAT32 volumes — there is an undocumented size threshold above which automounting is silently blocked. iFlash-modified iPods with large SD cards (typically 1 TB+) hit this threshold.

iFlash adapters can be identified by two signals visible without mounting the device:

- **2048-byte block size** — iFlash adapters emulate optical media sectors; standard iPod hard drives use 512-byte sectors
- **Capacity exceeds iPod Classic maximum** — original iPod Classic maximum was 160 GB; anything larger is iFlash

These signals mean that even `diskutil mount` fails — it uses the same macOS automount machinery. Only `mount -t msdos` (which requires root) bypasses the restriction.

## Symptoms

- iPod appears in Finder's sidebar but shows an infinite spinning wheel
- Disk volume does not mount
- iPod does not appear in Music app
- `diskutil list` shows the device but it is not accessible

## Using `podkit device add`

When you run `podkit device add <name>` without specifying a path, podkit scans for both mounted and unmounted devices. If it finds an unmounted iFlash device, it assesses it and explains what it found before attempting to mount:

```
Scanning for attached iPods...

Found iPod: TERAPOD (1.0 TB) — not mounted
  Model:   iPod Classic 6th generation
  Storage: iFlash confirmed — 2048-byte block size; Capacity exceeds iPod Classic maximum

Attempting to mount...
macOS cannot automatically mount this device.

iFlash confirmed by:
  • 2048-byte block size: 2048
    iFlash adapters emulate optical media sectors; standard iPod HDDs use 512-byte sectors
  • Capacity exceeds iPod Classic maximum: 1.0 TB
    Original iPod Classic maximum was 160 GB

macOS refuses to mount large FAT32 volumes through its normal mechanisms.
Elevated privileges are required to mount this device directly.

Run:  sudo podkit device add myipod
```

Re-run with `sudo` to mount and register the device in one step:

```bash
sudo podkit device add myipod
```

Once the device is registered, use `podkit mount` for subsequent mounts (see below).

## Using `podkit device mount`

After the device is registered with podkit, mount it again after reconnecting:

```bash
podkit device mount
# or for a named device
podkit device mount myipod
```

For iFlash devices, this command also requires `sudo`:

```bash
sudo podkit device mount myipod
```

podkit identifies the device by its stored `volumeUuid`, finds the disk identifier, and runs the appropriate mount command.

## Manual Workaround

If you prefer to mount without podkit, or need to do it before registering:

### 1. Find the disk identifier

```bash
diskutil list
```

Look for your iPod — it will show as `DOS_FAT_32` with a name like "IPOD":

```
/dev/disk4 (external, physical):
   #:                       TYPE NAME                    SIZE       IDENTIFIER
   0:     FDisk_partition_scheme                        *1.0 TB     disk4
   1:                 DOS_FAT_32 IPOD                    1.0 TB     disk4s2
```

Note the identifier (e.g., `disk4s2`).

### 2. Mount manually

```bash
sudo mkdir -p /Volumes/iPod
sudo mount -t msdos /dev/disk4s2 /Volumes/iPod
```

Replace `disk4s2` with your actual identifier and `iPod` with your preferred mount name.

### 3. Verify the mount

```bash
ls /Volumes/iPod/iPod_Control
```

You should see: `Artwork`, `Device`, `iTunes`, `Music`

## Convenience Alias

Add this to your `~/.zshrc` (or `~/.bashrc`) to auto-detect and mount the iPod without podkit:

```bash
alias ipod='dev=$(diskutil list | awk "/IPOD/ && /disk[0-9]+s[0-9]+/ {print \$NF; exit}"); [ -n "$dev" ] && sudo mkdir -p /Volumes/iPod && sudo mount -t msdos /dev/$dev /Volumes/iPod || echo "iPod volume not found"'
```

Adjust the `IPOD` pattern to match your iPod's volume name.

## Hidden Files in Finder

The `iPod_Control` folder is hidden by default. To see it in Finder:

- Press `Cmd + Shift + .` to toggle hidden files, or
- Run `chflags nohidden /Volumes/iPod/iPod_Control`

## Ejecting

Unmount before disconnecting:

```bash
podkit device eject
```

Or manually:

```bash
diskutil unmount /Volumes/iPod
```

Note: `sudo umount` often fails with "Resource busy" on macOS. Use `diskutil unmount` instead.

## See Also

- [Mounting and Ejecting](/user-guide/devices/mounting-ejecting) — full mount/eject reference
- [Adding a Device](/user-guide/devices/adding-devices) — registering devices
- [Supported Devices](/devices/supported-devices) — device compatibility
