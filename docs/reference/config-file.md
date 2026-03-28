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
audioQuality = "high"        # Audio override: max | high | medium | low
videoQuality = "high"        # Video override: max | high | medium | low
encoding = "vbr"             # Encoding mode: vbr | cbr
transferMode = "fast"        # Transfer mode: fast | optimized | portable
artwork = true               # Include album artwork
checkArtwork = false         # Detect changed artwork between syncs
tips = true                  # Show contextual tips
skipUpgrades = false         # Skip file-replacement upgrades for changed source files

# Codec preferences (defaults shown — omit to use these)
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

# Clean up featured artist credits (simple form)
cleanArtists = true

# Or with options (table form):
# [cleanArtists]
# drop = false
# format = "feat. {}"
# ignore = []

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
encoding = "vbr"             # Encoding mode override for this device
transferMode = "fast"        # Transfer mode override for this device
artwork = true

# Per-device codec preferences
[devices.<name>.codec]
lossy = "aac"

# Per-device clean artists
[devices.<name>.cleanArtists]
format = "feat. {}"

# Defaults
[defaults]
device = "myipod"
music = "main"
video = "movies"
```

## version

**Type:** Integer
**Required:** Yes (added automatically by `podkit init` and `podkit migrate`)

The config file version. Used by podkit to detect outdated configs and guide users through migrations.

```toml
version = 1
```

If this field is missing, the config is treated as version 0 (pre-versioning). Running any podkit command with an outdated config will show an error directing you to run `podkit migrate`.

## Global Settings

These apply to all devices unless overridden at the device level.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `quality` | string | `"high"` | Unified quality preset for both audio and video: `max`, `high`, `medium`, `low`. The `max` preset is device-aware — it uses ALAC (lossless) on devices that support it when the source is lossless, otherwise falls back to `high`-quality AAC. |
| `audioQuality` | string | - | Audio-specific quality override: `max`, `high`, `medium`, `low`. Overrides `quality` for audio. |
| `videoQuality` | string | - | Video-specific quality override: `max`, `high`, `medium`, `low`. Overrides `quality` for video. |
| `encoding` | string | `"vbr"` | Encoding mode for lossy transcoding: `vbr` (variable bitrate) or `cbr` (constant bitrate). VBR produces better quality per MB; CBR produces predictable file sizes and more reliable preset change detection. Applies to whichever codec the [preference stack](/user-guide/transcoding/codec-preferences) resolves. |
| `transferMode` | string | `"fast"` | Transfer mode controlling how extra file data (e.g. embedded artwork) is handled during sync. `fast` skips extra data for fastest sync. `optimized` strips data your device won't use, saving storage. `portable` preserves extra track data for extracting files later. |
| `customBitrate` | integer | - | Override the preset's target bitrate (64-320 kbps). Ignored when `max` resolves to ALAC. |
| `bitrateTolerance` | number | - | Override the automatic preset change detection tolerance (0.0-1.0). Default is 0.3 (30%) for VBR and 0.1 (10%) for CBR. |
| `artwork` | boolean | `true` | Include album artwork during sync |
| `checkArtwork` | boolean | `false` | Detect artwork changes between syncs (added, removed, or replaced). For Subsonic sources, adds one HTTP request per unique album during scanning. Consider using the `--check-artwork` CLI flag for periodic checks instead of enabling permanently on large libraries. |
| `tips` | boolean | `true` | Show contextual tips (e.g., Sound Check, eject reminders). Also controllable via `--no-tips` flag or `PODKIT_TIPS=false`. |
| `skipUpgrades` | boolean | `false` | Skip file-replacement upgrades for changed source files |

## Codec Preferences

The `[codec]` section controls which audio codec podkit uses for transcoding. podkit walks the preference list top-to-bottom and selects the first codec the target device supports and whose encoder is available in FFmpeg. See [Codec Preferences](/user-guide/transcoding/codec-preferences) for the full guide.

```toml
[codec]
lossy = ["opus", "aac", "mp3"]        # Default lossy stack
lossless = ["source", "flac", "alac"] # Default lossless stack
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lossy` | string or string[] | `["opus", "aac", "mp3"]` | Ordered preference list for lossy transcoding. First supported codec with an available encoder wins. |
| `lossless` | string or string[] | `["source", "flac", "alac"]` | Ordered preference list for lossless transcoding (used when quality is `max` and source is lossless). The `source` keyword means "keep original format if the device supports it." |

Per-device codec overrides are set under `[devices.<name>.codec]`:

```toml
[devices.classic.codec]
lossy = "aac"           # Single value is fine (treated as one-element list)

[devices.rockbox.codec]
lossy = ["opus", "aac"]
lossless = "flac"
```

Valid codec identifiers: `opus`, `aac`, `mp3`, `flac`, `alac`, `source` (lossless stack only).

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

The password can be provided via the config file, or through environment variables (see [Environment Variables](/reference/environment-variables)).

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

Each device is defined under `[devices.<name>]`. Use `podkit device add -d <name>` to auto-detect and register a connected device.

```toml
# iPod — type is auto-detected
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "IPOD"
quality = "max"               # Best quality — ALAC on Classic (supports it)
videoQuality = "high"
encoding = "vbr"              # Encoding mode for this device
transferMode = "fast"         # Transfer mode for this device
artwork = true
skipUpgrades = false          # Allow file-replacement upgrades (default)

# Mass-storage DAP — specify type for predefined capabilities
[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
quality = "high"

# Generic mass-storage player with custom capabilities
[devices.mydap]
type = "generic"
volumeUuid = "HIJK-3456"
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "ogg"]
artworkMaxResolution = 320
```

A minimal device entry only needs the settings you want to override — `volumeUuid` is only required for auto-detection:

```toml
[devices.classic]
quality = "max"               # Use --device <path> to specify mount point
```

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `type` | string | no | auto-detected | Device type: `ipod`, `echo-mini`, `rockbox`, or `generic`. iPods are auto-detected; mass-storage devices should specify a type. See [Supported Devices](/devices/supported-devices) for predefined profiles. |
| `volumeUuid` | string | no | - | Volume UUID for device auto-detection. Required if you want podkit to automatically find your device without specifying `--device <path>`. |
| `volumeName` | string | no | - | Volume name for display |
| `quality` | string | no | global `quality` | Unified quality preset override for this device |
| `audioQuality` | string | no | global `audioQuality` | Audio-specific quality override for this device |
| `videoQuality` | string | no | global `videoQuality` | Video-specific quality override for this device |
| `encoding` | string | no | global `encoding` | Encoding mode override: `vbr` or `cbr` |
| `transferMode` | string | no | global `transferMode` | Transfer mode override: `fast`, `optimized`, or `portable` |
| `customBitrate` | integer | no | global `customBitrate` | Override the preset's target bitrate for this device |
| `bitrateTolerance` | number | no | global `bitrateTolerance` | Override preset change detection tolerance for this device |
| `artwork` | boolean | no | global `artwork` | Artwork override for this device |
| `checkArtwork` | boolean | no | global `checkArtwork` | Detect changed artwork for this device |
| `skipUpgrades` | boolean | no | global `skipUpgrades` | Skip file-replacement upgrades for this device |

### Device Capability Overrides

Mass-storage devices use predefined capability profiles based on their `type`. You can override individual capabilities for devices that differ from their profile, or to configure the `generic` type for your specific hardware:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `supportedAudioCodecs` | string[] | from profile | Audio codecs the device can play natively: `aac`, `alac`, `mp3`, `flac`, `ogg`, `opus`, `wav`, `aiff` |
| `artworkSources` | string[] | from profile | How the device reads artwork, in priority order (first = preferred): `embedded`, `sidecar`, `database` |
| `artworkMaxResolution` | integer | from profile | Maximum artwork dimension in pixels (square). podkit resizes artwork to fit. |
| `supportsVideo` | boolean | from profile | Whether the device supports video playback |
| `audioNormalization` | string | from profile | Volume normalization mode: `soundcheck` (writes to iPod database), `replaygain` (Rockbox reads tags natively), or `none` (skip normalization). podkit adapts its behavior — hiding normalization UI, skipping soundcheck upgrade detection — based on this value. |
| `musicDir` | string | `"Music"` | Custom music directory path on the device |

These fields are only relevant for mass-storage devices (`echo-mini`, `rockbox`, `generic`). iPod capabilities are determined automatically from the device generation.

### Per-Device Clean Artists

Devices can override the global `cleanArtists` setting:

```toml
[devices.classic.cleanArtists]
format = "feat. {}"
```

## Clean Artists

Extracts featured artist information from the artist field and moves it to the title field. Applied globally to all devices unless overridden.

The simplest form is a boolean:

```toml
cleanArtists = true
```

For more control, use the table form (implies enabled):

```toml
[cleanArtists]
drop = false
format = "feat. {}"
ignore = ["Simon & Garfunkel"]
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
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

## Quality Resolution Order

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
2. CLI `--quality`
3. Device `videoQuality`
4. Device `quality`
5. Global `videoQuality`
6. Global `quality`
7. Default: `"high"`

## Full Example

```toml
# Global defaults
quality = "high"              # Unified quality for audio and video
encoding = "vbr"              # VBR encoding (default)
transferMode = "fast"         # Direct-copy compatible files, strip artwork from transcodes
artwork = true

# Codec preferences (defaults — omit to use these)
[codec]
lossy = ["opus", "aac", "mp3"]
lossless = ["source", "flac", "alac"]

# Clean up featured artist credits
[cleanArtists]
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
audioQuality = "max"          # ALAC on Classic (it supports lossless)
videoQuality = "high"
artwork = true

[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
quality = "high"

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"            # Both audio and video use medium
artwork = false
skipUpgrades = true           # Nano has limited space, skip file upgrades

# Defaults
[defaults]
device = "classic"
music = "main"
video = "movies"
```

## See Also

- [Configuration Guide](/user-guide/configuration) - Conceptual overview
- [Codec Preferences](/user-guide/transcoding/codec-preferences) - How codec selection works
- [Environment Variables](/reference/environment-variables) - Env var overrides and config priority
- [CLI Commands](/reference/cli-commands) - Command-line options
- [Quality Presets](/reference/quality-presets) - Audio and video quality details
