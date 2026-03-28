---
title: Quick Start
description: Get syncing music to your device in 5 minutes with podkit.
sidebar:
  order: 2
---

Get your music on your device in 5 minutes. This guide walks you through each step — from first install to hearing your music play.

## Prerequisites

- **podkit installed** — the quickest way is `brew install jvgomg/podkit/podkit` (see [Installation](/getting-started/installation) for other methods)
- A supported device connected to your computer (iPod, mass-storage DAP, or other portable player — see [Supported Devices](/devices/supported-devices))
- Music files on your computer (or a Subsonic-compatible server)

:::note[Using Docker?]
This guide covers native CLI usage. If you'd prefer to run podkit in a container, see the [Docker guide](/getting-started/docker) instead.
:::

## 1. Initialize Configuration

Create your config file:

```bash
podkit init
```

This creates `~/.config/podkit/config.toml` — the central place where podkit stores your collections, devices, and preferences.

## 2. Add Your Music

Register a local music directory:

```bash
podkit collection add -t music -c main --path /path/to/your/music
```

podkit scans this directory for audio files (FLAC, MP3, M4A, WAV, and more) and reads their metadata. Since this is your first music collection, it's automatically set as the default.

:::tip[Other sources]
You can also sync from a **Navidrome** or other Subsonic-compatible server — see [Subsonic Source](/user-guide/collections/subsonic). For video, see [Video Transcoding](/user-guide/transcoding/video). You can add as many collections as you need — see [Media Sources](/user-guide/collections) for an overview.
:::

## 3. Register Your Device

1. Connect your device and wait for it to mount
2. Optionally, preview what's connected:
   ```bash
   podkit device scan
   ```
3. Register it with podkit:
   ```bash
   podkit device add -d mydevice
   ```

podkit auto-detects the connected device and saves its identity to your config. Since this is your first device, it's set as the default.

:::tip[Non-iPod devices]
For mass-storage DAPs like the Snowsky Echo Mini, specify the device type during registration: `podkit device add -d myplayer --type echo-mini`. See [Supported Devices](/devices/supported-devices) for predefined profiles, or use `--type generic` for any mass-storage player.
:::

You can manage multiple devices with different quality settings — see [Managing Devices](/user-guide/devices) for more.

## 4. Preview with Dry Run

See what podkit will do before it does anything:

```bash
podkit sync --dry-run
```

This shows how many tracks will be added, what needs transcoding (e.g., FLAC to AAC), and estimated size. Nothing is written to your device.

## 5. Sync

When you're happy with the plan:

```bash
podkit sync
```

podkit scans your collection, transcodes lossless files if needed (selecting the [best codec your device supports](/user-guide/transcoding/codec-preferences)), copies everything to your device, and updates its library. Lossy files that are already device-compatible (MP3, AAC) are copied directly without re-encoding.

## 6. Eject and Enjoy

Safely eject before disconnecting:

```bash
podkit device eject
```

Or combine sync and eject in one step:

```bash
podkit sync --eject
```

Disconnect your device and enjoy your music!

## Explore More

```bash
# See everything podkit can do
podkit --help

# Get help for a specific command
podkit sync --help
podkit device --help
```

## Next Steps

Now that you've completed your first sync, here are some things to explore:

- **[Tips & Next Steps](/getting-started/tips)** — Quality presets, incremental syncs, removing deleted tracks, and troubleshooting
- **[Configuration](/user-guide/configuration)** — Customize quality, artwork, and transforms
- **[CLI Reference](/reference/cli-commands)** — All available commands
- **[Audio Transcoding](/user-guide/transcoding/audio)** — Quality settings and encoder options
