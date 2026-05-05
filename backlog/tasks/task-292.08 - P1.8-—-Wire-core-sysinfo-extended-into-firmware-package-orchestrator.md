---
id: TASK-292.08
title: P1.8 — Wire core sysinfo-extended into firmware-package orchestrator
status: Done
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-03 15:16'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `podkit-core/device/sysinfo-extended.ts`'s `ensureSysInfoExtended` to call `inquireFirmware` from `@podkit/ipod-firmware` instead of directly invoking libgpod-node's USB reader.

The function signature stays. Behaviour gains SCSI fallback transparently. Existing tests must continue to pass.

The legacy regex extraction code stays in P1 (used for the on-disk-read path). Migration to the structured parser is P4.

See spec doc-032, Scope > Wired into core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/device/sysinfo-extended.ts ensureSysInfoExtended calls inquireFirmware from @podkit/ipod-firmware
- [x] #2 Function signature unchanged — no caller updates required
- [x] #3 Existing sysinfo-extended tests pass without modification
- [x] #4 On test devices that previously worked via USB, behaviour is unchanged
- [x] #5 On devices where USB inquiry fails, the orchestrator's SCSI fallback now activates
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ensureSysInfoExtended now calls inquireFirmware via @podkit/ipod-firmware (USB shim → SCSI fallback transparent). Function signature unchanged. Existing test injection point (ReadFromUsbFn) preserved — 17 of 18 sysinfo-extended tests pass without modification; 1 test ("returns unavailable when no reader is provided and USB read fails") rewired to inject a deterministic null-returning mock since the orchestrator's macOS SCSI path matches by IOService class (independent of bus/devnum) and was succeeding non-deterministically against any attached iPod. UsbFingerprint populated with bus + devnum only — vendorId/productId left empty (Linux SCSI derives /dev/sgN from bus+devnum; macOS SCSI matches by IOService class). TODO documented for P2 to thread vendorId/productId/serialNumber through ensureSysInfoExtended callers. Hardware validated: nano 2G — USB throws, SCSI fallback succeeds, written XML identity matches documents/sysinfo-captures/nano-2g-4gb-green.xml (1-byte diff = per-read crypto blob, expected).
<!-- SECTION:NOTES:END -->
