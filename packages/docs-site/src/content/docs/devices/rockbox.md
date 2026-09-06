---
title: Rockbox Compatibility
description: How to use podkit with Rockbox firmware — native folder-based sync and iTunesDB compatibility.
sidebar:
  order: 3
---

podkit supports Rockbox as a first-class device type with native folder-based sync — no iTunesDB required. Set `type = "rockbox"` in your device config and podkit syncs directly to the filesystem with clean metadata tags that Rockbox's Database feature can index.

```toml
[devices.myrockbox]
type = "rockbox"
volumeUuid = "ABCD-1234"
```

Rockbox supports a wide range of codecs including Opus, FLAC, and OGG — see [Supported Devices](/devices/supported-devices) for the full capability profile.

## Using Rockbox with iTunesDB-Synced Music

If your iPod was previously synced using podkit's iPod mode (or iTunes), your music is stored in the iTunesDB format with scrambled filenames. Rockbox can still play this music — it just requires enabling the Database feature rather than browsing by filename.

### Why Rockbox Can't Browse iTunesDB Files Directly

When podkit (or iTunes) syncs music to an iPod in `ipod` mode, it:

1. Stores files with **scrambled filenames** in `iPod_Control/Music/F00/ABCD.m4a`, `F01/KCDI.m4a`, etc.
2. Records all metadata (artist, album, title) in the **iTunesDB database**, not in the filenames

Apple's stock firmware reads the iTunesDB to display your library. Rockbox does not read iTunesDB — it has its own browsing system. This means:

| Browsing method | Result with iTunesDB-synced music |
|-----------------|-------------------------------|
| **Rockbox File Browser** | Files appear with meaningless names like `KCDI.m4a` in numbered folders — unusable for browsing |
| **Rockbox Database** | Works — reads embedded metadata tags from the audio files and builds a browsable library |
| **Apple stock firmware** | Works — reads iTunesDB as intended |

The key insight: your audio files still contain full embedded metadata (ID3 tags, Vorbis comments). Rockbox's Database feature reads these tags directly from the files, bypassing the scrambled filenames entirely.

### Setup: Enable Rockbox Database

Rockbox's Database feature scans your audio files, reads their embedded metadata tags, and builds a searchable library you can browse by artist, album, genre, and more.

#### Initial setup (one time)

1. On your iPod, go to **Settings > General Settings > Database**
2. Select **Initialize Now**
3. Rockbox scans all audio files and reads their tags — this runs in the background, and you can use the iPod while it works
4. Once complete, use the **Database** entry on the main menu to browse your library

#### After each sync

After syncing new music with podkit, Rockbox needs to pick up the new tracks:

- **Manual:** Go to **Settings > General Settings > Database > Update Now**
- **Automatic:** Enable **Auto Update** in Database settings — Rockbox will detect new files on boot, removing the need to update manually

## Caveats

### Playlists don't carry over from iTunesDB

Playlists created in the iTunesDB are not visible to Rockbox. If you need playlists on Rockbox, you'll need to create them using Rockbox's own playlist system (M3U files) or recreate them manually within Rockbox.

### Initial scan can be slow

On a large library (10,000+ tracks), the first database initialization can take several minutes. Subsequent updates after a sync are faster since Rockbox only needs to index new files.

### Album artwork

Rockbox supports both sidecar artwork files and embedded artwork in audio tags. podkit's Rockbox profile lists sidecar as the preferred source, with embedded as a fallback.

### Play counts and ratings

Play count and rating data stored in the iTunesDB is not visible to Rockbox. Rockbox maintains its own runtime database for tracking playback statistics. These two systems are completely independent.

### Dual-boot considerations

If you dual-boot between Apple firmware and Rockbox, you can register the same device twice with different types:

```toml
# For syncing via iTunesDB (Apple firmware)
[devices.ipod-stock]
volumeUuid = "ABCD-1234"

# For syncing via filesystem (Rockbox)
[devices.ipod-rockbox]
type = "rockbox"
volumeUuid = "ABCD-1234"
```

Use `--device` to choose which sync mode to use for a given session.

## Rockbox Documentation

| Resource | Description |
|----------|-------------|
| [Rockbox Database wiki](https://www.rockbox.org/wiki/DataBase) | How the Database/TagCache feature works, configuration options |
| [Rockbox manual index](https://www.rockbox.org/manual.shtml) | Select your iPod model for the full manual, including Database and File Browser sections |
| [Rockbox website](https://www.rockbox.org/) | Downloads, installation guides, and supported devices |

## See Also

- [Supported Devices](/devices/supported-devices) — Device profiles and compatibility
- [iPod Internals](/devices/ipod-internals) — How the iTunesDB format works
