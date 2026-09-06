---
title: Directory Source
description: Configure local filesystem directories as music sources for syncing to iPod.
sidebar:
  order: 2
---

The simplest source type scans a local directory for audio files. This is the default collection type -- no `type` field is needed.

## Configuration

```toml
[music.main]
path = "/path/to/your/music"
```

## How It Works

1. Scans the specified directory recursively for audio files
2. Parses metadata from each file using the `music-metadata` library
3. Builds an in-memory collection of tracks
4. Compares against iPod contents during sync

## Supported Formats

| Format | Extension | Behavior |
|--------|-----------|----------|
| FLAC | `.flac` | Lossless - transcoded to AAC |
| MP3 | `.mp3` | Copied directly |
| AAC | `.m4a` | Copied directly |
| ALAC | `.m4a` | Copied directly (Apple Lossless) |
| OGG Vorbis | `.ogg` | Transcoded to AAC |
| Opus | `.opus` | Transcoded to AAC |
| WAV | `.wav` | Lossless - transcoded to AAC |
| AIFF | `.aiff`, `.aif` | Lossless - transcoded to AAC |

## Metadata Extracted

podkit extracts the following metadata from audio files:

- **Core fields:** title, artist, album (required for matching)
- **Extended fields:** album artist, genre, year, track number, disc number, composer
- **Technical info:** duration, bitrate, sample rate, file size
- **Identifiers:** MusicBrainz IDs, AcoustID (for future use)

## Multiple Directory Sources

Configure multiple collections for different music categories:

```toml
[music.main]
path = "/Volumes/Media/music/library"

[music.vinyl-rips]
path = "/Volumes/Media/vinyl-rips"

[music.jazz]
path = "/Volumes/Media/jazz"
```

Sync a specific collection:

```bash
podkit sync -c vinyl-rips
```

## Adding a Collection via CLI

You can add a directory collection without manually editing the config file:

```bash
podkit collection add -t music -c main --path /path/to/your/music
```

This writes the `[music.main]` section to your config file automatically. If it is the first music collection, it is also set as the default.

## See Also

- [Subsonic Source](/user-guide/collections/subsonic) - Sync from Navidrome and other Subsonic servers
- [Configuration](/user-guide/configuration) - Full configuration reference
- [Audio Transcoding](/user-guide/transcoding/audio) - Quality settings for transcoding
