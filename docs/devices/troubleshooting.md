---
title: Troubleshooting iPod detection
description: What to do when podkit doesn't see your iPod, or reports no mountable partition.
sidebar:
  order: 4
---

This page covers two specific failure modes you can hit during `podkit device scan`. For broader detection / sync issues, see [Common Issues](/troubleshooting/common-issues/).

## podkit doesn't see my iPod

If `podkit device scan` reports no devices but your iPod is plugged in:

1. **Check that the iPod is in disk mode.** On classic iPods, this happens automatically when connected via USB; on iOS-based iPods (iPod touch, etc.) podkit cannot sync — those use Apple's proprietary sync protocol and are out of scope.
2. **Check for a mountable filesystem.** On macOS, the iPod should appear in Finder; on Linux, `lsblk` should list a partition under the device. If the partition is HFS+ on Linux, podkit refuses it (read-only HFS+ on Linux is not safe to write to). See [iPod filesystems on Linux](/devices/) for the full compatibility matrix.
3. **Try a different cable.** Old 30-pin and Lightning-to-USB cables can intermittently fail to negotiate disk mode.
4. **Verify the iPod boots.** A device with a failed hard drive may enumerate over USB but never present a disk; the readiness check will surface this as a partition-table failure.

If the device still doesn't appear, run `podkit device scan --report` and attach the output when filing a bug.

## podkit reports no mountable partition

`podkit device scan` may report:

```
No mountable partition detected — see: https://jvgomg.github.io/podkit/devices/troubleshooting
```

This means podkit recognised the device over USB (Apple vendor ID + iPod product ID), but no block-device partition was found. Possible causes:

- The iPod has been wiped or restored to an uninitialised state.
- The partition table is corrupt or unreadable.
- The hard drive is failing or has died.

**podkit does not restore, format, or partition iPods.** Restoring an iPod is non-trivial — the partition layout, filesystem type, and boot-area bytes vary by generation, and getting any of them wrong can leave the device unbootable. The right tool for this is one of:

- **iPod Reset Utility** (macOS / Windows) — Apple's official restore tool inside the iTunes / Apple Devices app. The most reliable option for stock iPods.
- **[Rockbox utility](https://www.rockbox.org/wiki/RockboxUtility)** — restores stock firmware on supported iPods and optionally installs Rockbox alongside it.
- **`mkfs.vfat` after partitioning with `parted` / `gparted`** (Linux) — for advanced users who already know which scheme (MBR vs APM) and filesystem (FAT32 vs HFS+) the target generation expects. See [iPod profile](/devices/) for the matrix.

After restoring, plug the iPod back in and run `podkit device scan` again — it should now show the device as ready. If you intend to use the device as a podkit target, run `podkit device add` to register it, then `podkit device init` if needed to write the empty database.

## podkit won't sync — "Could not identify this iPod model"

`podkit sync` may stop before transferring anything with:

```
Could not identify this iPod model from its on-disk identity.
```

podkit needs to know exactly which iPod it's writing to — the model determines
the artwork format and database layout. When it can't resolve the model from the
files on the device, it **refuses to sync** rather than guessing and risking the
wrong artwork format or a corrupt database. (Earlier versions silently treated
an unidentified iPod as a "generic" one and synced anyway; that footgun is gone.)

This happens when the iPod's authoritative identity file (SysInfoExtended) is
missing — typically an iPod that was wiped, restored, or never set up with
podkit. The fix is a **one-time setup** that writes the identity; afterwards
every sync works from the mounted volume alone, with no USB needed:

- **Set the iPod up over USB once:** connect the iPod and run `podkit device add`.
  In Docker, pass the USB device through for this one command — later syncs need
  only the volume mount.
- **Or repair the identity in place:** run
  `podkit doctor -d <name|path> --repair sysinfo-extended`, which reads the
  model from the device firmware and writes the identity file (repair always
  requires an explicit `-d`).

After either step, `podkit sync` resolves the model and proceeds normally. The
same refusal applies to the background daemon — it skips an unidentified device
and tells you to set it up rather than mangling it.

## See also

- [Common Issues](/troubleshooting/common-issues/) — broader sync, mounting, and detection issues
- [Supported Devices](/devices/supported-devices/) — full compatibility table
- [Device Readiness Levels](/reference/cli-commands/#device-readiness-levels) — what each readiness state means
