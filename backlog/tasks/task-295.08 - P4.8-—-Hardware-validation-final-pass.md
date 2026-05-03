---
id: TASK-295.08
title: P4.8 — Hardware validation final pass
status: To Do
assignee: []
created_date: '2026-05-03 11:35'
labels:
  - device-capability-architecture
  - phase-4
  - hardware-validation
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
  - documents/device-testing-playbook.md
parent_task_id: TASK-295
ordinal: 11080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-run all five inventory devices through the full doctor and sync-dry-run flow. Results match P3. This is the final hardware gate before release.

HITL: requires connecting each device.

See spec doc-035, Hardware validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All five iPod inventory devices: behaviour identical to P3
- [ ] #2 podkit doctor checks pass on all devices
- [ ] #3 podkit sync --dry-run completes successfully on all devices
- [ ] #4 documents/test-devices.md updated to reflect post-P4 (final) state
<!-- AC:END -->
