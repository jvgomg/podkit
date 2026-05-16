---
title: Linux Filesystems
description: Which iPod filesystems podkit supports on Linux, why HFS+ is refused, and how to reformat to FAT32.
sidebar:
  order: 4
---

podkit supports two filesystems on iPods: **FAT32** (Windows-formatted) and **HFS+** (Mac-formatted). Both work on macOS. **On Linux, only FAT32 is supported.** HFS+ iPods are refused at `podkit device add` and flagged with a warning at `podkit device scan`.

This page explains why HFS+ is unsupported on Linux and how to reformat your iPod to FAT32 if you want to manage it from Linux.

## What podkit does on each platform

| Platform | FAT32 | HFS+ |
|----------|-------|------|
| **macOS** | Supported | Supported |
| **Linux** | Supported | **Not supported** — refused at `device add`, warned at `device scan` |

On Linux, running `podkit device add` against an HFS+ iPod produces a clear refusal:

```
Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.

To use this iPod with podkit on Linux, reformat it to FAT32. See:
  https://docs.podkit.app/devices/linux-filesystems

(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)
```

`podkit device scan` still surfaces the device so you can see it's connected, but the readiness pipeline short-circuits with the same warning instead of running the usual checks.

## Why HFS+ doesn't work on Linux

This is a Linux-platform limitation, not a podkit decision in isolation. Three independent friction points stack up, and there is no way to fix any one of them in user space:

1. **The kernel hfsplus driver is read-only on journaled volumes.** Apple's iPod restore process formats HFS+ with the journal enabled by default. The Linux kernel refuses read-write mounts on journaled HFS+ volumes for safety, so any podkit sync would fail at the first write.
2. **udev/blkid don't surface a filesystem UUID for HFS+ on Linux.** podkit identifies devices across replug by their `volumeUuid` — the value `lsblk -o UUID` reports. For HFS+ partitions on Linux that field is blank, so podkit cannot reliably re-find the same device after disconnecting and reconnecting it.
3. **udisksctl mounts HFS+ volumes at a generic path.** With no readable label, udisksctl falls back to `/media/$USER/disk` instead of the iPod's volume name. This makes disambiguation between multiple connected iPods difficult.

Each of these has a partial workaround (turn off journaling, use a synthetic UUID, prompt for a label). Together they make HFS+ on Linux a second-class experience no matter how much podkit patches around them. Refusing cleanly with a clear pointer to FAT32 is structurally simpler and sharpens podkit's Linux story to **"FAT32 iPods, supported well."**

macOS does not have any of these limitations because the OS-level HFS+ stack is the canonical implementation. macOS users see no change.

## How to reformat to FAT32

Reformatting an iPod erases all music and settings on the device. Sync your library elsewhere first if you want to keep it.

The iPod itself doesn't include a "reformat" UI — you do this from a connected computer. Three options, all outside podkit's scope to walk through end-to-end:

- **iPod Reset Utility** (Apple) — official Windows/macOS tool. The simplest path if you have access to either OS. Boots the iPod into recovery mode and re-creates the FAT32 partition layout Apple ships from the factory.
- **Rockbox Utility** — if you intend to also install Rockbox firmware, the Rockbox utility can format the iPod's data partition as FAT32 as part of the install. See [Rockbox Compatibility](/devices/rockbox).
- **`mkfs.vfat` after manual partitioning** — for users comfortable with `parted` and `mkfs.vfat`, you can re-create the iPod's two-partition layout by hand on Linux. Apple's iPods ship with a small firmware partition (HFS+ on Mac iPods, FAT16 on Windows iPods) followed by the music partition. Recreating the firmware partition layout is fragile across iPod generations and is not recommended unless you've done it before.

Once the iPod is reformatted as FAT32, run `podkit device add -d <name> --path <mount>` again on Linux and the refusal will not fire. The same iPod will continue to work on macOS; FAT32 is fully supported there too.

## Related

- [Supported Devices](/devices/supported-devices) — full device + capability matrix
- [Rockbox Compatibility](/devices/rockbox) — folder-based sync for Rockbox-flashed iPods
