---
title: Clearing Content
description: Remove tracks and other content from iPod devices with podkit.
sidebar:
  order: 7
---

The `podkit device clear` command removes content from an iPod without recreating the database. Use this when you want to remove tracks but keep the iPod database intact.

## Basic Usage

```bash
# Clear all content from the default device
podkit device clear

# Clear a specific device
podkit device clear -d classic
```

## Clearing Specific Content Types

You can target specific content types:

```bash
# Clear only music tracks
podkit device clear --type music

# Clear only video content
podkit device clear --type video

# Clear all content (default)
podkit device clear --type all
```

| Type | What Gets Removed |
|------|-------------------|
| `music` | Audio tracks and associated artwork |
| `video` | Video files |
| `all` | All tracks and media files |

## Previewing with Dry Run

Preview what would be removed before committing:

```bash
podkit device clear --dry-run
```

This lists the tracks that would be deleted without actually removing anything.

## Skipping Confirmation

By default, podkit asks for confirmation before clearing. To skip the prompt (useful for scripts):

```bash
podkit device clear --yes
```

## Clear vs Reset

| | `device clear` | `device reset` |
|---|---|---|
| **Removes tracks** | Yes | Yes |
| **Partial wipe (`--type music`/`video`)** | Yes | No (all-or-nothing) |
| **Deletes orphaned audio files** | No | Yes |
| **Wipes artwork** | No | Yes |
| **Recreates database** | No | Yes |
| **Use when** | Removing some or all content | A full factory wipe, or the database is corrupted |

If you just want to remove tracks and re-sync, use `clear`. For a complete factory wipe — empty database, every audio and artwork file gone — use [reset](/user-guide/devices/resetting) instead.

## See Also

- [Resetting a Device](/user-guide/devices/resetting) for recreating the database
- [Managing Devices](/user-guide/devices) for device configuration
