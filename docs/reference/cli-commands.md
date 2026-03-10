---
title: CLI Commands
description: Complete reference for all podkit command-line interface commands and options.
sidebar:
  order: 1
---

Complete reference for all podkit CLI commands.

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--device <name\|path>` | Device name from config, or path to iPod mount point |
| `--config <path>` | Path to config file (default: `~/.config/podkit/config.toml`) |
| `-v, --verbose` | Increase verbosity (stackable: `-v`, `-vv`, `-vvv`) |
| `-q, --quiet` | Suppress non-essential output |
| `--json` | Output in JSON format |
| `--no-color` | Disable colored output |
| `--help` | Show help for command |
| `--version` | Show version number |

## Commands Overview

| Command | Description |
|---------|-------------|
| [`podkit init`](#podkit-init) | Create a default configuration file |
| [`podkit sync`](#podkit-sync) | Sync music and/or video collections to iPod |
| [`podkit device`](#podkit-device) | Device management commands |
| [`podkit collection`](#podkit-collection) | Collection management commands |
| [`podkit eject`](#podkit-eject) | Safely eject iPod (shortcut for `device eject`) |
| [`podkit mount`](#podkit-mount) | Mount an iPod (shortcut for `device mount`) |

## `podkit init`

Create a default configuration file.

```bash
podkit init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-f, --force` | Overwrite existing config file |
| `--path <path>` | Config file path (default: `~/.config/podkit/config.toml`) |

### Examples

```bash
# Create default config
podkit init

# Overwrite existing config
podkit init --force

# Create config at a custom path
podkit init --path ~/my-podkit-config.toml
```

## `podkit sync`

Sync music and/or video collections to an iPod.

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
| `-c, --collection <name>` | Collection name to sync (searches both music and video) |
| `-n, --dry-run` | Show what would be synced without making changes |
| `--quality <preset>` | Unified quality preset for audio and video: `max`, `high`, `medium`, `low` (also accepts audio-only values like `alac`, `*-cbr` which only affect audio) |
| `--audio-quality <preset>` | Audio-specific quality override: `alac`, `max`, `max-cbr`, `high`, `high-cbr`, `medium`, `medium-cbr`, `low`, `low-cbr` |
| `--video-quality <preset>` | Video-specific quality override: `max`, `high`, `medium`, `low` |
| `--lossy-quality <preset>` | Quality for lossy sources when audio quality is `alac` (default: `max`) |
| `--filter <pattern>` | Only sync tracks matching pattern |
| `--no-artwork` | Skip artwork transfer |
| `--delete` | Remove tracks from iPod that are not in the source |
| `--eject` | Eject iPod after successful sync |

### Examples

```bash
# Preview what would be synced
podkit sync --dry-run

# Sync music only
podkit sync music

# Sync video only
podkit sync video

# Sync a specific collection
podkit sync -c jazz

# Sync music collection named "main"
podkit sync music -c main

# Sync to a specific device
podkit sync --device myipod

# Sync with lower quality to save space
podkit sync --quality medium

# Lossless audio with fallback for lossy sources
podkit sync --audio-quality alac --lossy-quality high

# Set unified quality, but override audio specifically
podkit sync --quality medium --audio-quality high

# Remove orphaned tracks and eject when done
podkit sync --delete --eject

# Skip artwork transfer for faster sync
podkit sync --no-artwork
```

## `podkit device`

Device management commands. Running `podkit device` with no subcommand lists all configured devices.

```bash
podkit device [subcommand] [options]
```

### `podkit device list`

List all configured devices.

```bash
podkit device list
```

### `podkit device add`

Detect a connected iPod and add it to the config.

```bash
podkit device add <name> [path]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Name for this device configuration |
| `[path]` | Explicit path to iPod mount point (auto-detected if omitted) |

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompts |

```bash
# Auto-detect connected iPod
podkit device add classic

# Specify mount point explicitly
podkit device add classic /Volumes/IPOD
```

### `podkit device remove`

Remove a device from the config.

```bash
podkit device remove <name>
```

| Option | Description |
|--------|-------------|
| `--confirm` | Skip confirmation prompt |

### `podkit device info`

Display device configuration and live status (storage, track count, model).

```bash
podkit device info [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Device name (uses default if omitted) |

```bash
# Show default device info
podkit device info

# Show info for a named device
podkit device info classic
```

### `podkit device music`

List music tracks on an iPod.

```bash
podkit device music [name] [options]
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show (see [Display Fields](#display-fields)) |

```bash
# List music on default device
podkit device music

# Export as JSON
podkit device music --format json

# Show specific fields
podkit device music --fields title,artist,album,genre,year
```

### `podkit device video`

List video content on an iPod.

```bash
podkit device video [name] [options]
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show (see [Display Fields](#display-fields)) |

### `podkit device clear`

Remove content from the iPod.

```bash
podkit device clear [name] [options]
```

| Option | Description |
|--------|-------------|
| `--type <type>` | Content type to clear: `music`, `video`, or `all` (default: `all`) |
| `--confirm` | Skip confirmation prompt (for scripts) |
| `--dry-run` | Show what would be removed without removing |

```bash
# Preview what would be cleared
podkit device clear --dry-run

# Clear only music
podkit device clear --type music

# Clear everything, no prompt
podkit device clear --confirm
```

### `podkit device reset`

Reset the iPod database. This erases all tracks and recreates the database from scratch.

```bash
podkit device reset [name] [options]
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `--dry-run` | Show what would happen without making changes |

### `podkit device eject`

Safely unmount an iPod device.

```bash
podkit device eject [name] [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force unmount even if device is busy |

### `podkit device mount`

Mount an iPod device.

```bash
podkit device mount [name] [options]
```

| Option | Description |
|--------|-------------|
| `--disk <identifier>` | Disk identifier (e.g., `/dev/disk4s2`) |
| `--dry-run` | Show mount command without executing |

```bash
# Mount default device
podkit device mount

# Mount by name
podkit device mount classic

# Mount using disk identifier
podkit device mount --disk /dev/disk4s2

# Show what mount command would run
podkit device mount --dry-run
```

### `podkit device init`

Initialize an iPod database on a device. Use this for blank or corrupted iPods.

```bash
podkit device init [name] [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Overwrite existing database |
| `-y, --yes` | Skip confirmation prompt |

## `podkit collection`

Manage music and video collections. Running `podkit collection` with no subcommand lists all configured collections.

```bash
podkit collection [subcommand] [options]
```

### `podkit collection list`

List configured collections.

```bash
podkit collection list [type]
```

| Argument | Description |
|----------|-------------|
| `[type]` | Filter by type: `music` or `video` |

```bash
# List all collections
podkit collection list

# List only music collections
podkit collection list music
```

### `podkit collection add`

Add a new collection to the config.

```bash
podkit collection add <type> <name> <path>
```

| Argument | Description |
|----------|-------------|
| `<type>` | Collection type: `music` or `video` |
| `<name>` | Collection name (letters, numbers, hyphens, underscores) |
| `<path>` | Path to the collection directory |

```bash
# Add a music collection
podkit collection add music main /Volumes/Media/music

# Add a video collection
podkit collection add video movies /Volumes/Media/movies
```

### `podkit collection remove`

Remove a collection from the config.

```bash
podkit collection remove <name>
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |

### `podkit collection info`

Display collection details.

```bash
podkit collection info <name>
```

### `podkit collection music`

List tracks in a music collection (scans the source directory or Subsonic server).

```bash
podkit collection music [name] [options]
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show (see [Display Fields](#display-fields)) |

### `podkit collection video`

List videos in a video collection.

```bash
podkit collection video [name] [options]
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show (see [Display Fields](#display-fields)) |

## `podkit eject`

Safely unmount an iPod device. This is a shortcut for `podkit device eject`.

```bash
podkit eject [name] [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force unmount even if device is busy |

```bash
# Eject default device
podkit eject

# Eject named device
podkit eject classic

# Force eject
podkit eject --force
```

## `podkit mount`

Mount an iPod device. This is a shortcut for `podkit device mount`.

```bash
podkit mount [name] [options]
```

| Option | Description |
|--------|-------------|
| `--disk <identifier>` | Disk identifier (e.g., `/dev/disk4s2`) |
| `--dry-run` | Show mount command without executing |

```bash
# Mount default device
podkit mount

# Mount using disk identifier
podkit mount --disk /dev/disk4s2
```

## Display Fields

The `--fields` option for track listing commands accepts a comma-separated list of field names.

**Available fields:**

| Field | Description |
|-------|-------------|
| `title` | Track title |
| `artist` | Artist name |
| `album` | Album name |
| `duration` | Track duration |
| `albumArtist` | Album artist |
| `genre` | Genre |
| `year` | Release year |
| `trackNumber` | Track number |
| `discNumber` | Disc number |
| `filePath` | File path |
| `artwork` | Whether artwork is present |
| `format` | Audio format |
| `bitrate` | Bitrate |

**Default fields:** `title`, `artist`, `album`, `duration`

## See Also

- [Configuration](/user-guide/configuration) - Config file options
- [Quick Start](/getting-started/quick-start) - Getting started guide
- [Config File Reference](/reference/config-file) - Complete config schema
