---
id: TASK-294.14
title: P3.14 — Hardware + Echo Mini validation
status: Done
assignee: []
created_date: '2026-05-03 11:33'
updated_date: '2026-05-08 08:12'
labels:
  - device-capability-architecture
  - phase-3
  - hardware-validation
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
  - documents/device-testing-playbook.md
parent_task_id: TASK-294
ordinal: 10140
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-run the full Phase 3 procedure from documents/device-testing-playbook.md against all five inventory iPods. Plug in an Echo Mini (if available) and verify auto-detection at `device add`.

HITL: requires connecting each device.

See spec doc-034, Hardware validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All five iPod inventory devices: behaviour identical to P2
- [ ] #2 Echo Mini (if available): auto-detected by USB VID/PID at device add
- [ ] #3 Echo Mini sync planning produces capabilities matching pre-P3 preset-derived values
- [ ] #4 documents/test-devices.md updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Folded into TASK-S-A (macOS sweep). Echo Mini auto-detect + 5-iPod re-validation lives in the consolidated macOS session.
<!-- SECTION:NOTES:END -->
