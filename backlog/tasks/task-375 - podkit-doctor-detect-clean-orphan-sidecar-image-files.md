---
id: TASK-375
title: 'podkit doctor: detect + clean orphan sidecar image files'
status: To Do
assignee: []
created_date: '2026-06-03 08:47'
labels:
  - enhancement
  - doctor
  - artwork
  - sidecar
  - mass-storage
dependencies:
  - TASK-370
references:
  - packages/podkit-core/src/diagnostics/
  - packages/podkit-core/src/artwork/repair.ts
  - docs/user-guide/devices/doctor.md
priority: low
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Once TASK-370 lands and podkit writes peer `cover.jpg` (or whatever the device-profile sidecar filename is — see TASK-374), the device gains a new failure mode: stale `cover.jpg` files left behind when audio tracks are removed/relocated without their album.

Today `podkit doctor` does not know about sidecar artwork files. After TASK-370, an album removed from the source (or moved by a path-template change) could leave its `cover.jpg` sitting on the device pointing at nothing — wasted bytes + a confusing user experience if they browse the filesystem.

Mirror existing orphan checks: `cleanupOrphanedIthmb` in `artwork/repair.ts` already handles iPod `.ithmb` orphans after a libgpod save.

## Scope

1. New diagnostic check in `podkit-core/src/diagnostics/checks/` — `sidecar-orphan-images.ts` (or fold into an existing artwork diagnostic). Walks the mass-storage music tree, collects every sidecar filename matching the device preset (cover.jpg / folder.jpg / whichever the preset declares), and reports any whose parent dir has no audio tracks indexed.
2. `podkit doctor --repair sidecar-orphans` repair action (or fold into an existing `--repair artwork-*` flow) that deletes the orphan files. Per the doctor-repair convention: requires explicit `--repair`, prints what it'd delete in dry-run mode.
3. Doc the new check in `docs/user-guide/devices/doctor.md`.
4. Test fixture: mass-storage target with a stale cover.jpg whose audio peers are absent → check flags + repair cleans.

## Why deferred

No orphans can exist until TASK-370 writes sidecars. File-and-defer.

## Notes

- The orphan-detection rule is "directory contains a sidecar filename and zero audio files podkit recognises". Be careful with subdirectories — if an album has a subdir like `disc 1/` with its own cover, both layers should be respected. A simple version: only flag a sidecar as orphan when its parent dir contains zero files of any audio extension.
- Touches the path template — if podkit's pathTemplate changed and the doctor runs, the orphan walk would find the old layout. That's actually desirable (cleans up the previous layout) but worth surfacing in the dry-run preview.
<!-- SECTION:DESCRIPTION:END -->
