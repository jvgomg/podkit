---
id: TASK-155
title: LinuxDeviceManager assessDevice() — iFlash + USB identity
status: Done
assignee: []
created_date: '2026-03-18 12:25'
updated_date: '2026-03-18 13:04'
labels:
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies:
  - TASK-151
  - TASK-154
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port `assessDevice()` to Linux. Provides diagnostic context when mount fails or for `podkit device info`.

- **Block size** from `lsblk -o PHY-SEC` or `/sys/block/sdX/queue/physical_block_size`
- **Size** from `lsblk -o SIZE`
- **USB identity** from `/sys/bus/usb/devices/*/idProduct` and `idVendor`
- Reuse existing `detectIFlash()` pure function (already works cross-platform)
- Reuse existing `lookupIpodModel()` for resolving product IDs to model names

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reads block size and size from lsblk or /sys
- [ ] #2 Reads USB product/vendor IDs from /sys
- [ ] #3 Passes data to detectIFlash() and lookupIpodModel()
- [ ] #4 Returns DeviceAssessment matching macOS structure
- [ ] #5 Unit tests with mocked /sys and lsblk data
<!-- AC:END -->
