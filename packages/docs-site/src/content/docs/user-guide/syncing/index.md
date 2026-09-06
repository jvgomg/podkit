---
title: Syncing
description: How podkit syncs your music and video collections to your device.
sidebar:
  order: 1
---

Syncing is the core of podkit — it gets your media from your collections onto your device. This section covers how syncing works and the types of media you can sync.

## How Sync Works

When you run `podkit sync`, podkit:

1. **Scans your collections** — Reads metadata from all audio and video files
2. **Reads your device** — Checks what's already on the device
3. **Compares** — Identifies new, changed, and removed tracks
4. **Plans** — Determines what needs transcoding vs direct copy
5. **Executes** — Transcodes, copies, and updates the device

Progress is saved periodically during sync, so you can safely cancel with Ctrl+C at any time — completed tracks are preserved and your device stays consistent.

## Basic Usage

```bash
# Sync everything (music + video)
podkit sync

# Sync only music
podkit sync -t music

# Sync only video
podkit sync -t video

# Sync a specific collection
podkit sync -t music -c main

# Sync to a specific device (by name or mount path)
podkit sync -d nano
podkit sync -d /Volumes/NANO
```

## Preview with Dry Run

Always preview before syncing to see what podkit will do:

```bash
podkit sync --dry-run
```

This shows track counts, what needs transcoding, estimated size, and available space — without writing anything to your device.

## Incremental Syncs

After your first sync, future syncs are fast. podkit matches tracks by artist, album, and title — only new or changed tracks are processed. Re-syncing a large library takes seconds, not hours.

## Removing Deleted Tracks

By default, podkit only adds tracks. To also remove tracks from your device that are no longer in your collections:

```bash
podkit sync --delete --dry-run   # Preview first
podkit sync --delete             # Then do it
```

## Auto-Eject

Combine sync and eject in one step:

```bash
podkit sync --eject
```

## What Can You Sync?

podkit supports two categories of media, each with their own supported content types:

| Category | Supported | Not Yet Supported |
|----------|-----------|-------------------|
| **Music** | Music tracks (MP3, FLAC, AAC, etc.) | Podcasts, audiobooks, music videos |
| **Video** | Movies, TV shows | Music videos, video podcasts |

See the detailed guides for each:

- **[Music Syncing](/user-guide/syncing/music)** — Supported audio formats, metadata, and how music lands on your device
- **[Video Syncing](/user-guide/syncing/video)** — Supported video formats, content type detection, and folder organization

## See Also

- [Media Sources](/user-guide/collections) — Where your media comes from
- [Transcoding Methodology](/user-guide/transcoding) — How podkit decides what to transcode
- [Tips & Next Steps](/getting-started/tips) — Quality settings, listing media, and more
- [CLI Reference](/reference/cli-commands) — All sync options
