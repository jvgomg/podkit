---
title: Config File Reference
description: Complete reference for the podkit configuration file schema and options.
sidebar:
  order: 2
---

# Config File Reference

Complete reference for the podkit configuration file (`~/.config/podkit/config.toml`).

:::note[TODO]
This reference page needs to be expanded with complete schema documentation. The basic structure is provided below.
:::

## File Location

Default location: `~/.config/podkit/config.toml`

Override with `--config <path>` or `PODKIT_CONFIG` environment variable.

## Schema Overview

```toml
# Music collections
[music.<name>]
path = "/path/to/music"
type = "directory"          # or "subsonic"

# Video collections
[video.<name>]
path = "/path/to/videos"

# Devices
[devices.<name>]
volumeUuid = "..."
volumeName = "..."
quality = "high"
artwork = true
music = ["collection1", "collection2"]
video = ["movies"]

# Transcoding
[transcode]
quality = "high"
fallback = "max"

# Transforms
[transforms.<name>]
enabled = true

# Defaults
[defaults]
device = "myipod"
music = "main"
video = "movies"
```

## Music Collections

### Directory Source

```toml
[music.main]
path = "/path/to/music"
type = "directory"          # Optional, default
```

### Subsonic Source

```toml
[music.navidrome]
type = "subsonic"
url = "https://server.example.com"
username = "user"
password = "password"       # Or use PODKIT_MUSIC_<NAME>_PASSWORD
path = "/cache/path"
```

## Video Collections

```toml
[video.movies]
path = "/path/to/movies"
quality = "high"
```

## Devices

```toml
[devices.classic]
volumeUuid = "ABCD-1234"    # Required - from 'podkit device add'
volumeName = "IPOD"         # Volume name (optional)
quality = "high"            # Per-device quality
artwork = true              # Include artwork
music = ["main"]            # Collections to sync
video = ["movies"]          # Video collections to sync
```

## Transcoding

```toml
[transcode]
quality = "high"            # alac | max | high | medium | low
fallback = "max"            # Fallback for lossy sources
```

## Transforms

```toml
[transforms.ftintitle]
enabled = true
drop = false
format = "feat. {}"
```

## Defaults

```toml
[defaults]
device = "classic"
music = "main"
video = "movies"
quality = "high"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PODKIT_CONFIG` | Path to config file |
| `PODKIT_QUALITY` | Default quality preset |
| `PODKIT_MUSIC_<NAME>_PASSWORD` | Password for Subsonic collection |
| `SUBSONIC_PASSWORD` | Fallback password for any Subsonic |

## See Also

- [Configuration Guide](/user-guide/configuration) - Configuration tutorial
- [CLI Commands](/reference/cli-commands) - Command-line options
