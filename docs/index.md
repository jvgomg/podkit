---
title: Introduction
description: podkit is a TypeScript toolkit for syncing music collections to iPod devices via CLI and library.
sidebar:
  order: 1
---

# podkit Documentation

**podkit** is a command-line tool and TypeScript library for synchronizing music collections to iPod devices. It handles collection diffing, transcoding (FLAC to AAC), metadata preservation, and artwork transfer.

## Who is podkit for?

- **Music enthusiasts** with classic iPods (including modded iPods with iFlash SD cards)
- **Power users** who want scriptable, automated music sync
- **Developers** who want to build iPod sync into their own tools

## Key Features

- **High-quality transcoding** - Converts FLAC and other lossless formats to AAC with configurable quality presets
- **Smart sync** - Only transfers new or changed tracks; detects duplicates automatically
- **Metadata preservation** - Maintains all tags and album artwork through the sync process
- **Video support** - Sync movies and TV shows to video-capable iPods
- **Multiple sources** - Sync from local directories or Subsonic-compatible servers (Navidrome, Airsonic)
- **Multi-device** - Configure and sync to multiple iPods with different settings
- **Scriptable** - Full CLI support for automation and cron jobs

## Supported Devices

podkit works with iPods that use USB Mass Storage mode with the iTunesDB database format:

- iPod Classic (all generations)
- iPod Video (5th and 5.5th generation)
- iPod Nano (1st through 5th generation)
- iPod Mini (1st and 2nd generation)
- iPod Shuffle (1st and 2nd generation)

See [Supported Devices](/devices/supported-devices) for the complete compatibility list.

**Not supported:** iOS devices (iPod Touch, iPhone, iPad) use a different sync protocol that cannot be supported.

## Quick Example

```bash
# Install podkit
npm install -g podkit

# Initialize configuration
podkit init

# Preview what will be synced
podkit sync --dry-run

# Sync your music
podkit sync

# Eject safely
podkit eject
```

## Getting Started

New to podkit? Start here:

1. [Installation](/getting-started/installation) - Install podkit and its dependencies
2. [Quick Start](/getting-started/quick-start) - Get syncing in 5 minutes
3. [First Sync](/getting-started/first-sync) - Detailed walkthrough of your first sync

## Documentation Overview

### For Users

- **[Getting Started](/getting-started/installation)** - Installation, setup, and first sync
- **[User Guide](/user-guide/configuration)** - Configuration, music sources, transcoding, video
- **[Device Compatibility](/devices/supported-devices)** - Supported iPod models and features
- **[Reference](/reference/cli-commands)** - CLI commands, config file, quality presets
- **[Troubleshooting](/troubleshooting/common-issues)** - Common issues and solutions

### For Developers

- **[Developer Guide](/developers/architecture)** - Architecture, development setup, testing
- **[ADRs](/developers/adr/)** - Architecture Decision Records explaining key technical choices

## Getting Help

- Search existing [GitHub Issues](https://github.com/jvgomg/podkit/issues)
- Open a new issue with verbose output (`podkit sync -vvv`)

## License

podkit is open source software. See the repository for license details.
