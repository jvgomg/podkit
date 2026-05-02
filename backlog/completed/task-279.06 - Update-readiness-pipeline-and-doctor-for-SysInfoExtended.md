---
id: TASK-279.06
title: Update readiness pipeline and doctor for SysInfoExtended
status: Done
assignee: []
created_date: '2026-04-19 17:12'
updated_date: '2026-04-25 13:40'
labels:
  - device
  - cli
dependencies:
  - TASK-279.05
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the readiness pipeline's SysInfo stage and the doctor command to account for SysInfoExtended. Add a new repairable check that triggers the SysInfoExtended orchestrator.

**Readiness pipeline changes (readiness.ts):**
- SysInfo stage now checks for SysInfoExtended in addition to SysInfo
- Pass: SysInfoExtended present with valid content, OR SysInfo present with valid ModelNumStr
- Warn: SysInfo present but SysInfoExtended missing (device works but may lack full capability data)
- Fail: both missing → suggest `podkit doctor --repair sysinfo-extended`
- Use checksum type mapping (from task-279.04) to determine severity: hash58+ devices FAIL without SysInfoExtended, older devices WARN

**Doctor command changes (doctor.ts):**
- New repairable check ID: `sysinfo-extended`
- Follow existing pattern from `artwork-rebuild` and `orphan-files` checks
- `doctor --repair sysinfo-extended` triggers the orchestrator (from task-279.05)
- Requires USB device info — resolve from device config's mount path using USB discovery (task-279.02)

**Limitation messaging:**
- Hash72 devices (Nano 5G): message explaining iTunes sync required for HashInfo bootstrap
- HashAB devices (Nano 6G, Touch 4G): message explaining proprietary component requirement
- These are informational messages, not repairable checks

See PRD: doc-029 — "Readiness Pipeline Update" and "Initialization Capability Mapping" sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SysInfo readiness stage passes when SysInfoExtended is present
- [x] #2 SysInfo readiness stage warns when only SysInfo is present (no SysInfoExtended)
- [x] #3 SysInfo readiness stage fails when both are missing, with repair suggestion
- [x] #4 doctor --repair sysinfo-extended triggers SysInfoExtended read from USB and writes to device
- [x] #5 Hash72 devices show clear message about iTunes sync requirement
- [x] #6 HashAB devices show clear message about proprietary component requirement
- [x] #7 Existing readiness tests updated to cover new SysInfoExtended states
- [x] #8 Doctor repair follows existing pattern (artwork-rebuild style)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated checkSysInfo to check SysInfoExtended first. Checksum type severity: hash58+ without SysInfoExtended → fail, none → warn. Added checksumNote for hash72/hashAB. New sysinfo-extended diagnostic check with repair via resolveUsbDeviceFromPath + ensureSysInfoExtended. Registered in diagnostics index. 40 readiness tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Updated readiness pipeline and diagnostics framework for SysInfoExtended support.

**Readiness pipeline (`readiness.ts`):**
- `checkSysInfo` now checks SysInfoExtended first via `readSysInfoExtended(mountPoint)`
- SysInfoExtended present with valid content → **pass** (uses richer device info)
- SysInfo present but SysInfoExtended missing → **warn** (no-checksum devices) or **fail** (hash58/hash72/hashAB devices)
- Both missing → **fail** with suggestion to run `podkit doctor --repair sysinfo-extended`
- Checksum severity determined from USB product ID (via `usbInfo` parameter) or SysInfoExtended serial suffix
- Hash72 devices get informational note about iTunes sync requirement for HashInfo bootstrapping
- HashAB devices get informational note about proprietary component requirement
- `checkSysInfo` signature updated: `(mountPoint, usbInfo?)` — backward-compatible
- `ReadinessInput` interface extended with optional `usbInfo?: UsbDeviceInfo`
- `checkReadiness` pipeline passes `input.usbInfo` to `checkSysInfo`
- `determineLevel` logic unchanged — existing mappings handle new warn/fail states correctly

**Diagnostic check (`diagnostics/checks/sysinfo-extended.ts`):**
- New check ID: `sysinfo-extended`, name: "SysInfoExtended"
- `applicableTo: ['ipod']`
- Detection: checks if SysInfoExtended exists and has valid device info
- Repair: resolves USB device via `resolveUsbDeviceFromPath`, calls `ensureSysInfoExtended`
- Requirements: `['writable-device']`
- Supports dry-run mode
- Registered in diagnostics index

**Tests:**
- 40 readiness tests pass (up from 34)
- New tests: SysInfoExtended pass, SysInfoExtended-only pass, SysInfo-only warn, both-missing fail, hash58 fail severity, hash72/hashAB checksum notes
- Existing tests updated to reflect new warn behavior for SysInfo-only scenarios
- All 2393 @podkit/core tests pass, build clean
<!-- SECTION:FINAL_SUMMARY:END -->
