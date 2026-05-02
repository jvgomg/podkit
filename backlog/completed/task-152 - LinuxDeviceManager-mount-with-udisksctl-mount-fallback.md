---
id: TASK-152
title: LinuxDeviceManager mount() with udisksctl/mount fallback
status: Done
assignee: []
created_date: '2026-03-18 12:25'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies:
  - TASK-149
  - TASK-151
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `mount()` with tiered privilege escalation:

1. Try `udisksctl mount -b /dev/sdX` (unprivileged, if udisksctl available)
2. Fall back to `mount -t vfat /dev/sdX /target` (may need root)
3. Return `requiresSudo: true` on permission failure

Default mount target: `/tmp/podkit-{volumeName}`, configurable via `MountOptions.target`. Docker overrides to `/ipod` via entrypoint.

When udisksctl succeeds, parse its output to extract the actual mount point (typically `/media/$USER/LABEL`).

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tries udisksctl first when available
- [ ] #2 Falls back to mount when udisksctl unavailable
- [ ] #3 Returns requiresSudo on permission failure
- [ ] #4 Default target is /tmp/podkit-{volumeName}
- [ ] #5 MountOptions.target overrides default
- [ ] #6 Skips mount if device already mounted (returns existing mount point)
- [ ] #7 Unit tests for command construction and fallback logic
<!-- AC:END -->
