---
title: CLI Commands
description: Complete reference for all podkit command-line interface commands and options.
sidebar:
  order: 1
---

# CLI Commands Reference

Complete reference for all podkit CLI commands.

:::note[TODO]
This reference page needs to be expanded with complete command documentation. The basic structure is provided below.
:::

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Increase verbosity (stackable: -v, -vv, -vvv) |
| `-q, --quiet` | Suppress non-essential output |
| `--json` | Output in JSON format |
| `--config <path>` | Path to config file |
| `--help` | Show help for command |
| `--version` | Show version number |

## Commands Overview

| Command | Description |
|---------|-------------|
| `podkit init` | Create configuration file |
| `podkit sync` | Sync music/video to iPod |
| `podkit device` | Device management commands |
| `podkit eject` | Safely eject iPod |

## podkit init

Create a default configuration file.

```bash
podkit init
```

Creates `~/.config/podkit/config.toml` with template configuration.

## podkit sync

Sync content to iPod.

```bash
podkit sync [type] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `[type]` | Content type: `music`, `video`, or omit for both |

### Options

| Option | Description |
|--------|-------------|
| `-c, --collection <name>` | Collection name from config |
| `-n, --dry-run` | Preview changes without syncing |
| `--delete` | Remove tracks not in source |
| `--device <name\|path>` | Target device |
| `--quality <preset>` | Quality preset |
| `--video-quality <preset>` | Video quality preset |
| `--no-artwork` | Skip artwork transfer |
| `--eject` | Eject after successful sync |

### Examples

```bash
# Preview sync
podkit sync --dry-run

# Sync music only
podkit sync music

# Sync specific collection
podkit sync -c podcasts

# Sync with lower quality
podkit sync --quality medium

# Sync and eject
podkit sync --eject
```

## podkit device

Device management commands.

### podkit device info

Show device status and information.

```bash
podkit device info [options]
```

| Option | Description |
|--------|-------------|
| `--device <name\|path>` | Target device |
| `--format <format>` | Output format: `text` or `json` |

### podkit device add

Register a connected iPod.

```bash
podkit device add <name>
```

Auto-detects the connected iPod and saves to config.

### podkit device music

List music on iPod.

```bash
podkit device music [options]
```

| Option | Description |
|--------|-------------|
| `--device <name\|path>` | Target device |
| `--format <format>` | Output format: `text` or `json` |

### podkit device init

Initialize a blank iPod database.

```bash
podkit device init [options]
```

| Option | Description |
|--------|-------------|
| `--device <path>` | iPod mount path |

## podkit eject

Safely eject iPod.

```bash
podkit eject [options]
```

| Option | Description |
|--------|-------------|
| `--device <name\|path>` | Target device |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Device not found |
| 4 | Sync failed |

## See Also

- [Configuration](/user-guide/configuration) - Config file options
- [Quick Start](/getting-started/quick-start) - Getting started guide
