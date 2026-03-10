---
title: Config File Reference
description: Complete reference for the podkit configuration file schema and options.
sidebar:
  order: 2
---

Complete reference for the podkit configuration file (`~/.config/podkit/config.toml`).

## File Location

Default location: `~/.config/podkit/config.toml`

Override with `--config <path>` or the `PODKIT_CONFIG` environment variable.

## Schema Overview

```toml
# Global defaults
quality = "high"             # Unified quality: max | high | medium | low
audioQuality = "high"        # Audio override: alac | max | max-cbr | high | high-cbr | medium | medium-cbr | low | low-cbr
videoQuality = "high"        # Video override: max | high | medium | low
lossyQuality = "max"         # Quality for lossy sources when audioQuality = "alac"
artwork = true               # Include album artwork

# Global transforms
[transforms.ftintitle]
enabled = false
drop = false
format = "feat. {}"
ignore = []

# Music collections
[music.<name>]
path = "/path/to/music"
type = "directory"           # or "subsonic"

# Video collections
[video.<name>]
path = "/path/to/videos"

# Devices
[devices.<name>]
volumeUuid = "..."
volumeName = "..."
quality = "high"             # Unified quality for this device
audioQuality = "high"        # Audio override for this device
videoQuality = "high"        # Video override for this device
artwork = true

# Per-device transforms
[devices.<name>.transforms.ftintitle]
enabled = true

# Defaults
[defaults]
device = "myipod"
music = "main"
video = "movies"
```

## Global Settings

These apply to all devices unless overridden at the device level.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `quality` | string | `"high"` | Unified quality preset for both audio and video. Values common to both: `max`, `high`, `medium`, `low`. Audio-only values (`alac`, `*-cbr`) are accepted but only affect audio. |
| `audioQuality` | string | - | Audio-specific quality override. Accepts all audio presets: `alac`, `max`, `max-cbr`, `high`, `high-cbr`, `medium`, `medium-cbr`, `low`, `low-cbr`. Overrides `quality` for audio. |
| `videoQuality` | string | - | Video-specific quality override: `max`, `high`, `medium`, `low`. Overrides `quality` for video. |
| `lossyQuality` | string | `"max"` | Quality preset for lossy sources when `audioQuality` resolves to `alac` |
| `artwork` | boolean | `true` | Include album artwork during sync |

## Music Collections

Each music collection is defined under `[music.<name>]` where `<name>` is an identifier you choose.

### Directory Source

```toml
[music.main]
path = "/path/to/music"
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `path` | string | yes | - | Path to the music directory |
| `type` | string | no | `"directory"` | Source type |

### Subsonic Source

```toml
[music.navidrome]
type = "subsonic"
url = "https://server.example.com"
username = "user"
password = "password"
path = "/cache/path"
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `type` | string | yes | - | Must be `"subsonic"` |
| `url` | string | yes | - | Subsonic server URL |
| `username` | string | yes | - | Subsonic username |
| `password` | string | no | - | Subsonic password (can also use env var) |
| `path` | string | yes | - | Local cache path for downloaded files |

The password can be provided via the config file, or through environment variables (see [Environment Variables](#environment-variables)).

## Video Collections

Each video collection is defined under `[video.<name>]`.

```toml
[video.movies]
path = "/path/to/movies"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `path` | string | yes | Path to the video directory |

## Devices

Each device is defined under `[devices.<name>]`. Use `podkit device add <name>` to auto-detect and register a connected iPod.

```toml
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "IPOD"
quality = "high"              # Unified quality (audio + video)
audioQuality = "alac"         # Override: lossless audio
videoQuality = "high"         # Override: high video quality
artwork = true
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `volumeUuid` | string | yes | - | Volume UUID for device auto-detection |
| `volumeName` | string | no | - | Volume name for display |
| `quality` | string | no | global `quality` | Unified quality preset override for this device |
| `audioQuality` | string | no | global `audioQuality` | Audio-specific quality override for this device |
| `videoQuality` | string | no | global `videoQuality` | Video-specific quality override for this device |
| `artwork` | boolean | no | global `artwork` | Artwork override for this device |

### Per-Device Transforms

Devices can override global transform settings:

```toml
[devices.classic.transforms.ftintitle]
enabled = true
format = "feat. {}"
```

## Transforms

Global transform settings, applied to all devices unless overridden.

### ftintitle

Extracts featured artist information from the artist field and moves it to the title field.

```toml
[transforms.ftintitle]
enabled = true
drop = false
format = "feat. {}"
ignore = ["Simon & Garfunkel"]
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Whether the transform is active |
| `drop` | boolean | `false` | If `true`, drop featuring info entirely instead of moving to title |
| `format` | string | `"feat. {}"` | Format string for featuring text in title (`{}` is replaced with artist names) |
| `ignore` | string[] | `[]` | Artist names to ignore when splitting on ambiguous separators (`and`, `&`, `with`) |

## Defaults

Specifies which named collection and device to use when CLI flags are omitted.

```toml
[defaults]
device = "classic"
music = "main"
video = "movies"
```

| Key | Type | Description |
|-----|------|-------------|
| `device` | string | Default device name |
| `music` | string | Default music collection name |
| `video` | string | Default video collection name |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PODKIT_CONFIG` | Path to config file (overrides default location) |
| `PODKIT_QUALITY` | Unified quality preset (overrides config file `quality`) |
| `PODKIT_AUDIO_QUALITY` | Audio-specific quality (overrides config file `audioQuality`) |
| `PODKIT_VIDEO_QUALITY` | Video-specific quality (overrides config file `videoQuality`) |
| `PODKIT_LOSSY_QUALITY` | Lossy source quality (overrides config file `lossyQuality`) |
| `PODKIT_ARTWORK` | Default artwork setting (overrides config file `artwork`) |
| `PODKIT_MUSIC_<NAME>_PASSWORD` | Subsonic password for collection `<NAME>` (uppercase, hyphens become underscores) |
| `SUBSONIC_PASSWORD` | Fallback password for any Subsonic collection |

### Password Resolution Order

For a Subsonic collection named `navidrome`, the password is resolved in this order:

1. `password` field in config file
2. `PODKIT_MUSIC_NAVIDROME_PASSWORD` environment variable
3. `SUBSONIC_PASSWORD` environment variable

## Configuration Priority

Settings are merged from multiple sources in this order (later sources override earlier ones):

1. **Hardcoded defaults** - `quality = "high"`, `artwork = true`
2. **Config file** - `~/.config/podkit/config.toml`
3. **Environment variables** - `PODKIT_*`
4. **CLI arguments** - `--quality`, `--audio-quality`, `--video-quality`, `--no-artwork`, etc.

Device-specific settings (`[devices.<name>]`) override global settings when that device is being used.

### Quality Resolution Order

Audio and video quality each have their own resolution chain. More specific settings always win over less specific ones.

**Audio quality** (first match wins):

1. CLI `--audio-quality`
2. CLI `--quality`
3. Device `audioQuality`
4. Device `quality`
5. Global `audioQuality`
6. Global `quality`
7. Default: `"high"`

**Video quality** (first match wins):

1. CLI `--video-quality`
2. CLI `--quality` (only if the value is video-compatible: `max`, `high`, `medium`, `low`)
3. Device `videoQuality`
4. Device `quality` (only if the value is video-compatible)
5. Global `videoQuality`
6. Global `quality` (only if the value is video-compatible)
7. Default: `"high"`

## Full Example

```toml
# Global defaults
quality = "high"              # Unified quality for audio and video
audioQuality = "high"         # Override quality for audio only
videoQuality = "high"         # Override quality for video only
lossyQuality = "max"         # Quality for lossy sources when audioQuality = "alac"
artwork = true

# Global transforms
[transforms.ftintitle]
enabled = true
format = "feat. {}"
ignore = ["Simon & Garfunkel", "Hall & Oates"]

# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.vinyl-rips]
path = "/Volumes/Media/vinyl-rips"

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
quality = "high"              # Unified quality for this device
audioQuality = "alac"         # Lossless audio on Classic (overrides quality)
videoQuality = "high"
artwork = true

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"            # Both audio and video use medium
artwork = false

# Defaults
[defaults]
device = "classic"
music = "main"
video = "movies"
```

## See Also

- [Configuration Guide](/user-guide/configuration) - Practical configuration walkthrough
- [CLI Commands](/reference/cli-commands) - Command-line options
- [Quality Presets](/reference/quality-presets) - Audio and video quality details
