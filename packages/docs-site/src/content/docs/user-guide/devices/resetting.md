---
title: Resetting a Device
description: Reset the iPod database to fix corruption or start fresh with podkit.
sidebar:
  order: 8
---

The `podkit device reset` command performs a one-shot **factory reset**: it recreates an empty iPod database *and* wipes every audio and artwork file off the device. It's the right choice when you want to start completely fresh, or when the database itself is corrupted.

## Basic Usage

```bash
# Factory-reset the default device
podkit device reset

# Reset a specific device
podkit device reset -d classic

# Reset and give the device a new name in one step
podkit device reset --name "Party iPod"

# Preview what would happen, change nothing
podkit device reset --dry-run
```

Reset asks for confirmation before erasing anything. Pass `-y`/`--yes` to skip the prompt in scripts.

## What Reset Does

A reset performs the following, in order:

1. Reads the device's current name (so it can be preserved)
2. Recreates the iTunesDB as a fresh, empty database
3. Brute-force deletes **all** audio files under `iPod_Control/Music/` — including orphaned files that no longer belong to any track, which an ordinary [clear](/user-guide/devices/clearing) leaves behind
4. Wipes all artwork (the `.ithmb` caches and the ArtworkDB)
5. Sets the disk's volume label to match the device name

After a reset, the iPod is in a clean, empty state ready for a fresh sync. The name is preserved by default — pass `--name` to rename it at the same time (see [Renaming a Device](/user-guide/devices/renaming) for how names map to the disk label).

Reset is all-or-nothing — there are no flags to wipe only part of the device. Use [clear](/user-guide/devices/clearing) or [reset-artwork](/user-guide/devices/doctor#repairing-artwork-corruption) for partial wipes.

## When to Use Reset

- **Fresh start:** You want to completely start over with a clean sync
- **Database corruption:** The iPod shows incorrect track counts, crashes during playback, or podkit reports database errors
- **Reclaiming space:** Orphaned media files are taking up space that `clear` didn't recover
- **After firmware changes:** If you updated or restored the iPod firmware

## Reset Needs an Initialized iPod

Reset *re-sets* a device that already has an iPod database. If the device has no readable database (it's blank, was manually formatted, or is severely corrupted), reset stops and points you at `podkit device init` instead — see below.

## Reset vs Clear

| | `device reset` | `device clear` |
|---|---|---|
| **Removes tracks** | Yes | Yes |
| **Deletes audio files (incl. orphans)** | Yes | Only files it knows about |
| **Wipes artwork** | Yes | No |
| **Recreates database** | Yes | No |
| **Fixes corruption** | Yes | No |
| **Partial wipe (music only, etc.)** | No | Yes (`--type`) |
| **Use when** | You want a clean slate, or the database is broken | Just removing some or all content |

Use [clear](/user-guide/devices/clearing) if you only need to remove content. Use reset for a full factory wipe or when the database itself is the problem.

## Initializing Blank or Corrupted iPods

For iPods that have no database at all (blank filesystem or severely corrupted), use `podkit device init`:

```bash
podkit device init -d classic
```

This creates the required iPod directory structure and a fresh iTunesDB. Use this when the iPod has been manually formatted or has never been initialized.

## See Also

- [Renaming a Device](/user-guide/devices/renaming) for changing the iPod's name and disk label
- [Clearing Content](/user-guide/devices/clearing) for removing tracks without resetting the database
- [Formatting a Device](/user-guide/devices/formatting) for full filesystem formatting
- [Managing Devices](/user-guide/devices) for device configuration
