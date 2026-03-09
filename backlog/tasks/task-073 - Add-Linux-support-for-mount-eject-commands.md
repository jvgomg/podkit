---
id: TASK-073
title: Add Linux support for mount/eject commands
status: To Do
assignee: []
created_date: '2026-03-09 14:41'
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
