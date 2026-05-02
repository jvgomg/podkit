---
id: TASK-151
title: LinuxDeviceManager listDevices() + findByVolumeUuid()
status: Done
assignee: []
created_date: '2026-03-18 12:25'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies:
  - TASK-148
  - TASK-149
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the lsblk parser (TASK-148) and tool detection (TASK-149) into real `lsblk` calls for device enumeration and UUID-based lookup.

- `listDevices()` executes `lsblk --json` and returns parsed `PlatformDeviceInfo[]`
- `findByVolumeUuid()` calls `listDevices()` and matches UUID case-insensitively
- This is the critical path for Docker UUID validation — once this works, `UnsupportedDeviceManager` no longer silently skips UUID checks on Linux

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 listDevices() calls lsblk and returns PlatformDeviceInfo[]
- [ ] #2 findByVolumeUuid() matches UUID case-insensitively
- [ ] #3 Returns null when no device matches the UUID
- [ ] #4 Unit tests with mocked lsblk output
<!-- AC:END -->
