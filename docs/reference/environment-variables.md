---
title: Environment Variables
description: Reference for all podkit environment variables — config path, quality overrides, collections, and Subsonic passwords.
sidebar:
  order: 5
---

podkit settings can be overridden via environment variables. These take precedence over values in the config file but are overridden by CLI arguments.

## Settings Variables

| Variable | Description |
|----------|-------------|
| `PODKIT_CONFIG` | Path to config file (overrides default `~/.config/podkit/config.toml`) |
| `PODKIT_QUALITY` | Unified quality preset (overrides config file `quality`) |
| `PODKIT_AUDIO_QUALITY` | Audio-specific quality (overrides config file `audioQuality`) |
| `PODKIT_VIDEO_QUALITY` | Video-specific quality (overrides config file `videoQuality`) |
| `PODKIT_ENCODING` | Encoding mode: `vbr` or `cbr` (overrides config file `encoding`) |
| `PODKIT_TRANSFER_MODE` | Transfer mode: `fast`, `optimized`, or `portable`. Controls whether extra file data is preserved or stripped (overrides config file `transferMode`) |
| `PODKIT_FORCE_TRANSFER_MODE` | Force re-processing of all tracks when changing transfer mode (`true`/`false`) |
| `PODKIT_CUSTOM_BITRATE` | Override target bitrate for AAC encoding, 64-320 kbps (overrides config file `customBitrate`) |
| `PODKIT_BITRATE_TOLERANCE` | Override preset change detection tolerance, 0.0-1.0 (overrides config file `bitrateTolerance`) |
| `PODKIT_FORCE_TRANSCODE` | Force re-transcoding of all lossless-source tracks (`true`/`false`) |
| `PODKIT_FORCE_SYNC_TAGS` | Write sync tags to all matched transcoded tracks without re-transcoding (`true`/`false`) |
| `PODKIT_ARTWORK` | Default artwork setting (overrides config file `artwork`) |
| `PODKIT_CHECK_ARTWORK` | Enable artwork change detection (`true`/`false`, overrides config file `checkArtwork`) |
| `PODKIT_SKIP_UPGRADES` | Skip file-replacement upgrades during sync (`true`/`false`, overrides config file `skipUpgrades`) |
| `PODKIT_TIPS` | Show contextual tips (`true`/`false`, overrides config file `tips`) |
| `PODKIT_CLEAN_ARTISTS` | Enable/disable clean artists (`true`/`false`) |
| `PODKIT_CLEAN_ARTISTS_DROP` | Drop featuring info instead of moving to title (`true`/`false`) |
| `PODKIT_CLEAN_ARTISTS_FORMAT` | Format string for featuring text (e.g., `feat. {}`) |
| `PODKIT_CLEAN_ARTISTS_IGNORE` | Comma-separated artist names to skip (e.g., `Simon & Garfunkel,Hall & Oates`) |
| `PODKIT_MUSIC_DIR` | Music directory path on mass-storage devices (overrides config `musicDir`) |
| `PODKIT_MOVIES_DIR` | Movies directory path on mass-storage devices (overrides config `moviesDir`) |
| `PODKIT_TV_SHOWS_DIR` | TV shows directory path on mass-storage devices (overrides config `tvShowsDir`) |
| `PODKIT_SHOW_LANGUAGE` | Enable/disable language markers in video series titles (`true`/`false`) |
| `PODKIT_SHOW_LANGUAGE_FORMAT` | Format string for language marker (e.g., `({})`, `[{}]`) |
| `PODKIT_SHOW_LANGUAGE_EXPAND` | Expand language abbreviations to full names (`true`/`false`) |
| `SUBSONIC_PASSWORD` | Fallback password for any Subsonic collection |

## Collection Variables

Collections can be defined entirely via environment variables, eliminating the need for a config file. This is useful for Docker deployments and CI environments.

### Music Collections

Define a default music collection (no name required):

| Variable | Description |
|----------|-------------|
| `PODKIT_MUSIC_PATH` | Path to music directory (creates a default directory collection) |
| `PODKIT_MUSIC_TYPE` | Collection type: `directory` (default) or `subsonic` |
| `PODKIT_MUSIC_URL` | Subsonic server URL |
| `PODKIT_MUSIC_USERNAME` | Subsonic username |
| `PODKIT_MUSIC_PASSWORD` | Subsonic password |

Or define named collections by inserting the collection name (uppercased, hyphens as underscores):

| Variable | Description |
|----------|-------------|
| `PODKIT_MUSIC_<NAME>_PATH` | Path to music directory for collection `<NAME>` |
| `PODKIT_MUSIC_<NAME>_TYPE` | Collection type for `<NAME>` |
| `PODKIT_MUSIC_<NAME>_URL` | Subsonic server URL for `<NAME>` |
| `PODKIT_MUSIC_<NAME>_USERNAME` | Subsonic username for `<NAME>` |
| `PODKIT_MUSIC_<NAME>_PASSWORD` | Subsonic password for `<NAME>` |

### Video Collections

| Variable | Description |
|----------|-------------|
| `PODKIT_VIDEO_PATH` | Path to video directory (creates a default video collection) |
| `PODKIT_VIDEO_<NAME>_PATH` | Path to video directory for collection `<NAME>` |

### Naming Convention

Collection names in env vars use `UPPER_SNAKE_CASE`, converted to `lower-kebab-case` in config:

- `PODKIT_MUSIC_MY_SERVER_PATH` creates collection `my-server`
- `PODKIT_MUSIC_MAIN_PATH` creates collection `main`

### Auto-Defaulting

When exactly one collection of a given type is defined via env vars, it is automatically set as the default. For example, `PODKIT_MUSIC_PATH=/music` creates a collection named `default` and sets it as the default music collection.

### Examples

**Simple directory source (no config file needed):**
```bash
PODKIT_MUSIC_PATH=/music podkit sync --device /path/to/ipod
```

**Subsonic source:**
```bash
export PODKIT_MUSIC_TYPE=subsonic
export PODKIT_MUSIC_URL=https://navidrome.example.com
export PODKIT_MUSIC_USERNAME=user
export PODKIT_MUSIC_PASSWORD=secret
podkit sync --device /path/to/ipod
```

**Multiple named collections:**
```bash
export PODKIT_MUSIC_MAIN_PATH=/music/library
export PODKIT_MUSIC_VINYL_PATH=/music/vinyl-rips
podkit sync --device /path/to/ipod -c main
```

## Subsonic Password Resolution

For a Subsonic collection named `navidrome`, the password is resolved in this order:

1. `password` field in config file
2. `PODKIT_MUSIC_NAVIDROME_PASSWORD` environment variable
3. `SUBSONIC_PASSWORD` environment variable

The collection name is uppercased and hyphens are replaced with underscores. For example, a collection named `my-server` uses `PODKIT_MUSIC_MY_SERVER_PASSWORD`.

## Daemon Variables

These variables are used by the podkit daemon (Docker daemon mode). See the [Docker Daemon Mode](/getting-started/docker-daemon/) guide for setup instructions.

| Variable | Default | Description |
|----------|---------|-------------|
| `PODKIT_POLL_INTERVAL` | `5` | How often to check for new iPod devices, in seconds |
| `PODKIT_APPRISE_URL` | (unset) | Apprise notification endpoint URL (e.g., `http://apprise:8000/notify`) |

## Configuration Priority

Settings are merged from multiple sources. Later sources override earlier ones:

1. **Hardcoded defaults** — `quality = "high"`, `artwork = true`
2. **Config file** — `~/.config/podkit/config.toml`
3. **Environment variables** — `PODKIT_*`
4. **CLI arguments** — `--quality`, `--audio-quality`, `--video-quality`, `--no-artwork`, etc.

Device-specific settings (`[devices.<name>]`) override global settings when that device is being used.

For the detailed quality resolution chain (how `quality`, `audioQuality`, and `videoQuality` interact across global, device, and CLI levels), see [Config File Reference — Quality Resolution Order](/reference/config-file#quality-resolution-order).

## See Also

- [Config File Reference](/reference/config-file) — Complete config schema
- [Configuration Guide](/user-guide/configuration) — Conceptual overview
- [CLI Commands](/reference/cli-commands) — Command-line options
