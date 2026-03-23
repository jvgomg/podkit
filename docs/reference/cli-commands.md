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
| `-d, --device <name\|path>` | Device name from config, or path to iPod mount point |
| `--config <path>` | Path to config file (default: `~/.config/podkit/config.toml`) |
| `-v, --verbose` | Increase verbosity (stackable: `-v`, `-vv`, `-vvv`) |
| `-q, --quiet` | Suppress non-essential output |
| `--json` | Output in JSON format |
| `--no-color` | Disable colored output |
| `--no-tips` | Suppress contextual tips |
| `--help` | Show help for command |
| `--version` | Show version number |

## Commands Overview

| Command | Description |
|---------|-------------|
| [`podkit init`](#podkit-init) | Create a default configuration file |
| [`podkit migrate`](#podkit-migrate) | Migrate config file to the latest version |
| [`podkit sync`](#podkit-sync) | Sync music and/or video collections to iPod |
| [`podkit device`](#podkit-device) | Device management commands |
| [`podkit collection`](#podkit-collection) | Collection management commands |
| [`podkit doctor`](#podkit-doctor) | Run health checks on iPod, repair artwork |
| [`podkit eject`](#podkit-eject) | Safely eject iPod (shortcut for `device eject`) |
| [`podkit mount`](#podkit-mount) | Mount an iPod (shortcut for `device mount`) |
| [`podkit completions`](#podkit-completions) | Generate shell completion scripts |

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

## `podkit migrate`

Migrate the config file to the latest version. Run this when podkit reports that your config is outdated.

```bash
podkit migrate [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-n, --dry-run` | Show what would change without writing |
| `-y, --yes` | Skip the confirmation prompt |

### Examples

```bash
# Preview changes without applying
podkit migrate --dry-run

# Apply migrations (with confirmation prompt)
podkit migrate

# Apply without prompting (for scripts)
podkit migrate --yes

# Migrate a config at a non-default path
podkit migrate --config /path/to/config.toml
```

### Behavior

1. Reads the current config version
2. Lists all pending migrations (version chain from current to latest)
3. For interactive migrations, prompts for user input — aborting leaves the config unchanged
4. Shows a diff of the changes
5. Asks for confirmation (unless `--yes` is passed)
6. Backs up the original file (e.g., `config.toml.backup.2026-01-01`)
7. Writes the migrated config

If the config is already at the latest version, the command reports success with no changes.

## `podkit sync`

Sync music and/or video collections to an iPod.

```bash
podkit sync [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Content type: `music` or `video` (repeatable; omit for both) |
| `-c, --collection <name>` | Collection name to sync (searches both music and video) |
| `-n, --dry-run` | Show what would be synced without making changes |
| `--quality <preset>` | Unified quality preset for audio and video: `max`, `high`, `medium`, `low` |
| `--audio-quality <preset>` | Audio-specific quality override: `max`, `high`, `medium`, `low` |
| `--video-quality <preset>` | Video-specific quality override: `max`, `high`, `medium`, `low` |
| `--encoding <mode>` | Encoding mode: `vbr` (default) or `cbr` |
| `--transfer-mode <mode>` | Transfer mode: `fast` (default), `optimized`, or `portable` |
| `--force-transfer-mode` | Re-process all tracks when changing transfer mode |
| `--filter <pattern>` | Only sync tracks matching pattern |
| `--no-artwork` | Skip artwork transfer |
| `--check-artwork` | Detect changed artwork by comparing fingerprints between syncs |
| `--skip-upgrades` | Skip file-replacement upgrades for changed source files |
| `--force-transcode` | Re-transcode all lossless-source tracks regardless of bitrate match |
| `--force-sync-tags` | Write sync tags to all matched transcoded tracks without re-transcoding |
| `--force-metadata` | Rewrite metadata on all matched tracks without re-transcoding or re-transferring files |
| `--delete` | Remove tracks from iPod that are not in the source |
| `--eject` | Eject iPod after successful sync |

### Examples

```bash
# Preview what would be synced
podkit sync --dry-run

# Sync music only
podkit sync -t music

# Sync video only
podkit sync -t video

# Sync multiple types explicitly
podkit sync -t music -t video

# Sync a specific collection
podkit sync -c jazz

# Sync music collection named "main"
podkit sync -t music -c main

# Sync to a specific device
podkit sync -d myipod

# Sync with lower quality to save space
podkit sync --quality medium

# Best quality — ALAC on supported devices
podkit sync --audio-quality max

# Set unified quality, but override audio specifically
podkit sync --quality medium --audio-quality high

# Remove orphaned tracks and eject when done
podkit sync --delete --eject

# Skip artwork transfer for faster sync
podkit sync --no-artwork
```

### Interruption Behaviour

Pressing Ctrl+C during sync triggers a graceful shutdown:

1. The current operation finishes (no partial files)
2. All completed tracks are saved to the iPod database
3. The process exits with code 130

Press Ctrl+C a second time to force-quit immediately. The database is saved periodically during sync (every 50 music tracks or 10 video transfers), so even a force-quit or crash loses at most a small batch of recent work.

If a sync is interrupted, run `podkit doctor` to check for orphaned files that may be wasting space on the iPod.

## `podkit device`

Device management commands. Running `podkit device` with no subcommand lists all configured devices.

All device subcommands use the global `-d, --device` flag to specify the device name or path.

```bash
podkit device [subcommand] [options]
```

### `podkit device list`

List all configured devices.

```bash
podkit device list
```

### `podkit device scan`

Scan for connected iPod devices. Shows volume name, UUID, size, and mount status for each detected iPod. Useful for finding the volume UUID needed to configure devices.

```bash
podkit device scan
podkit device scan --format json
```

### `podkit device add`

Detect a connected iPod and add it to the config.

```bash
podkit device add -d <name> [options]
```

| Option | Description |
|--------|-------------|
| `--path <path>` | Explicit path to iPod mount point (auto-detected if omitted) |
| `-y, --yes` | Skip confirmation prompts |
| `--quality <preset>` | Set transcoding quality: `max`, `high`, `medium`, `low` |
| `--audio-quality <preset>` | Set audio quality (overrides `--quality`) |
| `--video-quality <preset>` | Set video quality: `max`, `high`, `medium`, `low` |
| `--encoding <mode>` | Set encoding mode: `vbr` or `cbr` |
| `--artwork` / `--no-artwork` | Enable or disable artwork sync for this device |

```bash
# Auto-detect connected iPod
podkit device add -d classic

# Specify mount point explicitly
podkit device add -d classic --path /Volumes/IPOD

# Add with quality settings
podkit device add -d nano --quality medium --no-artwork

# Add with best quality (ALAC on supported devices)
podkit device add -d classic --audio-quality max --video-quality high
```

### `podkit device remove`

Remove a device from the config.

```bash
podkit device remove -d <name>
```

| Option | Description |
|--------|-------------|
| `--confirm` | Skip confirmation prompt |

### `podkit device set`

Update settings on an existing device.

```bash
podkit device set -d <name> [options]
```

| Option | Description |
|--------|-------------|
| `--quality <preset>` | Set transcoding quality: `max`, `high`, `medium`, `low` |
| `--audio-quality <preset>` | Set audio quality (overrides `--quality`) |
| `--video-quality <preset>` | Set video quality: `max`, `high`, `medium`, `low` |
| `--encoding <mode>` | Set encoding mode: `vbr` or `cbr` |
| `--artwork` / `--no-artwork` | Enable or disable artwork sync |
| `--clear-quality` | Remove quality setting (use global default) |
| `--clear-audio-quality` | Remove audio quality setting |
| `--clear-video-quality` | Remove video quality setting |
| `--clear-artwork` | Remove artwork setting (use global default) |

```bash
# Set quality on a device
podkit device set -d classic --quality max

# Set audio and video quality separately
podkit device set -d nano --audio-quality medium --video-quality low

# Disable artwork
podkit device set -d nano --no-artwork

# Reset to global defaults
podkit device set -d classic --clear-quality --clear-artwork
```

### `podkit device default`

Set or show the default device.

```bash
podkit device default [-d <name>]
```

| Option | Description |
|--------|-------------|
| `--clear` | Clear the default device |

```bash
# Show current default
podkit device default

# Set default device
podkit device default -d classic

# Clear the default
podkit device default --clear
```

### `podkit device info`

Display device configuration and live status (storage, track count, model).

```bash
podkit device info [-d <name>]
```

```bash
# Show default device info
podkit device info

# Show info for a named device
podkit device info -d classic
```

### `podkit device music`

Show music on an iPod. By default, displays summary stats (track/album/artist counts and file type breakdown).

```bash
podkit device music [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `--tracks` | List all tracks (detailed view) |
| `--albums` | List albums with track counts |
| `--artists` | List artists with album/track counts |
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show with `--tracks` (see [Display Fields](#display-fields)) |

```bash
# Show music stats (default)
podkit device music

# List all tracks
podkit device music --tracks

# Browse by album or artist
podkit device music --albums
podkit device music --artists

# Export as JSON
podkit device music --json
podkit device music --tracks --json

# Show specific fields
podkit device music --tracks --fields title,artist,album,genre,year
```

### `podkit device video`

Show video content on an iPod. By default, displays summary stats.

```bash
podkit device video [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `--tracks` | List all tracks (detailed view) |
| `--albums` | List albums with track counts |
| `--artists` | List artists with album/track counts |
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show with `--tracks` (see [Display Fields](#display-fields)) |

### `podkit device clear`

Remove content from the iPod.

```bash
podkit device clear [-d <name>] [options]
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
podkit device reset [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `--dry-run` | Show what would happen without making changes |

### `podkit device reset-artwork`

Wipe all artwork from the iPod and clear artwork sync tags. The next `podkit sync` will re-add artwork from your source collection.

This is also available through the doctor workflow as `podkit doctor --repair artwork-reset`. See [iPod Health Checks](/user-guide/devices/doctor#repairing-artwork-corruption) for when to use each approach.

```bash
podkit device reset-artwork [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `--dry-run` | Show what would happen without making changes |

### `podkit device eject`

Safely unmount an iPod device. Also available as `podkit device unmount`.

```bash
podkit device eject [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force unmount even if device is busy |

### `podkit device mount`

Mount an iPod device.

```bash
podkit device mount [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `--disk <identifier>` | Disk identifier (e.g., `/dev/disk4s2`) |
| `--dry-run` | Show mount command without executing |

```bash
# Mount default device
podkit device mount

# Mount by name
podkit device mount -d classic

# Mount using disk identifier
podkit device mount --disk /dev/disk4s2

# Show what mount command would run
podkit device mount --dry-run
```

### `podkit device init`

Initialize an iPod database on a device. Use this for blank or corrupted iPods.

```bash
podkit device init [-d <name>] [options]
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
podkit collection list [-t <type>]
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Filter by type: `music` or `video` |

```bash
# List all collections
podkit collection list

# List only music collections
podkit collection list -t music
```

### `podkit collection add`

Add a new collection to the config.

```bash
podkit collection add -t <type> -c <name> --path <path>
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Collection type: `music` or `video` |
| `-c, --collection <name>` | Collection name (letters, numbers, hyphens, underscores) |
| `--path <path>` | Path to the collection directory |

```bash
# Add a music collection
podkit collection add -t music -c main --path /Volumes/Media/music

# Add a video collection
podkit collection add -t video -c movies --path /Volumes/Media/movies
```

### `podkit collection remove`

Remove a collection from the config.

```bash
podkit collection remove -c <name>
```

| Option | Description |
|--------|-------------|
| `-c, --collection <name>` | Collection name to remove |
| `-y, --yes` | Skip confirmation prompt |

### `podkit collection default`

Set or show the default collection for a type.

```bash
podkit collection default -t <type> [-c <name>]
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Collection type: `music` or `video` |
| `-c, --collection <name>` | Collection name (omit to show current default) |
| `--clear` | Clear the default for this type |

```bash
# Show default music collection
podkit collection default -t music

# Set default music collection
podkit collection default -t music -c main

# Set default video collection
podkit collection default -t video -c movies

# Clear default
podkit collection default -t music --clear
```

### `podkit collection info`

Display collection details.

```bash
podkit collection info -c <name>
```

### `podkit collection music`

Show music in a collection. By default, displays summary stats (track/album/artist counts and file type breakdown). Scans the source directory or Subsonic server.

```bash
podkit collection music [-c <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-c, --collection <name>` | Collection name (uses default if omitted) |
| `--tracks` | List all tracks (detailed view) |
| `--albums` | List albums with track counts |
| `--artists` | List artists with album/track counts |
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show with `--tracks` (see [Display Fields](#display-fields)) |

### `podkit collection video`

Show videos in a collection. By default, displays summary stats.

```bash
podkit collection video [-c <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-c, --collection <name>` | Collection name (uses default if omitted) |
| `--tracks` | List all tracks (detailed view) |
| `--albums` | List albums with track counts |
| `--artists` | List artists with album/track counts |
| `--format <fmt>` | Output format: `table`, `json`, `csv` (default: `table`) |
| `--fields <list>` | Comma-separated fields to show with `--tracks` (see [Display Fields](#display-fields)) |

## `podkit doctor`

Run health checks on an iPod and optionally repair detected issues.

```bash
podkit doctor [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--repair <check-id>` | Repair a specific check by ID, e.g. `artwork-rebuild` (requires `-d`; some checks also need `-c`) |
| `--dry-run` | Preview repair without modifying the iPod |
| `--format csv` | Export orphan file list as CSV (path and size) |

### Examples

```bash
# Run all health checks
podkit doctor

# Check a specific device
podkit doctor -d myipod

# Repair corrupted artwork (device and collection are required)
podkit doctor -d myipod -c main --repair artwork-rebuild

# Clear all artwork without a source collection
podkit doctor --repair artwork-reset

# Preview what repair would do
podkit doctor -d myipod -c main --repair artwork-rebuild --dry-run

# Verbose output with orphan breakdown by directory and extension
podkit doctor --verbose

# Export orphan file list as CSV
podkit doctor --format csv > orphans.csv
```

### Interruption Behaviour

Pressing Ctrl+C during a repair triggers a graceful shutdown — partial repair progress is saved before exiting.

### Health Checks

| Check | Description | Repair |
|-------|-------------|--------|
| Artwork Integrity | Verifies ArtworkDB offsets are within .ithmb file bounds | `--repair artwork-rebuild -c <collection>` |
| Artwork Reset | Clears all artwork without needing a source collection | `--repair artwork-reset` |
| Orphan Files | Detects unreferenced files in iPod_Control/Music that waste storage | `--repair orphan-files` |

See [iPod Health Checks](/user-guide/devices/doctor) for a full guide to using doctor, including when to use each repair option.

## `podkit eject`

Safely unmount an iPod device. This is a shortcut for `podkit device eject`. Also available as `podkit unmount`.

```bash
podkit eject [-d <name>] [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force unmount even if device is busy |

```bash
# Eject default device
podkit eject

# Eject named device
podkit eject -d classic

# Force eject
podkit eject --force
```

## `podkit mount`

Mount an iPod device. This is a shortcut for `podkit device mount`.

```bash
podkit mount [-d <name>] [options]
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

## `podkit completions`

Generate and install shell completion scripts for tab completion support. The completions are generated from the actual CLI command tree, so they stay in sync automatically.

Completions include:

- **Subcommands and flags** — all commands, subcommands, aliases, and options
- **Static argument values** — options like `--quality`, `--type`, `--encoding`, and `--format` offer their known values (e.g. `max`, `high`, `medium`, `low`)
- **Dynamic argument values** — `--device` and `--collection` complete with names from your config file

### `podkit completions install`

Detect your shell and show setup instructions. This is the easiest way to get started.

```bash
podkit completions install
```

| Option | Description |
|--------|-------------|
| `--append` | Append the setup lines to your shell config file automatically |
| `--alias <command>` | Create a dev shell function wrapping this command (e.g. `"bun run podkit"`) |
| `--name <name>` | Name for the dev function (default: `pk`) |

The `install` subcommand detects your shell from `$SHELL` and finds the correct config file:

| Shell | Config file |
|-------|------------|
| zsh | `~/.zshrc` |
| bash (macOS) | `~/.bash_profile` |
| bash (Linux) | `~/.bashrc` |

```bash
# Show what to add and where
podkit completions install

# Do it automatically
podkit completions install --append
```

### `podkit completions zsh`

Print the zsh completion script to stdout.

```bash
podkit completions zsh
```

| Option | Description |
|--------|-------------|
| `--cmd <command>` | CLI command for dynamic completions (default: `podkit`). Use when the binary has a different name, e.g. `--cmd podkit-dev`. |

### `podkit completions bash`

Print the bash completion script to stdout.

```bash
podkit completions bash
```

| Option | Description |
|--------|-------------|
| `--cmd <command>` | CLI command for dynamic completions (default: `podkit`). |

### What Gets Completed

| Context | Completions |
|---------|-------------|
| `podkit <TAB>` | Subcommands: `init`, `sync`, `device`, `collection`, `eject`, `mount` |
| `podkit sync --<TAB>` | Flags: `--dry-run`, `--quality`, `--type`, `--filter`, ... |
| `podkit sync --quality <TAB>` | Values: `max`, `high`, `medium`, `low` |
| `podkit sync --type <TAB>` | Values: `music`, `video` |
| `podkit sync --encoding <TAB>` | Values: `vbr`, `cbr` |
| `podkit device music --format <TAB>` | Values: `table`, `json`, `csv` |
| `podkit sync -d <TAB>` | Device names from config |
| `podkit sync -c <TAB>` | Collection names from config |

### Examples

```bash
# Quickest setup — auto-detect shell and append to config
podkit completions install --append

# See what would be added first
podkit completions install

# Activate in current shell session (temporary)
source <(podkit completions zsh)

# Test completions after setup
podkit <TAB>                    # Shows subcommands
podkit sync --quality <TAB>     # Shows: max high medium low
podkit sync -c <TAB>            # Shows collection names from config
podkit sync -d <TAB>            # Shows device names from config
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
| `compilation` | Whether track is part of a compilation album |
| `format` | Audio format |
| `bitrate` | Bitrate |

**Default fields:** `title`, `artist`, `album`, `duration`

## See Also

- [Configuration](/user-guide/configuration) - Config file options
- [Quick Start](/getting-started/quick-start) - Getting started guide
- [Config File Reference](/reference/config-file) - Complete config schema
