---
id: TASK-292.09
title: 'P1.9 — Doctor checks: inquiry-methods + sysinfo-consistency'
status: To Do
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-03 14:55'
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
- [ ] #1 inquiryMethodsCheck registered, shows in podkit doctor output (no device required)
- [ ] #2 On macOS, reports iPodDriver.kext presence
- [ ] #3 On Linux, reports /dev/sg* presence
- [ ] #4 Both platforms: reports libusb FFI availability
- [ ] #5 sysinfoConsistencyCheck registered, shows in podkit doctor -d <device>
- [ ] #6 Detects firewireGuid mismatch between disk SysInfoExtended and live USB descriptor
- [ ] #7 On mismatch, recommends podkit doctor --repair sysinfo-extended
- [ ] #8 Existing sysinfo-extended repair is rewired through the new orchestrator (gets SCSI fallback)
- [ ] #9 Unit tests with mocked probe results and mocked filesystem/USB descriptor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (2026-05-03): Checks live in packages/podkit-core/src/diagnostics/checks/, NOT in @podkit/ipod-firmware as originally spec'd in doc-032. Reason: core's DiagnosticCheck interface imports IpodDatabase + CollectionAdapter (deep core types); placing checks in ipod-firmware would create a circular dep or require extracting the entire diagnostics framework to a 3rd package. Cleaner one-way dep: core/diagnostics/checks/inquiry-methods.ts imports probeInquiryMethods from @podkit/ipod-firmware. The placeholder stubs in packages/ipod-firmware/src/diagnostics/ have been deleted in the Phase A cleanup pass — recreate the checks in core when this task starts.
<!-- SECTION:NOTES:END -->
