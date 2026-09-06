---
title: Renaming a Device
description: Rename an iPod — change the name it shows on screen and the disk label your computer sees.
sidebar:
  order: 9
---

The `podkit device rename` command changes your iPod's name. An iPod's name actually lives in **two** places, and rename keeps them in sync:

- **The iPod database name** — the case-correct name the iPod firmware shows on screen (e.g. `Party iPod`).
- **The OS volume label** — the name your computer's file manager shows for the disk (e.g. `PARTY IPOD` in Finder or Explorer).

By default, rename writes both.

## Basic Usage

```bash
# Rename the default device (updates the iPod name and the disk label)
podkit device rename "Party iPod"

# Rename a specific device
podkit device rename "Party iPod" -d classic
```

Rename asks for confirmation before making changes. Pass `-y`/`--yes` to skip the prompt.

## The Disk Label Is Lossy on FAT iPods

Most iPods are formatted as **FAT32**, whose volume labels have hard limits: they are **uppercased** and **truncated to 11 characters**. So renaming a FAT iPod to `Party iPod` sets:

- iPod database name → `Party iPod` (exactly as typed)
- disk label → `PARTY IPOD` (uppercased)

Rename always prints the disk label it set, so you can see exactly what it became. It only adds a *warning* when the label had to drop information — when the name was longer than 11 characters or contained characters a FAT label can't hold. A plain case change (like `Party iPod` → `PARTY IPOD`) is expected and isn't flagged. HFS+ iPods (some older classics) preserve case and allow longer labels, so this lossiness doesn't apply there.

This is why the two names sometimes look slightly different — it's expected.

## Renaming Only One Layer

You usually want both, but you can target a single layer:

```bash
# Change only the iPod's displayed name, leave the disk label untouched
podkit device rename "Party iPod" --no-disk

# Relabel only the disk, leave the iPod's database name untouched
podkit device rename "Party iPod" --no-database
```

`--no-disk` is also the remount-free path: changing the disk label moves the device's mount point, while a database-only rename does not.

Passing both `--no-disk` and `--no-database` does nothing, so podkit rejects it with an error.

## Your Configuration Stays Valid

If the device is in your podkit config, its cached name and path are refreshed automatically after a rename — matching is keyed on the device's volume UUID, which a relabel does not change. Your `-d` alias (e.g. `-d classic`) is **not** changed; you keep using the same alias as before. If you're running without a config (for example in Docker), rename still works and simply skips the config update.

## Naming a Brand-New iPod

Rename changes the name of an iPod that's already set up. To name a device while initializing it for the first time, use [`device init --name`](/user-guide/devices/resetting#reset-needs-an-initialized-ipod) instead. To rename while wiping a device clean, [`device reset --name`](/user-guide/devices/resetting) does both at once.

## See Also

- [Resetting a Device](/user-guide/devices/resetting) for a factory wipe (optionally with a new name)
- [Managing Devices](/user-guide/devices) for device configuration and aliases
