---
id: TASK-204
title: Sidecar artwork creation for sidecar-artwork devices
status: To Do
assignee: []
created_date: '2026-03-23 14:10'
updated_date: '2026-03-24 16:11'
labels:
  - feature
  - core
  - sync
milestone: "Mass Storage Device Support: Extended"
dependencies:
  - TASK-221
references:
  - packages/podkit-core/src/sync/music-executor.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
documentation:
  - backlog/docs/doc-012 - Spec--Transfer-Mode-Behavior-Matrix.md
  - backlog/docs/doc-013 - Spec--Device-Capabilities-Interface.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement sidecar artwork file creation for devices that read artwork from files alongside the audio (e.g., `folder.jpg`). The sidecar is always created at the device's optimal resolution, while transfer mode controls what happens to embedded artwork. Currently Transfer Mode for embedded-artwork devices is limited for "portable" mode - users cannot keep high resolution images and see a warning about this caveat. Being able to offer a high resolution sidecar image for devices that prioritise embedded-artwork could be a solution for keeping high resolution available.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-012 (Behavior Matrix — Sidecar Artwork Devices section)
**Spec:** DOC-013 (Device Capabilities Interface)

**Behavior for sidecar-artwork devices:**
- All transfer modes: create sidecar file at `artworkMaxResolution`
- `fast`: direct copy audio file + create sidecar (embedded artwork preserved naturally)
- `optimized`: optimized-copy audio (strip embedded) + create sidecar
- `portable`: direct copy audio file (embedded preserved) + create sidecar

**Sidecar creation:**
- Extract artwork from source file (embedded or from collection adapter artwork source)
- Resize to `artworkMaxResolution` (do not upscale)
- Write as sidecar file (e.g., `folder.jpg`) alongside audio on device
- Format: JPEG (most universally supported by DAPs)
- One sidecar per album/folder, not per track

**Executor integration:**
- Sidecar creation happens as a post-step after audio file transfer
- Track whether sidecar already exists for the album to avoid redundant writes
- Sidecar should be updated when artwork changes (artwork hash in sync tags)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sidecar artwork file created alongside audio files on sidecar-artwork devices
- [ ] #2 Sidecar resized to artworkMaxResolution (no upscaling)
- [ ] #3 Sidecar format is JPEG for broad device compatibility
- [ ] #4 One sidecar per album/folder, not duplicated per track
- [ ] #5 fast mode: direct copy audio + create sidecar
- [ ] #6 optimized mode: strip embedded artwork + create sidecar
- [ ] #7 portable mode: preserve embedded artwork + create sidecar
- [ ] #8 Sidecar updated when source artwork changes (detected via artwork hash)
- [ ] #9 Tests cover sidecar creation, resize, and deduplication per album
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved from Echo Mini milestone (m-14) to Extended milestone (m-16). Echo Mini confirmed to have no sidecar artwork support (tested cover.jpg, folder.jpg, albumart.jpg — all ignored) [firsthand, TASK-232]. This task is needed for future Rockbox support where sidecar artwork is common.
<!-- SECTION:NOTES:END -->
