---
title: Other Devices
description: Rockbox iPods, standalone DAPs, and podkit's future device support plans.
sidebar:
  order: 2
---

podkit's primary focus is Apple's stock iPod firmware — the hardest sync target due to the iTunesDB database format and its authentication requirements. By solving that problem first, podkit builds a foundation that can extend to easier targets in the future.

## Rockbox

iPods running [Rockbox](https://www.rockbox.org/) firmware work differently from stock firmware:

- **Database not required**: Rockbox can browse files directly on the filesystem
- **Dual-boot friendly**: Tracks synced via podkit are visible in both firmwares
- **Rockbox database**: Rockbox maintains its own database separate from iTunesDB

If you use Rockbox, you can still use podkit to organize and sync your music. The tracks will be playable through Rockbox's file browser or after building Rockbox's database.

Since Rockbox reads files directly from the filesystem without needing a database, it's a much simpler sync target than stock firmware. Dedicated Rockbox support (syncing without the iTunesDB overhead) is a future possibility.

## Standalone DAPs

Standalone digital audio players (DAPs) that use simple file-based music libraries are natural future targets for podkit. These devices typically just need music files organized in a directory structure — no proprietary database format required.

There is no timeline for DAP support, but the architecture is designed to accommodate it.

## See Also

- [Supported Devices](/devices/supported-devices) - Stock firmware iPod compatibility
- [Roadmap](/roadmap) - Planned features and priorities
- [Feedback](/feedback) - Request device support
