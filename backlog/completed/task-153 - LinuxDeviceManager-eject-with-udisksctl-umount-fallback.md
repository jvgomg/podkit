---
id: TASK-153
title: LinuxDeviceManager eject() with udisksctl/umount fallback
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
Implement `eject()` with tiered privilege escalation:

1. Try `udisksctl unmount -b /dev/sdX` then `udisksctl power-off -b /dev/sdX` (unprivileged)
2. Fall back to `umount /mount/point` (may need root)
3. Force mode maps to `umount -l` (lazy unmount)
4. Return `requiresSudo: true` on permission failure

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tries udisksctl unmount + power-off first when available
- [ ] #2 Falls back to umount when udisksctl unavailable
- [ ] #3 Force flag uses umount -l (lazy unmount)
- [ ] #4 Returns requiresSudo on permission failure
- [ ] #5 Unit tests for command construction and fallback logic
<!-- AC:END -->
