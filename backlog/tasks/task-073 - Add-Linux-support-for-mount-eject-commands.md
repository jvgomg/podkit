---
id: TASK-073
title: Add Linux support for mount/eject commands
status: In Progress
assignee: []
created_date: '2026-03-09 14:41'
updated_date: '2026-03-18 12:53'
labels:
  - cli
  - linux
  - cross-platform
milestone: Linux Device Manager
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
Parent task. Implementation broken into TASK-148 through TASK-158 under the Linux Device Manager milestone.

## 2026-03-18: Work started

Broken into 11 subtasks (TASK-148 through TASK-158) across 3 phases:
- Phase 1: Implementation (TASK-148–156)
- Phase 2: Infrastructure — Lima VMs + CI matrix (TASK-150, TASK-157)
- Phase 3: Manual hardware test procedure (TASK-158)

Design decisions documented in conversation. Key choices: single LinuxDeviceManager class, lsblk as required dependency, udisksctl→mount fallback for privilege escalation, /tmp/podkit-{volumeName} default mount path.
<!-- SECTION:NOTES:END -->
