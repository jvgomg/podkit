---
id: TASK-055
title: Design init/setup command UX for config and device initialization
status: Done
assignee: []
created_date: '2026-02-26 00:22'
updated_date: '2026-03-09 22:21'
labels:
  - cli
  - ux
  - design
  - initialization
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design the command structure and user experience for the various "initialization" operations in podkit.

## Problem

There are multiple distinct "init" operations that need clear, intuitive commands:

| Operation | What it does | Destructive? |
|-----------|--------------|--------------|
| **Config init** | Create `~/.config/podkit/config.toml` template | No |
| **Device discovery** | Connect to iPod, read model/capacity/state, optionally save to config | No |
| **Database init** | Create iTunesDB + folder structure on empty but formatted iPod | Creates files |
| **Format + init** | Wipe disk, create filesystem, then create database | Yes - wipes everything |

Currently `podkit init` creates the config file, but we need to add device initialization capabilities.

## Design Questions

### 1. Device Discovery Flow

When connecting an iPod for the first time, should podkit:
- Auto-detect model and store in config?
- Prompt about quality settings based on device capacity?
- Check if database exists and offer to create it?

Could be an interactive "setup wizard":
```
$ podkit setup /Volumes/IPOD

Detected: iPod Classic 160GB (6th gen)
Database: Not found
Free space: 147 GB

This iPod needs to be initialized before first use.
Initialize now? [Y/n]
```

### 2. Format Scenarios

When would someone need format?
- Repurposing an old iPod that was used with iTunes
- Fixing a corrupted database
- Starting completely fresh

This is destructive enough to warrant explicit command + confirmation.

### 3. Command Structure Options

**Option A: Subcommands**
```bash
podkit init                    # Config file (current behavior)
podkit setup <device>          # Interactive device discovery + optional DB init
podkit device init <path>      # Create database (non-interactive)
podkit device format <path>    # Format disk + create database (destructive)
podkit device info <path>      # Detailed device info
```

**Option B: Flat commands**
```bash
podkit init                    # Config
podkit init-device <path>      # Create database
podkit format-device <path>    # Format + create
podkit setup <path>            # Interactive wizard
```

**Option C: Rename config init**
```bash
podkit config init             # Config file
podkit device init <path>      # Create database
podkit device format <path>    # Format + create
podkit device setup <path>     # Interactive wizard
```

### 4. Key UX Question

Should "first time connecting an iPod" be:
- A guided interactive experience (`podkit setup`)
- Individual commands the user runs as needed
- Both (wizard available, but commands work standalone)

## Considerations

- Discoverability: new users should find the right command easily
- Safety: destructive operations need clear warnings
- Flexibility: power users want non-interactive options
- Consistency: command naming should follow a logical pattern
- Current state: `podkit init` already exists for config, changing it is a breaking change

## Related Tasks

- TASK-052: Add iPod initialization command for fresh devices (blocked by this decision)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Command structure decided and documented
- [ ] #2 UX for each init operation defined
- [ ] #3 Interactive vs non-interactive approach decided
- [ ] #4 Breaking changes to existing commands identified
- [ ] #5 ADR created if significant architectural decision
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded by TASK-081 - Enhanced device onboarding and reset. Design decisions captured in the new epic after discussion about user journeys, command structure, and UX flow.
<!-- SECTION:NOTES:END -->
