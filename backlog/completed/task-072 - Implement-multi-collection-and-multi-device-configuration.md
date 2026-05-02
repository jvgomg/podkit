---
id: TASK-072
title: Implement multi-collection and multi-device configuration
status: Done
assignee: []
created_date: '2026-03-08 23:46'
updated_date: '2026-03-09 12:43'
labels:
  - config
  - cli
  - refactor
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Implement the configuration and CLI changes designed in ADR-008 to support multiple music/video collections and multiple iPod devices.

## Scope

This task covers the full implementation of:
1. New config schema with `[music.*]`, `[video.*]`, `[devices.*]` namespaces
2. Unified `sync` command handling both music and video
3. New `device` and `collection` management commands
4. Device-scoped quality and transform settings
5. Backwards compatibility for existing configs

## References

- [ADR-008](docs/adr/ADR-008-multi-collection-device-config.md): Full design specification
- TASK-062: Original design discussion
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New config schema types defined and validated
- [x] #2 Config loader parses new schema correctly
- [ ] #3 Backwards compatibility with old config format
- [x] #4 Unified `sync` command with music/video subcommands
- [x] #5 `-c` and `-d` flags work on sync command
- [x] #6 `device` command (list, add, remove, show) implemented
- [x] #7 `collection` command (list, add, remove, show) implemented
- [x] #8 Device-scoped quality settings applied during sync
- [x] #9 Device-scoped transforms applied during sync
- [x] #10 All existing commands accept `-d` flag
- [x] #11 Unit tests for config parsing
- [x] #12 Integration tests for new CLI commands
- [ ] #13 E2E test for multi-device workflow
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation Complete

Successfully implemented multi-collection and multi-device configuration as designed in ADR-008.

## Summary of Changes

### Phase 1: Config Foundation
- **TASK-072.01**: Added new TypeScript types (`MusicCollectionConfig`, `VideoCollectionConfig`, `DeviceConfig`, `DefaultsConfig`)
- **TASK-072.02**: Updated config loader to parse `[music.*]`, `[video.*]`, `[devices.*]`, `[defaults]` sections
- **TASK-072.03**: No backwards compatibility - legacy configs are rejected with `LegacyConfigError` (per user request)

### Phase 2: CLI Commands
- **TASK-072.04**: Unified sync command with music/video subcommands and `-c`/`-d` flags
- **TASK-072.05**: Implemented `podkit device` command (list, add, remove, show)
- **TASK-072.06**: Implemented `podkit collection` command (list, add, remove, show)
- **TASK-072.07**: Added `-d` flag to all device-scoped commands (status, list, clear, reset, mount, eject)

### Phase 3: Core Integration
- **TASK-072.08**: Device-scoped quality, transforms, and artwork settings applied in sync engine

### Phase 4: Testing
- **TASK-072.09**: 65+ new tests added covering config parsing, commands, and settings resolution

## New CLI Features

```bash
# Device management
podkit device                    # list configured devices
podkit device add <name>         # detect and add iPod
podkit device remove <name>      # remove device
podkit device show <name>        # show device details

# Collection management
podkit collection                # list all collections
podkit collection list music     # list music only
podkit collection add music <name> <path>
podkit collection add video <name> <path>
podkit collection remove <name>
podkit collection show <name>

# Unified sync
podkit sync                      # sync all (music + video)
podkit sync music                # sync music only
podkit sync video                # sync video only
podkit sync -c <name>            # sync specific collection
podkit sync -d <device>          # sync to specific device

# Device flag on all commands
podkit status -d <device>
podkit list -d <device>
podkit clear music -d <device>
podkit reset -d <device>
podkit mount -d <device>
podkit eject -d <device>
```

## Config Format (ADR-008)

```toml
[music.main]
path = "/path/to/music"

[video.movies]
path = "/path/to/movies"

[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"
artwork = true

[devices.terapod.transforms.ftintitle]
enabled = true

[defaults]
music = "main"
video = "movies"
device = "terapod"
```

## Notes

- Legacy config format is NOT supported - old configs will receive `LegacyConfigError` instructing users to update
- E2E test for multi-device workflow not yet added (would require test infrastructure changes)
<!-- SECTION:FINAL_SUMMARY:END -->
