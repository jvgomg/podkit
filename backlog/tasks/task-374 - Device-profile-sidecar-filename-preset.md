---
id: TASK-374
title: Device-profile sidecar filename preset
status: To Do
assignee: []
created_date: '2026-06-03 08:47'
labels:
  - enhancement
  - artwork
  - sidecar
  - device-presets
  - capabilities
dependencies:
  - TASK-370
references:
  - packages/device-types/src/index.ts
  - packages/devices-mass-storage/src/preset.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
priority: low
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-370 lands sidecar device-write with `cover.jpg` hardcoded as the peer filename. This matches the Rockbox default but isn't universal:

- Rockbox accepts `cover.jpg`, `cover.bmp`, `folder.jpg`, `<album>.jpg`, configurable via the WPS theme.
- Some Android-derived players prefer `folder.jpg` or `AlbumArt.jpg`.
- Future devices may want a per-track variant like `<basename>.jpg`.

The right shape is a `sidecarFilename` (or similar) field on `DeviceCapabilities` / device presets, defaulting to `cover.jpg`. Per-album-dir vs per-track-peer probably also belongs in the preset.

## Scope

1. Add `sidecarFilename: string` (default `'cover.jpg'`) and probably `sidecarPlacement: 'album-dir' | 'peer-to-audio'` to `DeviceCapabilities` (`@podkit/device-types`).
2. Wire `MassStorageAdapter.writeSidecar` to read it from the device's capabilities instead of hardcoding.
3. Update each built-in preset (`@podkit/devices-mass-storage`) to declare its sidecar convention. Rockbox = `cover.jpg`, etc.
4. Test fixture: sweep a non-default preset (e.g. one declaring `folder.jpg`) in the artwork matrix.
5. doc-012 § sidecar — document the new field + default.

## Why deferred

TASK-370 closes the rockbox case with a sensible default. Generalising to a preset adds a small bit of API surface that only matters when a second device profile wants something different. File-and-defer until the second device appears or a user requests it.
<!-- SECTION:DESCRIPTION:END -->
