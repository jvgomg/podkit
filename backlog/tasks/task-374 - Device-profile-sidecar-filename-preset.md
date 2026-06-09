---
id: TASK-374
title: Device-profile sidecar filename preset
status: Done
assignee: []
created_date: '2026-06-03 08:47'
updated_date: '2026-06-09 18:51'
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed as won't-do (no code changes).

## Rationale

Auditing `devices/*.md`: rockbox is the only documented sidecar-primary device. Its first search-order filename IS `cover.jpg` (`devices/rockbox.md:71-76`). Every other documented profile (echo-mini, sony walkman series, ipod) has `sidecar: false`. The "Android-derived players prefer folder.jpg" claim in the original task has no concrete candidate in the roadmap.

Adding a `sidecarFilename` field to `DeviceCapabilities` now would be designing for hypothetical future requirements — call sites (3: `SIDECAR_FILENAME` const, `rekeyPendingWrites`, `writeSidecar`) make this a ~30-min change when a real second sidecar device appears. Carrying it as backlog noise costs more than the deferred work.

## Reopen when

A documented device profile with `sidecar: true` AND a non-`cover.jpg` filename lands in `devices/`, or a user requests support for a player that uses `folder.jpg`/`AlbumArt.jpg`/etc. as its primary sidecar convention.

## Pair task
- TASK-375 (sync-time sidecar cleanup + walker scope broadened) shipped in commit fa589717.
<!-- SECTION:FINAL_SUMMARY:END -->
