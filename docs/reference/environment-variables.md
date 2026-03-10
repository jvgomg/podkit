---
title: Environment Variables
description: Reference for all podkit environment variables — config path, quality overrides, and Subsonic passwords.
sidebar:
  order: 5
---

podkit settings can be overridden via environment variables. These take precedence over values in the config file but are overridden by CLI arguments.

## Variables

| Variable | Description |
|----------|-------------|
| `PODKIT_CONFIG` | Path to config file (overrides default `~/.config/podkit/config.toml`) |
| `PODKIT_QUALITY` | Unified quality preset (overrides config file `quality`) |
| `PODKIT_AUDIO_QUALITY` | Audio-specific quality (overrides config file `audioQuality`) |
| `PODKIT_VIDEO_QUALITY` | Video-specific quality (overrides config file `videoQuality`) |
| `PODKIT_LOSSY_QUALITY` | Lossy source quality (overrides config file `lossyQuality`) |
| `PODKIT_ARTWORK` | Default artwork setting (overrides config file `artwork`) |
| `PODKIT_MUSIC_<NAME>_PASSWORD` | Subsonic password for collection `<NAME>` (uppercase, hyphens become underscores) |
| `SUBSONIC_PASSWORD` | Fallback password for any Subsonic collection |

## Subsonic Password Resolution

For a Subsonic collection named `navidrome`, the password is resolved in this order:

1. `password` field in config file
2. `PODKIT_MUSIC_NAVIDROME_PASSWORD` environment variable
3. `SUBSONIC_PASSWORD` environment variable

The collection name is uppercased and hyphens are replaced with underscores. For example, a collection named `my-server` uses `PODKIT_MUSIC_MY_SERVER_PASSWORD`.

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
