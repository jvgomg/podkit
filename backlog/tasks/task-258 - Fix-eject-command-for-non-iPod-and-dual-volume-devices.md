---
id: TASK-258
title: Fix eject command for non-iPod and dual-volume devices
status: To Do
assignee: []
created_date: '2026-03-31 12:56'
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
- [ ] #1 Eject messages use device type display name instead of hardcoded 'iPod'
- [ ] #2 For dual-LUN devices, eject unmounts all volumes belonging to the same physical USB device
- [ ] #3 Single-volume devices continue to work as before
<!-- AC:END -->
