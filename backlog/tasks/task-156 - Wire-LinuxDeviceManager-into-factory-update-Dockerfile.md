---
id: TASK-156
title: Wire LinuxDeviceManager into factory + update Dockerfile
status: Done
assignee: []
created_date: '2026-03-18 12:25'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies:
  - TASK-151
  - TASK-152
  - TASK-153
  - TASK-154
  - TASK-155
references:
  - packages/podkit-core/src/device/manager.ts
  - docker/Dockerfile
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final integration task for the LinuxDeviceManager:

1. Update `createDeviceManager()` in `manager.ts` — `'linux'` returns `LinuxDeviceManager` instead of `UnsupportedDeviceManager`
2. Set `isSupported = true` for Linux
3. Add `lsblk` (from util-linux) to Dockerfile `apk add` line
4. Update `manager.test.ts` — Linux now returns a supported manager
5. Update `getManualInstructions()` and `requiresPrivileges()` for Linux

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 createDeviceManager('linux') returns LinuxDeviceManager
- [ ] #2 LinuxDeviceManager.isSupported is true
- [ ] #3 Dockerfile apk add includes lsblk
- [ ] #4 manager.test.ts updated for Linux being supported
- [ ] #5 getManualInstructions() returns Linux-specific guidance
- [ ] #6 requiresPrivileges() returns correct values
<!-- AC:END -->
