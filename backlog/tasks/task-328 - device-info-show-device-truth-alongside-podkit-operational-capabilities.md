---
id: TASK-328
title: 'device info: show device truth alongside podkit-operational capabilities'
status: To Do
assignee: []
created_date: '2026-05-13 08:41'
labels:
  - mass-storage
  - cli
  - ux
  - follow-up
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/devices-mass-storage/src/presets/built-in.ts
priority: low
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After TASK-327, `MassStorageAdapter.capabilities.supportedAudioCodecs` is the *operational* view (filtered through `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`, currently `['wav', 'aiff']`). If `podkit device info` displays this list verbatim, users see a list that disagrees with the preset declaration in `packages/devices-mass-storage/src/presets/built-in.ts` — confusing for users who know the firmware can play WAV.

## Goal

Make `podkit device info` surface both views clearly:

- **Device firmware can play:** the unfiltered list from the preset (the "device truth" the preset documents).
- **Podkit will use on this device:** the operational list (what the planner actually decides direct-copy vs transcode against).

For codecs that appear in (device truth) but not (operational), annotate them as "transcoded before transfer" or similar.

## Out of scope

- Changing where the filter is applied. `MassStorageAdapter.capabilities` stays operational — the differ/classifier consumes it and shouldn't see WAV/AIFF.

## References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` — the filter site (`MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`)
- `packages/devices-mass-storage/src/presets/built-in.ts` — unfiltered preset truth
- `packages/podkit-cli/src/commands/device/info.ts` (or wherever device info lives)

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit device info shows both lists (device-firmware vs podkit-output) with the operational list annotated for codecs podkit will transcode
- [ ] #2 iPod info output is unchanged (the filter is mass-storage-only)
- [ ] #3 Snapshot or text test covers the rendering
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
