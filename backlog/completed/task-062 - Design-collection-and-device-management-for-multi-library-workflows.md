---
id: TASK-062
title: Design collection and device management for multi-library workflows
status: Done
assignee: []
created_date: '2026-02-26 14:26'
updated_date: '2026-03-08 23:47'
labels:
  - design
  - ux
  - config
  - performance
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Current scanning is slow for large collections (1,414 tracks took noticeable time). Additionally, the current config model assumes one source and one device, but users may have:
- Multiple music collections (e.g., main library, DJ sets, podcasts)
- Multiple iPods (e.g., car iPod, gym iPod, archive iPod)

## Goals

1. **Fast scanning** — cache collection metadata, only rescan changed files
2. **Named collections** — define and reference multiple source directories
3. **Named devices** — define and reference multiple iPods
4. **Intuitive UX** — simple commands for common workflows

## Design Questions

### 1. Collection Caching

How to detect changes without full rescan?
- File modification times
- Directory watch / fsevents
- Hash-based (slower but accurate)
- SQLite cache of metadata

Reference: Does `music-metadata` or similar have caching abstractions?

### 2. Config Structure

```toml
# Current (single source/device)
source = "/path/to/music"
device = "/Volumes/iPod"

# Proposed (named collections and devices)
[collections.main]
path = "/Volumes/Media/music/library"

[collections.dj]
path = "/Volumes/Media/dj-sets"

[devices.terapod]
mount = "/Volumes/TERAPOD"
model = "iPod Video"

[devices.nano]
mount = "/Volumes/NANO"
model = "iPod Nano"

[defaults]
collection = "main"
device = "terapod"
```

### 3. Command UX

```bash
# Use defaults
podkit sync

# Explicit collection and device
podkit sync --collection dj --device nano
podkit sync -c dj -d nano

# List configured collections/devices
podkit collections list
podkit devices list

# Add new collection
podkit collections add workout /path/to/workout/music
```

### 4. Related Tasks

- TASK-058: CLI command clarity (status/list ambiguity)
- TASK-055: Design init/setup command UX

## Questions to Resolve

1. How to handle collection caching? (SQLite, JSON, filesystem mtime?)
2. Should collections track their own sync state per device?
3. How to auto-detect connected iPods vs configured ones?
4. Should we support "profiles" (collection + device + quality preset)?

## Outcome

This task is for **design discussion**, not implementation. Output should be:
- ADR documenting the chosen approach
- Updated config schema design
- CLI command structure proposal
- Caching strategy decision
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Collection caching strategy decided
- [x] #2 Multi-collection config schema designed
- [x] #3 Multi-device config schema designed
- [x] #4 CLI command structure proposed
- [x] #5 ADR created documenting decisions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Related Work

TASK-070 adds Subsonic collection source support. When implementing multi-source support, consider that sources can now be:
- Local directories (DirectoryAdapter)
- Remote Subsonic servers (SubsonicAdapter)

The config structure should accommodate both source types.

## Config Schema Design (2026-03-08)

Agreed on schema structure:

```toml
# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.dj]
path = "/Volumes/Media/dj-sets"

[music.work]
type = "subsonic"
url = "https://music.work.com"
username = "james"

# Video collections
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"

# Devices (with quality/transform settings)
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"
videoQuality = "high"
artwork = true

[devices.terapod.transforms.ftintitle]
enabled = true
format = "feat. {}"

[devices.nano]
volumeUuid = "DEF-456"
volumeName = "NANO"
quality = "low"
artwork = false

# Defaults
[defaults]
music = "main"
video = "movies"
device = "terapod"
```

### Key decisions:

1. **Separate music/video namespaces** — `[music.*]` and `[video.*]` top-level sections, not a `type` property
2. **Quality/transforms scoped to devices** — Collections define *what* to sync, devices define *how*
3. **Device settings** — `quality` (music), `videoQuality` (video), `artwork`, `transforms`
4. **Collection types** — Default is directory, `type = "subsonic"` for remote sources
5. **Contextual `-c` flag** — `sync -c X` looks in `[music.*]`, `video sync -c X` looks in `[video.*]`

## CLI Command Structure (2026-03-08)

### Sync (unified command)
```bash
podkit sync                          # sync all defaults (music + video)
podkit sync music                    # sync default music collection only
podkit sync video                    # sync default video collection only
podkit sync -c <name>                # sync matching collections (music + video)
podkit sync -c <name> music          # sync specific music collection
podkit sync -c <name> video          # sync specific video collection
podkit sync -d <device>              # sync to specific device
podkit sync --dry-run                # preview changes
```

### Device management
```bash
podkit device                        # list devices
podkit device add <name>             # add connected iPod
podkit device remove <name>          # remove device
podkit device show <name>            # show device config
```

### Collection management
```bash
podkit collection                    # list all collections
podkit collection music              # list music collections
podkit collection video              # list video collections
podkit collection add music <name> <path>
podkit collection add video <name> <path>
podkit collection add music <name> --subsonic
podkit collection remove <name>      # remove (searches both namespaces)
podkit collection show <name>        # show collection config
```

### Device-scoped commands
```bash
podkit status [-d <device>]
podkit list [-d <device>]
podkit clear music|video [-d <device>]
podkit reset [-d <device>]
podkit mount [-d <device>]
podkit eject [-d <device>]
```

### Key decisions:
1. **Unified sync** — `podkit sync` handles both music and video, optional `music`/`video` arg to scope
2. **Singular nouns** — `device`, `collection` (not plural)
3. **`-c` searches both namespaces** — `sync -c foo` syncs music.foo AND video.foo if both exist
4. **`-d` for device** — all device-interacting commands accept `-d <device>`
5. **Subcommands for management** — `device add`, `collection add music`, etc.

## Completion (2026-03-08)

Design completed. Caching strategy extracted to TASK-071.

Implementation tracked in TASK-072 with subtasks:
- TASK-072.01: Define TypeScript types
- TASK-072.02: Update config loader
- TASK-072.03: Backwards compatibility
- TASK-072.04: Unified sync command
- TASK-072.05: Device management command
- TASK-072.06: Collection management command
- TASK-072.07: Add -d flag to commands
- TASK-072.08: Device-scoped settings in sync
- TASK-072.09: Tests
<!-- SECTION:NOTES:END -->
