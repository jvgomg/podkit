---
title: "ADR-008: Multi-Collection Device Config"
description: Decision on configuration structure for multiple collections and devices.
sidebar:
  order: 9
---

# ADR-008: Multi-Collection and Multi-Device Configuration

## Status

**Proposed** (2026-03-08)

## Context

The current podkit configuration model assumes a single music source and single iPod device. Real-world users often have:

- **Multiple music collections** (main library, DJ sets, podcasts)
- **Multiple video collections** (movies, TV shows)
- **Multiple iPods** (car iPod, gym iPod, archive iPod)

Additionally, the current CLI has separate `sync` and `video-sync` commands, creating an inconsistent user experience.

## Decision

**Separate `[music.*]` and `[video.*]` namespaces with device-scoped settings**

### Config Schema

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

# Devices
[devices.terapod]
volumeUuid = "ABC-123"
quality = "high"
videoQuality = "high"
artwork = true

[devices.terapod.transforms.ftintitle]
enabled = true

[devices.nano]
volumeUuid = "DEF-456"
quality = "low"
artwork = false

# Defaults
[defaults]
music = "main"
video = "movies"
device = "terapod"
```

### Key Design Decisions

1. **Separate music/video namespaces** at the top level
2. **Quality and transforms scoped to devices** - Collections define *what*, devices define *how*
3. **Named defaults** in `[defaults]` section

### CLI Command Structure

```bash
# Unified sync command
podkit sync                          # sync all defaults
podkit sync music                    # sync default music only
podkit sync video                    # sync default video only
podkit sync -c <name>                # sync matching collections
podkit sync --device <name|path>     # sync to specific device

# Device management
podkit device                        # list configured devices
podkit device add <name>             # detect connected iPod
podkit device info <name>            # show device details

# Collection management
podkit collection                    # list all collections
podkit collection music              # list music collections
podkit collection add music <name> <path>
```

### Backwards Compatibility

Existing configs with top-level `source`, `device`, `quality` are migrated:

```toml
# Old format
source = "/path/to/music"
device = "/media/ipod"
quality = "high"
```

Interpreted as:

```toml
[music.default]
path = "/path/to/music"

[devices.default]
quality = "high"

[defaults]
music = "default"
device = "default"
```

## Consequences

### Positive

- Clear separation of concerns (collections vs devices)
- Scalable to complex multi-library setups
- Unified CLI for music and video
- Device-specific quality/transforms

### Negative

- More complex config file for advanced setups
- Migration needed for existing configs

## Related Decisions

- [ADR-004](/developers/adr/adr-004-collection-sources): Collection Source Abstraction
- [ADR-007](/developers/adr/adr-007-subsonic-collection-source): Subsonic Collection Source
