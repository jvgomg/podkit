# podkit

Sync your music collection to iPod. The way it should work.

**[Documentation](https://jvgomg.github.io/podkit)** | **[Getting Started](https://jvgomg.github.io/podkit/getting-started/installation)**

## Overview

podkit is a CLI tool and TypeScript library for syncing music collections to iPod devices. It handles:

- **Smart sync** - Only transfers new or changed tracks with intelligent duplicate detection
- **High-quality transcoding** - Converts FLAC and lossless formats to AAC via FFmpeg
- **Full metadata preservation** - All tags and album artwork preserved through transcoding
- **Multiple sources** - Sync from local directories or Subsonic servers (Navidrome, Airsonic)
- **Video support** - Sync movies and TV shows to video-capable iPods
- **Scriptable** - CLI-first design for automation with cron, scripts, and pipelines

## Supported Devices

iPod Classic, Video, Nano (1st-5th gen), Mini, and Shuffle (1st-2nd gen) — including modded iPods with iFlash SD adapters. iOS devices are **not supported**.

See [Device Compatibility](https://jvgomg.github.io/podkit/devices/supported-devices) for the full list.

## Quick Start

```bash
# Install
npm install -g podkit

# Create config file
podkit init

# Connect iPod and register it
podkit device add myipod

# Preview what would be synced
podkit sync --dry-run

# Sync your music
podkit sync

# Safely eject
podkit eject
```

See the [full Getting Started guide](https://jvgomg.github.io/podkit/getting-started/installation) for detailed setup instructions.

## Requirements

- **Node.js 20+**
- **FFmpeg** with AAC encoder
- **libgpod** (iPod database library)

Platform support: macOS and Linux. See [Installation](https://jvgomg.github.io/podkit/getting-started/installation) for per-platform setup.

## Development

```bash
git clone https://github.com/jvgomg/podkit
cd podkit
bun install
bun run build
bun run test
```

See [Development Setup](https://jvgomg.github.io/podkit/developers/development) and [Contributing](https://jvgomg.github.io/podkit/developers/contributing) for details.

## Documentation

Full documentation at **[jvgomg.github.io/podkit](https://jvgomg.github.io/podkit)**:

- [Getting Started](https://jvgomg.github.io/podkit/getting-started/installation) - Installation and first sync
- [User Guide](https://jvgomg.github.io/podkit/user-guide/configuration) - Configuration, sources, transcoding
- [CLI Reference](https://jvgomg.github.io/podkit/reference/cli-commands) - All commands and options
- [Developer Guide](https://jvgomg.github.io/podkit/developers/architecture) - Architecture and contributing

## License

MIT
