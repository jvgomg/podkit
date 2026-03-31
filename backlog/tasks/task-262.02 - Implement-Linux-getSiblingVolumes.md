---
id: TASK-262.02
title: Implement Linux getSiblingVolumes
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
labels:
  - linux
  - cross-platform
milestone: m-14
dependencies: []
references:
  - doc-026
documentation:
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-core/src/device/platforms/macos.ts
parent_task_id: TASK-262
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the existing `getSiblingVolumes()` TODO on `LinuxDeviceManager` using `lsblk`'s parent-child hierarchy and `/sys/block` to find sibling partitions on the same physical USB device.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

This enables dual-LUN device support on Linux (e.g., Echo Mini with internal + SD card volumes), matching the existing macOS implementation that uses `system_profiler` BSD name trees.

Dependencies: None — can start immediately.

Covers PRD user story: 12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getSiblingVolumes() on LinuxDeviceManager returns sibling mount points for dual-LUN USB devices
- [ ] #2 Uses lsblk parent-child hierarchy to identify partitions on the same physical device
- [ ] #3 Unit tests with mock lsblk JSON output covering dual-LUN and single-volume devices
- [ ] #4 Returns empty array for single-volume devices (matches macOS behaviour)
<!-- AC:END -->
