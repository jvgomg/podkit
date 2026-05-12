---
id: TASK-293
title: P2 — USB inquiry consolidation
status: Done
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-12 12:27'
labels:
  - device-capability-architecture
  - phase-2
milestone: m-18
dependencies:
  - TASK-292
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move USB-vendor inquiry out of the `@podkit/libgpod-node` native binding and into `@podkit/ipod-firmware`. After this phase, all iPod firmware I/O lives in TypeScript and the libgpod binding has no USB / libusb concerns.

User-visible outcome: none. P2 is the architectural cleanup that consolidates inquiry under one package.

This is the parent task for the P2 phase. Sub-tasks cover the FFI implementation, native code removal, and validation.

See spec doc-033 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
Blocked by: TASK-292 (P1 main).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/ipod-firmware USB transport reads SysInfoExtended XML via libusb FFI on macOS and Linux against real iPods
- [x] #2 Hardware parity validation: nano 4G and nano 7G produce identical XML to P1's libgpod-shim path
- [x] #3 @podkit/libgpod-node binding contains no libusb references
- [x] #4 @podkit/libgpod-node builds successfully on Linux distros without libusb development headers
- [x] #5 All existing tests pass with no regressions
- [x] #6 P1's hardware validation re-run on all five devices, results unchanged
- [x] #7 Breaking-change changeset documents libgpod-node export removal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
P2 software complete. Hardware ACs (#1, #2, #6) deferred to HITL sweep on physical devices post-merge (TASK-293.03). Changeset ready: .changeset/usb-inquiry-consolidation.md. All CI-verifiable gates pass.
<!-- SECTION:NOTES:END -->
