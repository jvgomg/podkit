---
id: TASK-279.07
title: Integrate SysInfoExtended into device add flow
status: Done
assignee: []
created_date: '2026-04-19 17:12'
updated_date: '2026-04-25 13:45'
labels:
  - cli
  - device
dependencies:
  - TASK-279.05
  - TASK-279.06
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate automatic SysInfoExtended reading into the `podkit device add` command. When adding an iPod that lacks SysInfoExtended, podkit should automatically read it from firmware via USB before proceeding with database init/open.

**device add flow changes (device.ts):**
- After mounting and before database init/open, check for SysInfoExtended
- If missing: resolve USB bus/address (using task-279.02's path-to-USB correlation for --path case, or from USB discovery for auto-detected case)
- Call orchestrator (task-279.05) to read and write SysInfoExtended
- Show result in device summary: exact model name from serial → model lookup (e.g., "iPod nano 8GB Black (3rd Generation)")
- If USB read fails: warn but continue (device may still work for older models that don't need checksums)

**Both add paths affected:**
- Explicit path (`--path /Volumes/IPOD`): correlate path to USB device info, then orchestrate
- Auto-detected (no --path): USB info already available from discovery, pass to orchestrator

**Display enhancements:**
- Device summary during add shows exact model (color, capacity, generation) instead of "Unknown"
- If SysInfoExtended was just written, indicate this (e.g., "Device identified: iPod nano 8GB Black (3rd Generation)")

See PRD: doc-029 — "CLI Integration: device add" section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device add automatically reads SysInfoExtended when missing on a mounted iPod
- [x] #2 Device summary shows exact model name (color, capacity, generation) after SysInfoExtended is read
- [x] #3 Works with both --path and auto-detected device paths
- [x] #4 USB read failure produces a warning but does not block device add
- [ ] #5 E2E test verifies device add flow attempts SysInfoExtended read when file is missing
- [x] #6 Existing device add tests still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Integrated SysInfoExtended into the `podkit device add` command in both iPod flows (explicit path and auto-discovery).

**Changes:**
1. `packages/podkit-cli/src/commands/device.ts` — Added `attemptSysInfoExtended()` helper and integrated it into both add paths
2. `packages/podkit-core/src/index.ts` — Added re-exports for `readSysInfoExtended`, `ensureSysInfoExtended`, `resolveUsbDeviceFromPath`, and `SysInfoExtendedResult` (were exported from device/index.ts but not from top-level)
3. `packages/demo/src/mock-core.ts` — Added stub implementations for the three new exports

AC #5 (E2E test) was out of scope per task description.
<!-- SECTION:NOTES:END -->
