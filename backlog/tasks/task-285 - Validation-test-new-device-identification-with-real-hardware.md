---
id: TASK-285
title: 'Validation: test new device identification with real hardware'
status: To Do
assignee: []
created_date: '2026-05-02 15:33'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-testing-playbook.md#phase-3-validation
  - documents/test-devices.md
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After SCSI inquiry support and device capability architecture are implemented, run the Phase 3 validation procedure from `documents/device-testing-playbook.md` against each test device. Clear SysInfoExtended, test fresh discovery, verify doctor repair, check sync capability. This task depends on the implementation work being complete.

Includes: per-device validation (clear data, scan, info, doctor, repair, sync dry-run, restore), cross-device checks (inquiry matrix, checksum verification, capability comparison), and updating the supported devices documentation with verified compatibility data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 5 devices tested with the per-device validation procedure
- [ ] #2 Device scan correctly identifies each device from USB enumeration alone
- [ ] #3 Doctor repair correctly uses SCSI inquiry (preferred) or USB inquiry (fallback)
- [ ] #4 SysInfoExtended written matches firmware-reported data
- [ ] #5 Sync dry-run completes without errors for each device
- [ ] #6 Inquiry method matrix confirmed with final implementation
- [ ] #7 Supported devices documentation updated with verified data
<!-- AC:END -->
