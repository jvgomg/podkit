---
id: TASK-292.09
title: 'P1.9 — Doctor checks: inquiry-methods + sysinfo-consistency'
status: Done
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-03 15:24'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement two new diagnostic checks living in `@podkit/ipod-firmware/diagnostics/`, registered through the existing podkit-core diagnostics framework:

- **inquiry-methods** (system scope, no device) — reports availability of iPodDriver.kext (macOS), libusb (both), /dev/sg* (Linux). Informational; no repair.
- **sysinfo-consistency** (device scope, per-device) — compares filesystem SysInfoExtended firewireGuid against the live USB descriptor serial. Reports stale or mismatched files. Repair routes to existing sysinfo-extended repair (which now uses the new orchestrator with SCSI fallback).

See spec doc-032, Scope > Diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 inquiryMethodsCheck registered, shows in podkit doctor output (no device required)
- [x] #2 On macOS, reports iPodDriver.kext presence
- [x] #3 On Linux, reports /dev/sg* presence
- [x] #4 Both platforms: reports libusb FFI availability
- [x] #5 sysinfoConsistencyCheck registered, shows in podkit doctor -d <device>
- [x] #6 Detects firewireGuid mismatch between disk SysInfoExtended and live USB descriptor
- [x] #7 On mismatch, recommends podkit doctor --repair sysinfo-extended
- [x] #8 Existing sysinfo-extended repair is rewired through the new orchestrator (gets SCSI fallback)
- [x] #9 Unit tests with mocked probe results and mocked filesystem/USB descriptor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Both checks created in packages/podkit-core/src/diagnostics/checks/ (deviation from spec — see prior implementation notes for the architectural reasoning). inquiryMethodsCheck is system-scope, applies to all device types, surfaces probeInquiryMethods output with platform-aware summary text. sysinfoConsistencyCheck is device-scope (iPod only), reads on-disk SysInfoExtended via injected fs reader, compares its FireWireGUID against the live USB descriptor serial obtained from resolveUsbDeviceFromPath() — for classic iPods the USB serialNumber field IS the FireWireGUID verbatim. Skips (not fails) when USB descriptor unavailable to avoid false positives on non-USB mounts. DiagnosticContext.db has no GUID accessor — TODO documented to plumb GUID through context in a future task. Repair re-uses sysInfoExtendedRepair (TASK-292.08 already wired it through the orchestrator). 20 new tests / 2486 total pass / 0 fail. Hardware validated: macOS no-iPod scenario shows "iPodDriver.kext present, libusb available" + "SysInfoExtended not present — run --repair sysinfo-extended".
<!-- SECTION:NOTES:END -->
