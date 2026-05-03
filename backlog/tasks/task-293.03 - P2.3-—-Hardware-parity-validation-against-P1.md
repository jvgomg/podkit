---
id: TASK-293.03
title: P2.3 — Hardware parity validation against P1
status: To Do
assignee: []
created_date: '2026-05-03 11:31'
labels:
  - device-capability-architecture
  - phase-2
  - hardware-validation
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
  - documents/device-testing-playbook.md
  - documents/test-devices.md
parent_task_id: TASK-293
ordinal: 9030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-run all five inventory devices through podkit doctor --repair sysinfo-extended. Verify behaviour parity with P1: USB-inquiry-supporting devices produce identical XML; SCSI-fallback path on older devices unchanged.

HITL: requires connecting each physical device.

See spec doc-033, Hardware validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 nano 4G: USB inquiry via FFI produces XML identical to P1 (modulo per-read crypto blob)
- [ ] #2 nano 7G: USB inquiry via FFI produces XML identical to P1 (modulo per-read crypto blob)
- [ ] #3 mini 2G, nano 2G, iPod 5G Video: SCSI path unchanged from P1 (no regression)
- [ ] #4 documents/test-devices.md updated to reflect post-P2 state
<!-- AC:END -->
