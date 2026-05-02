---
id: TASK-154
title: LinuxDeviceManager findIpodDevices() — iPod detection heuristics
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
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement iPod auto-detection on Linux using multiple signals:

1. **USB identity** (primary for unmounted devices) — read product/vendor IDs from `/sys/bus/usb/devices/*/idProduct` and `idVendor`, match against known Apple iPod IDs
2. **iPod_Control directory** (primary for mounted devices) — check if mount point contains `iPod_Control/`
3. **Volume name heuristics** (supplementary) — pattern match on LABEL ("IPOD", "POD", "TERAPOD")

USB identity reading is zero-dependency (reads `/sys` filesystem). Used by `podkit device add`.

Part of the LinuxDeviceManager implementation (TASK-073).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reads USB product/vendor IDs from /sys for unmounted device detection
- [ ] #2 Checks iPod_Control directory for mounted devices
- [ ] #3 Volume name pattern matching as supplementary signal
- [ ] #4 Returns PlatformDeviceInfo[] of detected iPods
- [ ] #5 Unit tests for each detection signal with mocked filesystem/exec
<!-- AC:END -->
