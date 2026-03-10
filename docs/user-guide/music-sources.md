---
title: Music Sources
description: Configure music collection sources including local directories and Subsonic servers.
sidebar:
  order: 2
---

# Music Sources

podkit supports multiple types of music collection sources. This guide covers how to configure and use each type.

## Directory Sources (Default)

The simplest source type scans a local directory for audio files.

### Configuration

```toml
[music.main]
path = "/path/to/your/music"
```

### How It Works

1. Scans the specified directory recursively for audio files
2. Parses metadata from each file using the `music-metadata` library
3. Builds an in-memory collection of tracks
4. Compares against iPod contents during sync

### Supported Formats

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

### Metadata Extracted

podkit extracts the following metadata from audio files:

- **Core fields:** title, artist, album (required for matching)
- **Extended fields:** album artist, genre, year, track number, disc number, composer
- **Technical info:** duration, bitrate, sample rate, file size
- **Identifiers:** MusicBrainz IDs, AcoustID (for future use)

### Multiple Directory Sources

Configure multiple collections for different music categories:

```toml
[music.main]
path = "/Volumes/Media/music/library"

[music.podcasts]
path = "/Volumes/Media/podcasts"

[music.audiobooks]
path = "/Volumes/Media/audiobooks"
```

Sync a specific collection:

```bash
podkit sync -c podcasts
```

## Subsonic Sources

podkit supports syncing from Subsonic-compatible servers including Navidrome, Airsonic, Gonic, and the original Subsonic server.

### Configuration

```toml
[music.navidrome]
type = "subsonic"
url = "https://your-server.example.com"
username = "your-username"
password = "your-password"
path = "/path/to/download/cache"
```

### Password Options

The password can be provided in several ways (checked in this order):

1. **Config file** - Add `password = "..."` to the collection config
2. **Collection-specific env var** - Set `PODKIT_MUSIC_{NAME}_PASSWORD` where `{NAME}` is the collection name in uppercase
3. **Fallback env var** - Set `SUBSONIC_PASSWORD` for any Subsonic collection

**Example with environment variable:**

```bash
# For a collection named "navidrome"
export PODKIT_MUSIC_NAVIDROME_PASSWORD="your-password"
podkit sync -c navidrome
```

> **Security note:** Storing passwords in config files is convenient but less secure than environment variables.

### How It Works

1. Connect to the Subsonic server using the API
2. Fetch the complete catalog (paginating through albums)
3. Extract track metadata from the API response
4. During sync, stream audio directly from the server
5. Transcode as needed and copy to iPod

### Supported Servers

| Server | Status | Notes |
|--------|--------|-------|
| Navidrome | Tested | Full support |
| Airsonic | Untested | Should work (same API) |
| Gonic | Untested | Should work (same API) |
| Subsonic | Untested | Should work (original API) |

### Limitations

- **No playlist sync** (yet) - only tracks are synced
- **Fresh fetch each sync** - no local catalog caching
- **Single server per collection** - create multiple collections for multiple servers

### Example with Multiple Servers

```toml
[music.home-server]
type = "subsonic"
url = "https://home.example.com"
username = "user"
path = "/tmp/subsonic-cache"

[music.work-server]
type = "subsonic"
url = "https://work.example.com"
username = "workuser"
path = "/tmp/work-cache"
```

## Future Sources

Additional adapters may be added if users request them:

| Source | Type | Status |
|--------|------|--------|
| Strawberry | SQLite | Planned |
| beets | SQLite | Planned |
| Jellyfin | API | Planned |
| iTunes XML | File | Considered |

## Sync Selection (Future)

Currently, podkit syncs all tracks found in the source. Future versions will support filtering:

| Approach | Description |
|----------|-------------|
| **Playlist** | Import M3U/M3U8 playlist of songs to sync |
| **Path patterns** | Include/exclude directories |
| **Tag filters** | Filter by genre, artist, year, etc. |

## See Also

- [Configuration](/user-guide/configuration) - Full configuration reference
- [Transcoding](/user-guide/transcoding) - Quality settings for transcoding
- [CLI Commands](/reference/cli-commands) - Command-line options
