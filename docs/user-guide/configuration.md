---
title: Configuration
description: Configure podkit with collections, devices, quality presets, and sync options.
sidebar:
  order: 1
---

# Configuration

podkit uses a TOML configuration file located at `~/.config/podkit/config.toml`. This guide covers all configuration options.

## Creating the Config File

Generate a default configuration:

```bash
podkit init
```

Or create manually:

```bash
mkdir -p ~/.config/podkit
touch ~/.config/podkit/config.toml
```

## Basic Configuration

A minimal configuration with one music collection and one device:

```toml
# Music collection
[music.main]
path = "/path/to/your/music"

# Device
[devices.myipod]
volumeUuid = "ABC-123"      # Auto-detected by 'podkit device add'
volumeName = "IPOD"

# Defaults
[defaults]
device = "myipod"
music = "main"
```

## Music Collections

Define multiple music sources:

```toml
[music.main]
path = "/Volumes/Media/music/library"

[music.podcasts]
path = "/Volumes/Media/podcasts"

[music.work]
path = "/Users/me/Music/work-playlist"
```

Sync a specific collection:

```bash
podkit sync -c podcasts
```

### Subsonic Collections

Connect to Subsonic-compatible servers (Navidrome, Airsonic, Gonic):

```toml
[music.navidrome]
type = "subsonic"
url = "https://your-server.example.com"
username = "your-username"
password = "your-password"           # Or use environment variable
path = "/path/to/download/cache"     # Local cache for streaming
```

For passwords, you can also use environment variables:

```bash
# For collection named "navidrome"
export PODKIT_MUSIC_NAVIDROME_PASSWORD="your-password"
```

See [Music Sources](/user-guide/music-sources) for full Subsonic configuration.

## Devices

### Adding Devices

Register a connected iPod:

```bash
podkit device add myipod
```

This auto-detects the device and adds it to your config:

```toml
[devices.myipod]
volumeUuid = "ABC-123-DEF-456"
volumeName = "IPOD"
```

### Device Settings

Configure per-device options:

```toml
[devices.classic]
volumeUuid = "ABC-123"
volumeName = "CLASSIC"
quality = "high"          # Transcoding quality
artwork = true            # Include album artwork

[devices.nano]
volumeUuid = "DEF-456"
volumeName = "NANO"
quality = "medium"        # Lower quality for less storage
artwork = false           # Skip artwork for faster sync
```

### Per-Device Collections

Assign specific collections to devices:

```toml
[devices.main-ipod]
volumeUuid = "ABC-123"
music = ["main", "podcasts"]    # Sync these collections

[devices.gym-ipod]
volumeUuid = "DEF-456"
music = ["workout"]             # Only workout music
```

## Quality Presets

Configure transcoding quality:

```toml
[transcode]
quality = "high"          # alac | max | high | medium | low
fallback = "max"          # Fallback for lossy sources when using ALAC
```

| Preset | Type | Target Bitrate | Description |
|--------|------|----------------|-------------|
| `alac` | Lossless | N/A | Apple Lossless (from lossless sources only) |
| `max` | VBR | ~320 kbps | Highest VBR quality |
| `high` | VBR | ~256 kbps | Transparent quality (default) |
| `medium` | VBR | ~192 kbps | Excellent quality |
| `low` | VBR | ~128 kbps | Good quality, space-efficient |

CBR variants are also available: `max-cbr`, `high-cbr`, `medium-cbr`, `low-cbr`.

See [Transcoding](/user-guide/transcoding) for detailed quality settings.

## Video Collections

Configure video sources for iPods that support video:

```toml
[video.movies]
path = "/path/to/movies"

[video.shows]
path = "/path/to/tv-shows"

[defaults]
video = "movies"
```

See [Video Sync](/user-guide/video-sync) for video configuration.

## Defaults

Set default values for CLI commands:

```toml
[defaults]
device = "myipod"         # Default device name
music = "main"            # Default music collection
video = "movies"          # Default video collection
quality = "high"          # Default quality preset
```

Override defaults on the command line:

```bash
podkit sync --device nano --quality medium -c podcasts
```

## Transforms

Configure metadata transforms applied during sync:

```toml
[transforms.ftintitle]
enabled = true            # Move "feat." from artist to title
drop = false              # If true, drop featuring info entirely
format = "feat. {}"       # Format string for title
```

See [Transforms](/reference/transforms) for all available transforms.

## Environment Variables

Some settings can be set via environment variables:

| Variable | Description |
|----------|-------------|
| `PODKIT_CONFIG` | Path to config file |
| `PODKIT_QUALITY` | Default quality preset |
| `PODKIT_MUSIC_{NAME}_PASSWORD` | Password for Subsonic collection |

## Full Example

```toml
# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.podcasts]
path = "/Volumes/Media/podcasts"

[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "user"
path = "/tmp/navidrome-cache"

# Video collections
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"

# Devices
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
quality = "high"
artwork = true
music = ["main", "podcasts"]
video = ["movies", "shows"]

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"
artwork = false
music = ["main"]

# Transcoding
[transcode]
quality = "high"
fallback = "max"

# Transforms
[transforms.ftintitle]
enabled = true
format = "feat. {}"

# Defaults
[defaults]
device = "classic"
music = "main"
video = "movies"
```

## See Also

- [Music Sources](/user-guide/music-sources) - Directory and Subsonic source configuration
- [Transcoding](/user-guide/transcoding) - Quality presets and encoder settings
- [Video Sync](/user-guide/video-sync) - Video collection configuration
- [CLI Commands](/reference/cli-commands) - Command-line options
- [Config File Reference](/reference/config-file) - Complete config schema
