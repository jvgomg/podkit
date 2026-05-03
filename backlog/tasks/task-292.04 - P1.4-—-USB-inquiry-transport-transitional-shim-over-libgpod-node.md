---
id: TASK-292.04
title: P1.4 — USB inquiry transport (transitional shim over libgpod-node)
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
ordinal: 8040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `inquiry/usb.ts` in `@podkit/ipod-firmware` as a thin shim that delegates to libgpod-node's existing `readSysInfoExtendedFromUsb`. This is the transitional implementation; the real libusb FFI replacement is P2.

The shim provides the same external interface as the eventual P2 implementation, so the orchestrator does not change between phases.

See spec doc-032, Scope > inquiry/usb.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 readUsbInquiry(bus, devnum) returns Uint8Array via libgpod-node delegation
- [ ] #2 Errors from libgpod-node propagated correctly
- [ ] #3 Unit tests verify shim correctly forwards bus/devnum and surfaces errors
- [ ] #4 Same external signature as the planned P2 FFI implementation — swappable without changing callers
<!-- AC:END -->
