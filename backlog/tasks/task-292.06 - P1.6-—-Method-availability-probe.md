---
id: TASK-292.06
title: P1.6 — Method-availability probe
status: To Do
assignee: []
created_date: '2026-05-03 11:29'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `probeInquiryMethods()` in `@podkit/ipod-firmware`. Detects whether SCSI and USB inquiry methods are available on the current system. Used by the inquiry orchestrator and by the doctor diagnostics check.

Detection signals:
- macOS: iPodDriver.kext presence (`/System/Library/Extensions/iPodDriver.kext`).
- Linux: /dev/sg* device presence and accessibility.
- Both platforms: libusb library availability through FFI loader.

See spec doc-032, Scope > inquiry/probe.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probeInquiryMethods() returns availability for SCSI and USB methods on the current platform
- [ ] #2 Reports specific reason when a method is unavailable (kext missing, libusb not loadable, /dev/sg* absent)
- [ ] #3 Pure / cacheable — results are stable for a given system across calls
- [ ] #4 Unit tests with mocked filesystem and FFI loader cover availability and unavailability paths
<!-- AC:END -->
