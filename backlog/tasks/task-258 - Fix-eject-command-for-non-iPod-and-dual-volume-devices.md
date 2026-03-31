---
id: TASK-258
title: Fix eject command for non-iPod and dual-volume devices
status: Done
assignee: []
created_date: '2026-03-31 12:56'
updated_date: '2026-03-31 14:29'
labels:
  - bug
  - cli
milestone: m-14
dependencies: []
references:
  - packages/podkit-core/src/device/eject.ts
  - packages/podkit-cli/src/commands/eject.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The eject command has hardcoded "iPod" strings and only unmounts one volume. Discovered during Echo Mini E2E validation (TASK-226).

**Issues:**

1. **Hardcoded "iPod" in eject messages:** `ejectWithRetry` in `packages/podkit-core/src/device/eject.ts` has hardcoded strings like "Ejecting iPod..." and "iPod ejected. Safe to disconnect." These should use the device type display name.

2. **Only ejects one volume for dual-LUN devices:** The Echo Mini presents two USB LUNs (internal + SD card). Ejecting only the sync target volume leaves the other mounted, making it unsafe to disconnect. The eject command should unmount all volumes belonging to the same physical device.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Eject messages use device type display name instead of hardcoded 'iPod'
- [x] #2 For dual-LUN devices, eject unmounts all volumes belonging to the same physical USB device
- [x] #3 Single-volume devices continue to work as before
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Hardcoded 'iPod' strings fixed in eject.ts and eject CLI (commit `2ce14ac`). Dual-volume ejection (AC #2) still to do.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All acceptance criteria complete:
- AC #1: Device label in eject messages (commit `2ce14ac`)
- AC #2: Dual-LUN eject via `getSiblingVolumes()` + `system_profiler` USB tree traversal (commit `bfce2dc`)
- AC #3: Single-volume backward compatibility maintained (empty additionalMountPoints default)
<!-- SECTION:FINAL_SUMMARY:END -->
