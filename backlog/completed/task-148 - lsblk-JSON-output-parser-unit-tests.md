---
id: TASK-148
title: lsblk JSON output parser + unit tests
status: Done
assignee: []
created_date: '2026-03-18 12:24'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies: []
references:
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parse `lsblk --json -o NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,PHY-SEC,TYPE` output into `PlatformDeviceInfo[]`.

Pure functions with no I/O — takes a JSON string, returns typed objects. Handles edge cases: missing UUID, missing label, multiple mount points, unmounted devices.

This is the foundation for all Linux device operations. Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Parser converts lsblk JSON to PlatformDeviceInfo[] correctly
- [ ] #2 Filters to partitions only (type=part), excludes whole disks
- [ ] #3 Handles missing UUID, LABEL, MOUNTPOINT fields gracefully
- [ ] #4 Size string parsed to bytes
- [ ] #5 PHY-SEC mapped to blockSizeBytes
- [ ] #6 Unit tests pass on macOS and Linux (pure function, no lsblk needed)
<!-- AC:END -->
