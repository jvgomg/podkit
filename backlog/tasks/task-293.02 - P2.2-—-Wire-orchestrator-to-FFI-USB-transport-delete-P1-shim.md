---
id: TASK-293.02
title: P2.2 — Wire orchestrator to FFI USB transport; delete P1 shim
status: Done
assignee: []
created_date: '2026-05-03 11:31'
updated_date: '2026-05-05 17:51'
labels:
  - device-capability-architecture
  - phase-2
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Switch the inquiry orchestrator's USB transport from the P1 libgpod-node shim to the new FFI implementation. Delete the shim file. Verify orchestrator tests continue to pass with the new transport in place.

See spec doc-033, Migration steps 1–2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Orchestrator uses FFI-based readUsbInquiry from P2.1
- [x] #2 P1 transitional shim file deleted
- [x] #3 Orchestrator unit tests pass with new transport (transports stubbed)
- [x] #4 No remaining references to libgpod-node from inquiry/usb.ts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Effectively done as part of 293.01: orchestrator already imports readUsbInquiry from inquiry/usb.ts (no source change needed). Worker rewrote usb.ts in-place — no separate shim file existed to delete. Cleanup pass: removed @podkit/libgpod-node workspace dep from packages/ipod-firmware/package.json; updated probe.ts default-loader TSDoc; updated package README dependency list; minor TSDoc text in orchestrator.ts and probe.test.ts. Orchestrator + 189 ipod-firmware unit tests pass.
<!-- SECTION:NOTES:END -->
