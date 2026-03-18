---
title: Rockbox Compatibility
description: How to use podkit-synced music with Rockbox firmware, including setup steps, caveats, and limitations.
sidebar:
  order: 3
---

podkit syncs music using Apple's iTunesDB format, which Rockbox does not read. Your music is still fully accessible on Rockbox — it just requires a one-time setup step.

:::note[Want first-class Rockbox support?]
Native Rockbox support (folder-based sync without iTunesDB) is on the [roadmap](/project/roadmap/). Vote and comment on the [discussion](https://github.com/jvgomg/podkit/discussions/34) to help us prioritise.
:::

## Why Rockbox Can't Read iTunesDB-Synced Music Directly

When podkit (or iTunes, or any iTunesDB-based tool) syncs music to an iPod, it:

1. Stores files with **scrambled filenames** in `iPod_Control/Music/F00/ABCD.m4a`, `F01/KCDI.m4a`, etc.
2. Records all metadata (artist, album, title) in the **iTunesDB database**, not in the filenames

Apple's stock firmware reads the iTunesDB to display your library. Rockbox does not read iTunesDB — it has its own browsing system. This means:

| Browsing method | Result with podkit-synced music |
|-----------------|-------------------------------|
| **Rockbox File Browser** | Files appear with meaningless names like `KCDI.m4a` in numbered folders — unusable for browsing |
| **Rockbox Database** | Works — reads embedded metadata tags from the audio files and builds a browsable library |
| **Apple stock firmware** | Works — reads iTunesDB as intended |

The key insight: your audio files still contain full embedded metadata (ID3 tags, Vorbis comments). Rockbox's Database feature reads these tags directly from the files, bypassing the scrambled filenames entirely.

## Setup: Enable Rockbox Database

Rockbox's Database feature scans your audio files, reads their embedded metadata tags, and builds a searchable library you can browse by artist, album, genre, and more.

### Initial setup (one time)

1. On your iPod, go to **Settings > General Settings > Database**
2. Select **Initialize Now**
3. Rockbox scans all audio files and reads their tags — this runs in the background, and you can use the iPod while it works
4. Once complete, use the **Database** entry on the main menu to browse your library

### After each sync

After syncing new music with podkit, Rockbox needs to pick up the new tracks:

- **Manual:** Go to **Settings > General Settings > Database > Update Now**
- **Automatic:** Enable **Auto Update** in Database settings — Rockbox will detect new files on boot, removing the need to update manually

## Caveats

### Playlists don't carry over

Playlists created in the iTunesDB are not visible to Rockbox. If you need playlists on Rockbox, you'll need to create them using Rockbox's own playlist system (M3U files) or recreate them manually within Rockbox.

### Initial scan can be slow

On a large library (10,000+ tracks), the first database initialization can take several minutes. Subsequent updates after a sync are faster since Rockbox only needs to index new files.

### Album artwork

Rockbox reads embedded album art from audio file tags. podkit embeds artwork in audio files during sync, so artwork should display correctly in Rockbox.

If artwork is missing, it may be because the art was only written to the iTunesDB artwork database (`iPod_Control/Artwork/*.ithmb`) and not embedded in the file. This is unusual with podkit but can happen with music synced by other tools.

### Play counts and ratings

Play count and rating data stored in the iTunesDB is not visible to Rockbox. Rockbox maintains its own runtime database for tracking playback statistics. These two systems are completely independent.

### Dual-boot considerations

If you dual-boot between Apple firmware and Rockbox, podkit-synced music works on both:

- **Apple firmware** reads the iTunesDB — full library browsing, playlists, play counts
- **Rockbox** reads embedded tags via Database — full library browsing, but playlists and play counts are separate

The audio files themselves are shared. You don't need two copies of your music.

## Rockbox Documentation

| Resource | Description |
|----------|-------------|
| [Rockbox Database wiki](https://www.rockbox.org/wiki/DataBase) | How the Database/TagCache feature works, configuration options |
| [Rockbox manual index](https://www.rockbox.org/manual.shtml) | Select your iPod model for the full manual, including Database and File Browser sections |
| [Rockbox website](https://www.rockbox.org/) | Downloads, installation guides, and supported devices |

## See Also

- [Supported Devices](/devices/supported-devices) — Stock firmware iPod compatibility
- [Other Devices](/devices/other-devices) — Standalone DAPs and future device support plans
- [iPod Internals](/devices/ipod-internals) — How the iTunesDB format works
