---
id: TASK-292.09
title: 'P1.9 — Doctor checks: inquiry-methods + sysinfo-consistency'
status: To Do
assignee: []
created_date: '2026-05-03 11:30'
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
