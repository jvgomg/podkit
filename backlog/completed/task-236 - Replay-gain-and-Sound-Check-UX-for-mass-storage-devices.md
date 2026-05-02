---
id: TASK-236
title: Replay gain and Sound Check UX for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 19:18'
updated_date: '2026-03-28 13:37'
labels:
  - feature
  - ux
  - cli
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-224
references:
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-core/src/sync/music-planner.ts
  - packages/podkit-core/src/device/presets.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review and fix replay gain / Sound Check handling for mass-storage devices. The Echo Mini does not support Sound Check (Apple-specific) or ReplayGain tags. Several UX and implementation concerns need addressing:

**Implementation questions (HITL):**
- Does the planner currently compute/apply Sound Check values for mass-storage device plans? If so, this work is wasted.
- Should ReplayGain tags be written to files synced to mass-storage devices? The Echo Mini ignores them, but other DAPs (Rockbox) do read them. This may need to be a per-device capability.
- Is the Echo Mini preset correctly configured to indicate no replay gain support?

**UX concerns:**
- Dry-run output shows "Sound Check: N/M tracks have normalization data" — this is an iPod-specific concept meaningless for Echo Mini users
- JSON dry-run output includes `soundCheckTracks` field — confusing for scripting consumers targeting mass-storage
- Should "Sound Check" be renamed to "ReplayGain" for non-iPod devices, or hidden entirely for devices that don't support it?
- The `--check-artwork` and normalization-related tips should be device-appropriate

**Scope:** Audit the replay gain / Sound Check code paths, update the planner to skip normalization for devices that don't support it, and clean up the UX to be device-appropriate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sound Check / normalization data is not computed for devices that don't support it
- [x] #2 Dry-run output hides or relabels Sound Check for non-iPod devices
- [x] #3 JSON output omits soundCheckTracks for devices without normalization support
- [x] #4 Echo Mini preset correctly indicates no replay gain / Sound Check support
- [x] #5 Rockbox preset correctly indicates ReplayGain support (if applicable)
- [x] #6 Device capability type extended with normalization support indicator if needed
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Added `audioNormalization` capability to `DeviceCapabilities` with three modes: `'soundcheck'` (iPod), `'replaygain'` (Rockbox), and `'none'` (Echo Mini, generic). This controls whether Sound Check/ReplayGain upgrade detection and UX is shown during sync.

### Changes

**Core type (`DeviceCapabilities`)**
- Added `audioNormalization: AudioNormalizationMode` field
- New type: `AudioNormalizationMode = 'soundcheck' | 'replaygain' | 'none'`

**Device presets**
- Echo Mini: `'none'` — no normalization support
- Rockbox: `'replaygain'` — reads ReplayGain tags from files
- Generic: `'none'`
- iPod (all generations): `'soundcheck'`

**Sync engine**
- `ResolvedMusicConfig` derives `audioNormalization` from capabilities (defaults to `'soundcheck'` for backward compat)
- `MusicHandler.detectUpdates()` filters out `soundcheck-update` when `audioNormalization === 'none'`

**CLI UX**
- Text dry-run: hides normalization line for `'none'` devices; shows "ReplayGain" label for `'replaygain'`, "Sound Check" for `'soundcheck'`
- JSON dry-run: omits `soundCheckTracks` field for `'none'` devices

**Config**
- `DeviceConfig` and `deviceDefaults` support `audioNormalization` override
- `open-device.ts` resolves the override and passes it through capability merging

### Files changed
- `packages/podkit-core/src/device/capabilities.ts` — new type + field
- `packages/podkit-core/src/device/presets.ts` — preset values + merge
- `packages/podkit-core/src/ipod/capabilities.ts` — iPod gets `'soundcheck'`
- `packages/podkit-core/src/sync/music/config.ts` — derive field
- `packages/podkit-core/src/sync/music/handler.ts` — filter soundcheck-update
- `packages/podkit-core/src/index.ts` — export new type
- `packages/podkit-cli/src/commands/music-presenter.ts` — conditional display
- `packages/podkit-cli/src/commands/open-device.ts` — override resolution + fallback
- `packages/podkit-cli/src/config/types.ts` — config type + import
- `packages/demo/src/mock-core.ts` — mirror preset changes
- Test files updated with new field (6 files)
<!-- SECTION:FINAL_SUMMARY:END -->
