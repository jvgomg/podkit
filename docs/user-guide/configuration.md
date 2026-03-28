---
title: Configuration
description: Understand podkit's configuration concepts — collections, devices, quality, and defaults.
sidebar:
  order: 1
---

podkit uses a TOML configuration file to define where your music lives, which devices to sync to, and how to transcode. This guide introduces the core concepts — see the [Config File Reference](/reference/config-file) for the complete schema.

## Creating the Config File

The config file lives at `~/.config/podkit/config.toml`. Generate one with:

```bash
podkit init
```

Or create it manually:

```bash
mkdir -p ~/.config/podkit
touch ~/.config/podkit/config.toml
```

You can override the config file location with `--config <path>` or the `PODKIT_CONFIG` environment variable.

## Core Concepts

A podkit config has three main parts:

1. **Collections** — where your music (and video) lives
2. **Devices** — the iPods you sync to
3. **Defaults** — what happens when you just run `podkit sync`

### Collections

Collections are named music sources. Each one points to either a local directory or a Subsonic-compatible server:

```toml
# A local music library
[music.main]
path = "/Volumes/Media/music/library"

# A Subsonic server (Navidrome, Airsonic, etc.)
[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "user"
path = "/tmp/navidrome-cache"
```

You can define as many collections as you need and sync them independently:

```bash
podkit sync -c main          # Sync just the "main" collection
podkit sync -c navidrome     # Sync just the Subsonic collection
```

For details on each source type, see:
- [Directory Source](/user-guide/collections/directory)
- [Subsonic Source](/user-guide/collections/subsonic)

### Devices

Devices are named iPods registered in your config. The easiest way to add one is with a connected iPod:

```bash
podkit device add -d myipod
```

This auto-detects the device and writes the config entry:

```toml
[devices.myipod]
volumeUuid = "ABC-123-DEF-456"
volumeName = "IPOD"
```

Each device can have its own quality and artwork settings, so a high-capacity Classic can use lossless audio while a Nano uses compressed:

```toml
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
audioQuality = "max"       # ALAC on Classic (it supports lossless)

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"
artwork = false
```

See [Managing Devices](/user-guide/devices) for the full device setup guide.

### Defaults

The `[defaults]` section sets which collection and device to use when you don't specify them on the command line:

```toml
[defaults]
device = "classic"
music = "main"
video = "movies"
```

With these defaults, `podkit sync` is equivalent to `podkit sync --device classic -c main`. You can always override on the command line:

```bash
podkit sync --device nano -c vinyl-rips
```

## Quality

Quality controls how podkit transcodes audio and video. The simplest approach is a single `quality` setting — either globally or per device:

```toml
quality = "high"              # Global default for audio and video
```

For finer control, `audioQuality` and `videoQuality` override `quality` independently. This is useful when you want lossless audio but compressed video:

```toml
[devices.classic]
audioQuality = "max"          # ALAC on Classic (it supports lossless)
videoQuality = "high"
```

By default, lossy transcoding uses VBR encoding. You can switch to CBR globally or per device with `encoding = "cbr"`. podkit automatically selects the best codec your device supports (Opus, AAC, or MP3) -- see [Codec Preferences](/user-guide/transcoding/codec-preferences) for details.

### Transfer Mode

All transfer modes optimize for device compatibility — you choose how extra file data (like embedded artwork) is handled:

- **`fast`** (default) — Fastest sync. Strips embedded artwork from transcoded files; copies compatible files directly.
- **`optimized`** — Saves device storage. Strips embedded artwork from all files (your device stores artwork separately, so nothing is lost).
- **`portable`** — Preserves embedded artwork in all files, useful if you ever extract tracks from the device.

See [Quality Settings](/user-guide/devices/quality) for a practical guide to choosing presets, and [Quality Presets Reference](/reference/quality-presets) for the full preset specifications.

## Clean Artists

The `cleanArtists` feature moves featured artist credits from the Artist field into the Title field during sync — useful for cleaner artist browsing on iPods:

```toml
cleanArtists = true
```

This can be overridden per device. See [Artist Transforms](/user-guide/devices/artist-transforms) for a setup guide and the [Clean Artists Transform Reference](/reference/clean-artists) for all options.

## Minimal Example

Here's a complete working config with one collection, one device, and sensible defaults:

```toml
[music.main]
path = "/path/to/your/music"

[devices.myipod]
volumeUuid = "ABC-123"
volumeName = "IPOD"

[defaults]
device = "myipod"
music = "main"
```

## See Also

- [Config File Reference](/reference/config-file) — Complete schema with all options
- [Codec Preferences](/user-guide/transcoding/codec-preferences) — How podkit selects the audio codec
- [Environment Variables](/reference/environment-variables) — Override settings via environment
- [Quality Presets](/reference/quality-presets) — Audio and video quality specifications
- [CLI Commands](/reference/cli-commands) — Command-line options
