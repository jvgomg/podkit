---
id: TASK-068
title: Add eject and mount commands to CLI
status: Done
assignee: []
created_date: '2026-03-08 13:11'
updated_date: '2026-03-09 14:42'
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
- [x] #1 eject command safely unmounts iPod on macOS
- [x] #2 eject command provides clear error messages when device is in use
- [x] #3 Cross-platform DeviceManager abstraction exists for future platform support
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented eject and mount commands for macOS:

- `podkit eject` - safely unmounts iPod using `diskutil eject`
- `podkit mount` - mounts iPod by Volume UUID auto-detection
- Cross-platform `DeviceManager` abstraction ready for future platform support
- Clear error messages when device is busy, with `--force` option
- Integration with device config (named devices, Volume UUID)

Linux and Windows support backlogged as TASK-073 and TASK-074.
<!-- SECTION:FINAL_SUMMARY:END -->
