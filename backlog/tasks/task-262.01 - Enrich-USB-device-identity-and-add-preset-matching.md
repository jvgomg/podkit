---
id: TASK-262.01
title: Enrich USB device identity and add preset matching
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
labels:
  - device-detection
  - cross-platform
milestone: m-14
dependencies: []
references:
  - doc-026
documentation:
  - packages/podkit-core/src/device/assessment.ts
  - packages/podkit-core/src/device/presets.ts
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/linux.ts
parent_task_id: TASK-262
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `UsbDeviceInfo` with a `displayName` field and add USB match criteria to `DEVICE_PRESETS`, enabling automatic device type detection from USB vendor/product IDs.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

**USB identity enrichment:**
- Add `displayName` to `UsbDeviceInfo` interface
- macOS: extract `_name` from `system_profiler SPUSBDataType` JSON
- Linux: read `/sys/.../product` and `/sys/.../manufacturer`

**Preset matching:**
- Add optional `usbMatch` field (vendor/product ID pairs) to `DEVICE_PRESETS`
- Add Echo Mini USB IDs (vendor: 0x071b, product: 0x3203) to the echo-mini preset
- Create a pure matching function: given USB vendor/product IDs, returns the matched device type or null

Covers PRD user stories: 12, 18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 UsbDeviceInfo interface includes displayName field
- [ ] #2 macOS implementation extracts _name from system_profiler SPUSBDataType JSON
- [ ] #3 Linux implementation reads product/manufacturer from /sys
- [ ] #4 DEVICE_PRESETS entries include optional usbMatch field with vendor/product ID pairs
- [ ] #5 Echo Mini preset includes USB IDs (0x071b:0x3203)
- [ ] #6 Pure matching function maps USB vendor/product IDs to device type or null
- [ ] #7 Unit tests cover preset matching logic including unknown IDs and edge cases
<!-- AC:END -->
