---
id: TASK-251
title: Configurable content path prefixes for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-28 20:44'
updated_date: '2026-03-28 21:16'
labels:
  - mass-storage
  - config
  - enhancement
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-utils.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/presets.ts
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/commands/open-device.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add configurable directory prefixes for where content is placed on mass-storage devices. Currently paths are hardcoded (`Music/`, `Video/Movies/`, `Video/{show}/`). This adds `musicDir`, `moviesDir`, and `tvShowsDir` config options with device-type defaults, user overrides, and automatic file migration when paths change.

## Design Decisions (from grill-me session)

- **Scope:** Only the top-level prefix is configurable, not the internal folder hierarchy
- **Config shape:** Flat keys on device config: `musicDir`, `moviesDir`, `tvShowsDir`
- **Defaults per device type:** generic/rockbox: `Music`, `Movies`, `TV Shows`; echo-mini: `/` for music, n/a for video
- **Root representation:** `""`, `"."`, `"/"` all resolve to root. `/` is documented form.
- **Normalization:** Strip leading/trailing slashes
- **Validation:** No two content type prefixes can be identical (error). Video paths on non-video device → warn. Content paths on iPod → warn.
- **Manifest v2:** Stores active `contentPaths`. On prefix change, files moved before sync.
- **TV shows default changes** from `Video/{show}/` to `Video/Shows/{show}/`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 generateTrackPath and generateVideoPath accept configurable directory prefixes
- [x] #2 Device presets include default content paths per device type
- [x] #3 Root representations normalize correctly
- [x] #4 Config loader parses moviesDir and tvShowsDir
- [x] #5 Config validates no duplicate resolved prefixes
- [x] #6 Manifest v2 with contentPaths and file migration on change
- [x] #7 CLI device commands accept --movies-dir and --tv-shows-dir flags
- [x] #8 Unit tests cover path generation, normalization, validation, migration
- [x] #9 Typecheck passes and changeset created
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented configurable content path prefixes for mass-storage devices.

## Core changes (`@podkit/core`)
- `ContentPaths` interface with `musicDir`, `moviesDir`, `tvShowsDir`
- `normalizeContentDir()` — strips slashes, normalizes `""`, `"."`, `"/"` to root
- `normalizeContentPaths()` — merges partials with defaults
- `validateContentPaths()` — rejects duplicate prefixes
- `generateTrackPath()` / `generateVideoPath()` accept configurable dir params
- Device presets (`DEVICE_PRESETS`) now include `contentPaths` alongside capabilities
- Echo Mini defaults to root (`""`) for music; generic/Rockbox default to `Music/`, `Video/Movies/`, `Video/Shows/`
- `MassStorageAdapter` uses configured paths for scanning, adding, removing, and TV show detection
- Manifest v2 stores active `contentPaths`; v1 manifests upgrade transparently on save
- Automatic file migration when content path prefixes change between sessions
- Empty-directory cleanup works correctly for root-mode devices

## Config/CLI changes (`podkit`)
- `moviesDir` and `tvShowsDir` added to `DeviceConfig`, config loader, and config writer
- Env vars: `PODKIT_MOVIES_DIR`, `PODKIT_TV_SHOWS_DIR`
- CLI flags: `--movies-dir`, `--tv-shows-dir` on `device add` and `device set`
- Config validation: duplicate prefix detection, iPod/non-video warnings
- `musicDir` validation updated to accept root values

## Design decisions
- Content paths live in `DEVICE_PRESETS` (not separate constants) — single source of truth
- TV shows default path changed from `Video/{show}/` to `Video/Shows/{show}/`
- Manifest v1→v2 migration assumes current defaults (no false moves)
- Migration takes snapshot of managed files before iterating to avoid mutation issues
<!-- SECTION:FINAL_SUMMARY:END -->
