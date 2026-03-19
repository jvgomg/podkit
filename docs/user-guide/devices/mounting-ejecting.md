---
title: Mounting and Ejecting
description: Mount and safely eject iPod devices with podkit on macOS and Linux, including how iFlash devices are handled.
sidebar:
  order: 5
---

Mounting makes an iPod's filesystem accessible so podkit can read and write to it. Ejecting flushes pending writes and unmounts the volume safely before you disconnect the cable.

## When mounting is handled automatically

In most cases you don't need to think about mounting. When you run `podkit sync`, podkit expects the device to already be mounted. macOS mounts standard iPods automatically when you plug them in.

For iFlash-modified iPods (SD card storage replacements), macOS may refuse to automount the volume. In that case, `podkit device add` will detect this and guide you through mounting — see [Adding a Device](/user-guide/devices/adding-devices) and the [macOS Mounting Troubleshooting](/troubleshooting/macos-mounting/) guide.

---

## macOS

### Mounting a registered device

If a registered device is not mounted (e.g. you dismissed the macOS dialog, or it's an iFlash device you've mounted before), you can mount it with:

```bash
# Mount the default device
podkit device mount

# Mount a specific device
podkit device mount -d classic
```

podkit identifies the device by its `volumeUuid` and mounts it to the expected mount point.

### Ejecting

Always eject your iPod before disconnecting the cable to avoid database corruption:

```bash
# Eject the default device
podkit device eject

# Eject a specific device
podkit device eject -d nano
```

`unmount` is an alias for `eject` — `podkit unmount` and `podkit device unmount` work identically.

Ejecting flushes all pending writes and unmounts the volume.

### Auto-eject after sync

Use `--eject` to automatically eject the device when a sync completes:

```bash
podkit sync --eject
podkit sync --device nano --eject
```

This is convenient for a plug-sync-unplug workflow.

### iFlash devices

iFlash-modified iPods use SD cards in place of the original hard drive. macOS refuses to automatically mount large FAT32 volumes above an undocumented size threshold, so these devices often don't mount on their own.

When you run `podkit device add -d myipod` without specifying a path, podkit scans for both mounted and unmounted devices. If it finds an unmounted iFlash device, it will:

1. Assess the device (block size, capacity, USB model) before attempting anything
2. Show you what it found
3. Attempt `diskutil mount` (works for normal unmounted devices)
4. If that fails, explain why and tell you to re-run with `sudo`

```
Found iPod: TERAPOD (1.0 TB) — not mounted
  Model:   iPod Classic 5th generation
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

Run:  sudo podkit device add -d myipod
```

Re-running with `sudo` uses `mount -t msdos` directly, which bypasses macOS's automount restrictions.

For the full iFlash troubleshooting guide — including manual workarounds and a shell alias — see [macOS Mounting Troubleshooting](/troubleshooting/macos-mounting/).

---

## Linux

podkit supports mounting and ejecting iPods on Linux (Debian, Ubuntu, Alpine, and other distributions).

### Automatic Mount

```bash
podkit mount
```

podkit tries the best available method:

1. **udisks2** (if installed) — mounts without root via `udisksctl mount`. The mount point is chosen by udisks2 (typically `/media/$USER/LABEL`).
2. **Manual mount** — falls back to `mount -t vfat`, which requires root. podkit will prompt you to re-run with `sudo`.

The default mount point for manual mounts is `/tmp/podkit-{volumeName}`. Override it with `--mount-point`:

```bash
podkit mount --mount-point /mnt/ipod
```

### Eject

```bash
podkit eject
podkit eject --force   # Lazy unmount if device is busy
```

Like mounting, eject tries `udisksctl unmount` first, falling back to `umount`. The `--force` flag uses `umount -l` (lazy unmount) which detaches even if files are open.

### Manual Commands

If you prefer to use system tools directly:

```bash
# Find your device
lsblk -o NAME,UUID,LABEL,FSTYPE,SIZE,MOUNTPOINT

# Mount (with udisks2, no root needed)
udisksctl mount -b /dev/sdX1

# Mount (without udisks2, requires root)
sudo mount -t vfat /dev/sdX1 /tmp/podkit-ipod

# Unmount
udisksctl unmount -b /dev/sdX1
# or
sudo umount /mnt/ipod
```

### Requirements

- **`lsblk`** (from `util-linux`) is required for device detection. It's pre-installed on Debian/Ubuntu. On Alpine: `apk add util-linux`.
- **`udisks2`** is optional but recommended for unprivileged mount/eject. Install with `apt install udisks2` (Debian) or `apk add udisks2` (Alpine).

---

## See Also

- [Adding a Device](/user-guide/devices/adding-devices) — register devices, including iFlash auto-detection
- [macOS Mounting Troubleshooting](/troubleshooting/macos-mounting/) — iFlash devices, manual workarounds
- [Managing Devices](/user-guide/devices) — working with multiple devices
