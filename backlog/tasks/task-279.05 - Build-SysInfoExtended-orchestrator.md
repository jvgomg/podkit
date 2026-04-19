---
id: TASK-279.05
title: Build SysInfoExtended orchestrator
status: To Do
assignee: []
created_date: '2026-04-19 17:12'
labels:
  - device
  - usb
dependencies:
  - TASK-279.01
  - TASK-279.02
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the core orchestrator module in podkit-core that coordinates reading SysInfoExtended from iPod firmware and writing it to the device filesystem. This is the deep module — simple interface, encapsulates USB transfer, XML validation, and file I/O.

**Interface:**
```
ensureSysInfoExtended(mountPoint, usbInfo: { bus, address }) → Result
```

**Behavior:**
1. Check if `iPod_Control/Device/SysInfoExtended` already exists on device — if so, skip (return existing)
2. Call libgpod-node binding `readSysInfoExtendedFromUsb(bus, address)` to read XML from firmware
3. Validate returned XML: well-formed, contains expected keys (FireWireGUID, SerialNumber, FamilyID, DBVersion)
4. Write XML to `iPod_Control/Device/SysInfoExtended`
5. Optionally extract key fields for display (serial → model lookup using task-279.04's registry)
6. Return result: success with device info, or failure with reason

**Error cases:**
- USB read returns null → "Could not read device identity from USB"
- XML missing FireWireGUID → "Device returned incomplete identity data"
- Mount point not writable → appropriate filesystem error
- Device directory doesn't exist → create it

**Platform-agnostic:** This module accepts bus/address (obtained by task-279.02's USB discovery) and calls the binding (exposed by task-279.01). No platform-specific code in this module.

See PRD: doc-029 — "SysInfoExtended Orchestrator" section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ensureSysInfoExtended writes XML to iPod_Control/Device/SysInfoExtended when file is missing
- [ ] #2 ensureSysInfoExtended skips writing when SysInfoExtended already exists
- [ ] #3 Returns extracted device info (FirewireGuid, serial, model name) on success
- [ ] #4 Returns clear error message when USB read fails
- [ ] #5 Validates XML contains FireWireGUID and SerialNumber keys
- [ ] #6 Creates Device directory if it doesn't exist
- [ ] #7 Unit tests with fixture XML verify write, skip, and error paths
- [ ] #8 Unit tests verify XML validation catches missing required keys
<!-- AC:END -->
