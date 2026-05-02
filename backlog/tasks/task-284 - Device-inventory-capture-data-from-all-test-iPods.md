---
id: TASK-284
title: 'Device inventory: capture data from all test iPods'
status: Done
assignee: []
created_date: '2026-05-02 15:33'
updated_date: '2026-05-02 16:27'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-testing-playbook.md#phase-2-device-inventory
  - documents/test-devices.md
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plug in each iPod from the test collection and run the per-device inventory procedure from `documents/device-testing-playbook.md` Phase 2. Capture USB enumeration data, filesystem state, SCSI inquiry results, USB inquiry results, and model lookup verification for each device. Save SysInfoExtended XML captures to `documents/sysinfo-captures/`. Update `documents/test-devices.md` with all findings.

Devices: iPod nano 2G (already partially done), iPod nano 4G (already partially done), iPod nano 7G, iPod mini 2G, iPod 5G Video (iFlash mod).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 5 devices tested with the per-device procedure
- [x] #2 SysInfoExtended XML saved for each device where inquiry succeeds
- [x] #3 test-devices.md fully populated with all fields for all devices
- [x] #4 Inquiry method matrix updated with confirmed results
- [x] #5 Generation table vs firmware data discrepancies noted
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 5 devices inventoried with the full per-device procedure. SysInfoExtended XML captures saved for all 5 (6 files — nano 7G has both SCSI and USB captures). Key findings: SCSI inquiry works on all devices; USB inquiry works on nano 4G and 7G only; USB returns 14x more data on nano 7G; pre-2006 SysInfo behaviour confirmed on mini 2G; USB product ID bugs found (0x1205 mapped to nano_1g instead of mini, 0x1209 shared across generations); iFlash mod does not affect firmware inquiry; identity discrepancies between USB/serial/SysInfo sources documented for iPod 5.5G.
<!-- SECTION:FINAL_SUMMARY:END -->
