---
id: TASK-293.01
title: P2.1 — libusb FFI implementation in ipod-firmware
status: To Do
assignee: []
created_date: '2026-05-03 11:31'
labels:
  - device-capability-architecture
  - phase-2
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the P1 transitional shim with a real libusb-1.0 FFI implementation via koffi. Owns libusb context lifecycle (open, claim, transfer, release, close) with proper cleanup on error paths. Implements the Apple vendor control transfer (request type vendor + device-to-host, request 0x40, value 0x02, index = page) iterating until short-read terminator.

Loader handles common libusb library names (libusb-1.0.so.0, libusb-1.0.0.dylib, etc.).

See spec doc-033, Scope > Added in @podkit/ipod-firmware.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 readUsbInquiry(bus, devnum) implementation uses libusb-1.0 via koffi (no libgpod-node delegation)
- [ ] #2 libusb context lifecycle handled with cleanup on all error paths
- [ ] #3 Apple vendor control transfer iterates pages until short-read termination
- [ ] #4 Loader handles libusb library name variance across distros
- [ ] #5 Unit tests with fake libusb FFI surface cover control transfer params, chunk concatenation, error propagation, context cleanup
- [ ] #6 Same external signature as P1 — orchestrator unchanged
<!-- AC:END -->
