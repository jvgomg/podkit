---
id: TASK-062
title: Design collection and device management for multi-library workflows
status: To Do
assignee: []
created_date: '2026-02-26 14:26'
updated_date: '2026-03-08 16:17'
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
- [ ] #2 Multi-collection config schema designed
- [ ] #3 Multi-device config schema designed
- [ ] #4 CLI command structure proposed
- [ ] #5 ADR created documenting decisions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Related Work

TASK-070 adds Subsonic collection source support. When implementing multi-source support, consider that sources can now be:
- Local directories (DirectoryAdapter)
- Remote Subsonic servers (SubsonicAdapter)

The config structure should accommodate both source types.
<!-- SECTION:NOTES:END -->
