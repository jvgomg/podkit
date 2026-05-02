---
id: TASK-205
title: Transfer mode behavior adaptation for non-database artwork devices
status: Done
assignee: []
created_date: '2026-03-23 14:10'
updated_date: '2026-03-24 16:43'
labels:
  - feature
  - core
  - architecture
milestone: "Additional Device Support: Echo Mini"
dependencies:
  - TASK-203
references:
  - packages/podkit-core/src/sync/music-planner.ts
  - packages/podkit-core/src/sync/music-executor.ts
documentation:
  - backlog/docs/doc-012 - Spec--Transfer-Mode-Behavior-Matrix.md
  - backlog/docs/doc-013 - Spec--Device-Capabilities-Interface.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the planner and executor to use `DeviceCapabilities.artworkSources` to select the correct transfer mode behavior matrix. Currently the planner hardcodes iPod behavior (strip artwork = good). This task makes it dynamic based on the device's primary artwork source.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-012 (all three behavior matrices)
**Spec:** DOC-013 (Device Capabilities — "How the Sync Engine Uses Capabilities")

**Current state:** The planner and executor assume `artworkSources: ['database']` — embedded artwork is dead weight, strip in fast/optimized.

**Target state:** The planner queries the device's `artworkSources[0]` (primary source) and selects the appropriate behavior:

- `'database'`: Strip embedded artwork in fast/optimized (current iPod behavior)
- `'embedded'`: Resize embedded artwork to device max in all modes, preserve full-res only in portable
- `'sidecar'`: Create sidecar in all modes, strip embedded in optimized only

This is the integration point between TASK-203 (resize logic), TASK-204 (sidecar creation), and the existing planner/executor from the iPod milestone.

**Key changes:**
- Planner receives `DeviceCapabilities` and uses `artworkSources` to decide between strip/resize/sidecar behavior
- This affects both the operation type selection and what gets passed to the executor
- `artworkMaxResolution` passed through to FFmpeg args when resize is needed
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Planner selects artwork behavior based on DeviceCapabilities.artworkSources primary source
- [x] #2 Database-artwork devices: strip embedded in fast/optimized (existing iPod behavior preserved)
- [x] #3 Embedded-artwork devices: resize embedded artwork, never strip
- [ ] #4 Sidecar-artwork devices: create sidecar, strip embedded only in optimized mode
- [x] #5 artworkMaxResolution passed through to executor for resize operations
- [ ] #6 All three behavior matrices from DOC-012 are correctly implemented
- [x] #7 Tests cover planner behavior with each artwork source type
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-204 dependency removed — sidecar artwork not needed for Echo Mini (confirmed no sidecar support, TASK-232). This task should wire database + embedded artwork paths only. Sidecar path deferred to Mass Storage Device Support: Extended milestone.

Echo Mini confirmed capabilities (TASK-232/233):
- artworkSources: ['embedded'] (no sidecar, no database)
- artworkMaxResolution: 600 (optimal for instant load; 1000 max before slowdown)
- Baseline JPEG only — progressive JPEG silently ignored

## Implementation complete (2026-03-24)

**Design decision (from user):** For embedded-artwork devices, artwork is ALWAYS resized to artworkMaxResolution regardless of transfer mode. Portable mode shows a warning explaining the device limitation. No full-res preservation — the device can't use it.

**Behavior matrix (embedded):**
- fast: resize artwork (optimized-copy through FFmpeg)
- optimized: resize artwork (optimized-copy through FFmpeg)
- portable: resize artwork + warning (optimized-copy through FFmpeg)

**Changes:**
- Moved DeviceCapabilities types to device/capabilities.ts
- FFmpeg: artworkResize takes priority over transferMode (resize in all modes incl. portable)
- Planner (both old createMusicPlan + new MusicHandler.planAdd): routes compatible-lossy through add-optimized-copy when primaryArtworkSource=embedded
- New embedded-artwork-resize warning for portable mode
- CLI: capabilities wired from device detection → MusicContentConfig → planner → executor
- 2087 tests pass (7 new)

**AC #4 (sidecar) and #6 (all three matrices) deferred to m-16** — Echo Mini has no sidecar support.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired the sync engine to use DeviceCapabilities.artworkSources for device-aware artwork handling. Embedded-artwork devices (Echo Mini) get artwork resized to artworkMaxResolution in all transfer modes. Database-artwork devices (iPod) behavior unchanged. Types moved from ipod/ to device/. Both planner paths updated. Warning added for portable mode on embedded devices. 2087 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
