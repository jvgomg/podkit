---
id: TASK-279.02
title: 'Enhance USB discovery to capture serial, bus number, and device address'
status: Done
assignee: []
created_date: '2026-04-19 17:11'
updated_date: '2026-04-19 17:50'
labels:
  - device
  - usb
dependencies: []
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend USB discovery on both platforms to capture the additional fields needed for SysInfoExtended reading: serial number (= FirewireGuid), USB bus number, and device address.

**macOS (`system_profiler` parsing in usb-discovery.ts):**
- Capture `serial_num` field from system_profiler JSON (16 hex char FirewireGuid, e.g., "000A27001BC8EED6")
- Capture `location_id` and derive bus number (top byte of location_id, e.g., 0x03100000 → bus 3) and device address (the "/ 14" suffix)
- Add fields to `UsbDiscoveredDevice` and `UsbDeviceInfo` interfaces

**Linux (sysfs parsing in usb-discovery.ts):**
- Read `busnum` and `devnum` files from sysfs device path (code already walks the sysfs tree but doesn't extract these)
- Read `serial` file from sysfs (= FirewireGuid)
- Add to same interfaces

**Path-to-USB correlation (for `device add --path`):**
- macOS: correlate mount path → bsd_name → system_profiler Media tree → USB device info
- Linux: follow `/sys/block/{dev}/device` symlink up to USB device node
- New function: given a mount path, return USB device info (bus, address, serial) or null

**Verified data from real hardware (iPod Nano 3G):**
- system_profiler reports: `"serial_num": "000A27001BC8EED6"`, `"location_id": "0x03100000 / 14"`, `"product_id": "0x1262"`
- These map to: bus=3, address=14, FirewireGuid=000A27001BC8EED6

See PRD: doc-029 — "USB Discovery Enhancement" section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 UsbDiscoveredDevice interface includes optional busNumber, deviceAddress, and serialNumber fields
- [x] #2 macOS parser extracts serial_num, bus number, and device address from system_profiler JSON
- [x] #3 Linux parser extracts busnum, devnum, and serial from sysfs
- [x] #4 New function resolves mount path to USB device info on macOS (via bsd_name correlation)
- [x] #5 New function resolves mount path to USB device info on Linux (via sysfs symlink traversal)
- [x] #6 Unit tests with fixture JSON/sysfs data verify field extraction on both platforms
- [x] #7 Existing USB discovery tests still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended UsbDiscoveredDevice and UsbDeviceInfo with optional serialNumber, busNumber, deviceAddress. macOS parser extracts serial_num, location_id (bus/address). Linux parser reads busnum/devnum/serial from sysfs. Added resolveUsbDeviceFromPath (macOS implemented, Linux TODO). Added 0x1266 to UNSUPPORTED_IPODS. 12 new tests added.

AC #5 implemented: Linux resolveUsbDeviceFromPath via /proc/mounts → sysfs block device → USB ancestor traversal. Tested with fixture temp directories mimicking sysfs structure. Runs on Lima VMs via existing run-tests.sh.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes\n\n### Interfaces extended\n- `UsbDiscoveredDevice` (usb-discovery.ts): added optional `serialNumber`, `busNumber`, `deviceAddress`\n- `UsbDeviceInfo` (assessment.ts): added same three optional fields\n- `SysfsUsbDevice` (usb-discovery.ts): added optional `busnum`, `devnum`, `serial`; exported the interface\n\n### macOS parser\n- `SystemProfilerItem` now includes `serial_num` and `location_id`\n- `walkItems` extracts serial number, bus number, and device address from system_profiler JSON\n- New `extractSerialNumber()` helper\n- New exported `parseLocationId()` — parses `\"0x03100000 / 14\"` into `{ busNumber: 3, deviceAddress: 14 }`\n\n### Linux parser\n- `discoverLinux()` now reads `busnum`, `devnum`, `serial` sysfs files\n- `parseSysfsUsbDevices()` passes these through to results\n\n### Path-to-USB correlation\n- New exported `resolveUsbDeviceFromPath(mountPath, options?)` function\n- macOS: correlates mount path → diskutil device node → system_profiler bsd_name → USB device info\n- Linux: TODO placeholder (returns null)\n- Exported from device index\n\n### Tests (10 new tests)\n- Serial/bus/address extraction from system_profiler data\n- Missing fields remain undefined\n- `parseLocationId` edge cases (8 tests): standard format, high bus, hex-only, empty, malformed, no-space slash\n- Linux sysfs with busnum/devnum/serial\n- Linux sysfs without optional fields\n\n### Quality gates\n- All 2290 tests pass (35 in usb-discovery.test.ts)\n- Build clean across all 12 packages
<!-- SECTION:FINAL_SUMMARY:END -->
