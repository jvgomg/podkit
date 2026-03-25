---
id: TASK-236
title: Replay gain and Sound Check UX for mass-storage devices
status: To Do
assignee: []
created_date: '2026-03-24 19:18'
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
- [ ] #1 Sound Check / normalization data is not computed for devices that don't support it
- [ ] #2 Dry-run output hides or relabels Sound Check for non-iPod devices
- [ ] #3 JSON output omits soundCheckTracks for devices without normalization support
- [ ] #4 Echo Mini preset correctly indicates no replay gain / Sound Check support
- [ ] #5 Rockbox preset correctly indicates ReplayGain support (if applicable)
- [ ] #6 Device capability type extended with normalization support indicator if needed
<!-- AC:END -->
