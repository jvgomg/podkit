---
id: TASK-073
title: Add Linux support for mount/eject commands
status: To Do
assignee: []
created_date: '2026-03-09 14:41'
updated_date: '2026-03-18 02:33'
labels:
  - cli
  - linux
  - cross-platform
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Linux device management for the mount and eject CLI commands.

The `DeviceManager` abstraction already exists. Need to implement `LinuxDeviceManager` using udisks2 or similar.

Reference: TASK-068 implemented macOS support.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 eject command works on Linux (udisksctl or similar)
- [ ] #2 mount command works on Linux
- [ ] #3 Auto-detection of iPod devices on Linux
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## UUID validation dependency

UUID validation during sync (implemented for macOS via `findByVolumeUuid`) is a no-op on Linux because `UnsupportedDeviceManager` always returns `null`. This means Docker users who configure a `volumeUuid` get no protection against syncing to the wrong iPod.

The `LinuxDeviceManager` needs to implement `findByVolumeUuid()` — likely using `lsblk --json -o UUID,MOUNTPOINT,FSTYPE` or parsing `/dev/disk/by-uuid/` symlinks — to enable UUID validation on Linux and in Docker containers.

Related tasks:
- TASK-146: Show filesystem UUID in `device info` for path-mode devices
- TASK-144: Docker daemon mode (UUID is primary mechanism for device matching)
- TASK-145: Docker USB auto-mount (UUID distinguishes multiple connected iPods)
<!-- SECTION:NOTES:END -->
