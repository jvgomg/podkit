---
id: TASK-149
title: 'Linux tool availability detection (lsblk, udisksctl)'
status: Done
assignee: []
created_date: '2026-03-18 12:24'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement lazy, cached runtime detection of `lsblk` and `udisksctl` availability for LinuxDeviceManager.

- Probe on first use of each tool, cache the result
- `lsblk` is required — throw a descriptive error with install instructions if missing ("Install with: apk add lsblk / apt install util-linux")
- `udisksctl` is optional — its absence triggers fallback to manual mount/umount

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 lsblk availability is detected and cached on first use
- [ ] #2 udisksctl availability is detected and cached on first use
- [ ] #3 Missing lsblk throws error with Debian and Alpine install instructions
- [ ] #4 Missing udisksctl is handled gracefully (not an error)
- [ ] #5 Unit tests cover present/absent scenarios with mocked exec
<!-- AC:END -->
