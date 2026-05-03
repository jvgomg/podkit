---
id: TASK-295.07
title: P4.7 — Write ADR for device capability architecture
status: To Do
assignee: []
created_date: '2026-05-03 11:35'
labels:
  - device-capability-architecture
  - phase-4
  - adr
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write a new ADR under `adr/` capturing the architectural decisions:

- Shift from libusb-only inquiry to USB-first / SCSI-fallback selection.
- Decision to use FFI rather than additional native bindings.
- Four-package architecture (`device-types`, `devices-ipod`, `devices-mass-storage`, `ipod-firmware`).
- Provider pattern for extensible enumeration.
- Pure-functional preset registry (no globals).
- Literal-plus-runtime-string union pattern for IDs.

Cross-references doc-030 (PRD), doc-013, doc-020, doc-029, and doc-031 to doc-035 (phase specs).

HITL: needs review and acceptance. Best written after migration steps are complete and the architecture is stable.

See spec doc-035, Scope > Write the ADR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ADR file created under adr/ following the project's ADR template
- [ ] #2 All architectural decisions captured
- [ ] #3 Cross-references to doc-030, doc-013, doc-020, doc-029, doc-031 to doc-035
- [ ] #4 ADR initially merged in 'Proposed' status
- [ ] #5 Status updated to 'Accepted' once architecture is validated against the new code
<!-- AC:END -->
