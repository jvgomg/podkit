---
id: TASK-068
title: Add eject and mount commands to CLI
status: To Do
assignee: []
created_date: '2026-03-08 13:11'
labels:
  - cli
  - cross-platform
  - ux
dependencies: []
documentation:
  - docs/MACOS-IPOD-MOUNTING.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add CLI commands for safely ejecting iPods and potentially mounting them, with proper cross-platform support.

## Background

Currently users must manually eject their iPod after syncing. This is error-prone and varies by OS. macOS in particular has specific requirements around disk arbitration and the "safely eject" process.

## Scope

### Eject Command
- Safely eject iPod after sync operations
- Handle OS-specific ejection mechanisms:
  - **macOS:** Use `diskutil eject` or disk arbitration APIs. Must handle the "disk in use" scenarios gracefully
  - **Linux:** Use `udisksctl unmount` + `udisksctl power-off` or `eject` command
  - **Windows:** Investigate safe removal APIs

### Mount Command (Investigation)
- Investigate feasibility of a mount command
- macOS: May need to interact with disk arbitration for auto-mount scenarios
- Consider: Is this actually useful? Users typically just plug in the device

## Reference
- See `docs/MACOS-IPOD-MOUNTING.md` for existing macOS mounting documentation
- Large iFlash iPods have known mounting issues on macOS
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 eject command safely unmounts iPod on macOS
- [ ] #2 eject command works on Linux
- [ ] #3 eject command provides clear error messages when device is in use
- [ ] #4 mount command feasibility is documented (ADR if implementing)
- [ ] #5 Cross-platform abstraction exists for mount/eject operations
<!-- AC:END -->
