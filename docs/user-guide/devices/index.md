---
title: Managing Devices
description: Manage multiple devices with podkit, configure per-device settings, and set defaults.
sidebar:
  order: 1
---

podkit supports managing multiple devices — iPods and mass-storage DAPs alike — each with its own quality settings, artwork preferences, and sync configuration. This guide covers how to configure and work with devices.

## Multiple Devices

You can register any number of devices in your config file. Each device gets a name that you use to reference it on the command line:

```toml
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
quality = "high"

[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
quality = "high"

[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
quality = "medium"
artwork = false

[defaults]
device = "classic"
```

In this example, `classic` is a high-capacity iPod that gets the best quality audio, `echomini` is a Snowsky Echo Mini DAP, and `nano` uses medium quality and skips artwork to save space.

## Setting a Default Device

Set the default device via the CLI:

```bash
podkit device default -d classic
```

Or in your config file's `[defaults]` section:

```toml
[defaults]
device = "classic"
```

With a default set, `podkit sync` targets the default device automatically. To show the current default or clear it:

```bash
podkit device default          # Show current default
podkit device default --clear  # Clear the default
```

## Referencing Devices on the CLI

Use `--device` (or `-d`) to target a specific device by its config name:

```bash
# Sync to a specific device
podkit sync --device nano

# Show device info
podkit device info -d classic

# List all registered devices
podkit device list
```

If you omit `--device`, podkit uses the default device from your config. If no default is set and multiple devices are configured, podkit will prompt you to choose.

## Device Settings

Each device section supports the following options:

| Option | Description | Default |
|--------|-------------|---------|
| `type` | Device type: `ipod`, `echo-mini`, `rockbox`, or `generic` | Auto-detected |
| `volumeUuid` | Filesystem UUID for auto-detection | — |
| `volumeName` | Volume label (used in mount paths) | — |
| `quality` | Unified quality preset (audio + video) | Global setting |
| `audioQuality` | Audio-specific quality override | Global setting |
| `videoQuality` | Video-specific quality override | Global setting |
| `artwork` | Whether to sync album artwork | `true` |

For mass-storage devices, you can also override device capabilities like `supportedAudioCodecs`, `artworkSources`, `artworkMaxResolution`, and content directory paths (`musicDir`, `moviesDir`, `tvShowsDir`). See [Supported Devices](/devices/supported-devices#custom-device-configuration) for the full list.

Per-device settings override global settings. This lets you use lossless audio on a high-capacity Classic while using compressed audio on a space-constrained Nano. See [Quality Settings](/user-guide/devices/quality) for a detailed guide.

You can also configure per-device artist transforms to clean up messy artist lists. See [Artist Transforms](/user-guide/devices/artist-transforms).

## See Also

- [Quality Settings](/user-guide/devices/quality) for per-device audio and video quality
- [Artist Transforms](/user-guide/devices/artist-transforms) for cleaning up artist names
- [Supported Devices](/devices/supported-devices) for device compatibility and profiles
- [Adding a Device](/user-guide/devices/adding-devices) for registering new devices
- [Configuration](/user-guide/configuration/) for full config file reference
