---
id: TASK-241
title: Create changeset for mass-storage device support
status: Done
assignee: []
created_date: '2026-03-24 23:52'
updated_date: '2026-03-25 01:15'
labels:
  - release
milestone: 'Mass Storage Device Support: Extended'
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All mass-storage device support work across the Echo Mini milestone is uncommitted on main. A changeset is needed before committing since this touches user-facing packages (`podkit` and `@podkit/core`).

**Packages affected:**
- `podkit` (CLI) — new `--type` option on `device add`, mass-storage support in device info/music/video/scan, safety gates on init/reset/clear, video sync gate, capability overrides in config
- `@podkit/core` — `DeviceAdapter` interface, `MassStorageAdapter`, `IpodDeviceAdapter`, `resolveDeviceCapabilities`, `DeviceTrack` type changes in sync types/handlers/upgrades

**Bump level:** Minor (new feature, no breaking changes to existing iPod workflows)

Run `bunx changeset` and describe the mass-storage device support feature.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Changeset created covering podkit and @podkit/core
- [x] #2 Changeset describes mass-storage device support feature
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed (2026-03-25)

Changeset created at `.changeset/mass-storage-device-support.md` covering `podkit` (minor) and `@podkit/core` (minor). Describes the full mass-storage device support feature including DeviceAdapter interface, MassStorageAdapter, device presets, CLI commands, video sync support, and configuration.
<!-- SECTION:NOTES:END -->
