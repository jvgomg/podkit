---
id: TASK-146
title: Show filesystem UUID in device info for path-mode devices
status: To Do
assignee: []
created_date: '2026-03-18 02:24'
updated_date: '2026-03-18 02:33'
labels:
  - docker
  - ux
dependencies:
  - TASK-073
references:
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-cli/src/commands/device.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When `podkit device info --device /path` is used, extract and display the filesystem UUID from the mount point. This helps users discover their iPod's UUID for use in device config or env vars.

**Implementation:** Add `getVolumeUuidForMountPoint(path)` to DeviceManager interface. On macOS, use `diskutil info`. On Linux, use `findmnt --output UUID --noheadings --target <path>` or parse `/dev/disk/by-uuid/` symlinks.

**Context:** Users need the UUID to configure multi-device setups where different iPods are mounted at the same path. Currently there's no way to discover the UUID from within podkit — users must use host-level tools like `lsblk` or `blkid`.

In the meantime, document the host-side commands in the Docker docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit device info --device /path shows the filesystem UUID
- [ ] #2 Works on macOS (diskutil)
- [ ] #3 Works on Linux (findmnt or equivalent)
- [ ] #4 Gracefully skips UUID display when extraction is not supported
<!-- AC:END -->
