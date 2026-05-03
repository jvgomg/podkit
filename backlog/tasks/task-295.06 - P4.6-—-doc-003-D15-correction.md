---
id: TASK-295.06
title: P4.6 — doc-003 D15 correction
status: To Do
assignee: []
created_date: '2026-05-03 11:35'
labels:
  - device-capability-architecture
  - phase-4
  - documentation
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
  - >-
    backlog/docs/doc-003 -
    ipod-db-Design-Document-Pure-TypeScript-iPod-Database-Implementation.md
parent_task_id: TASK-295
ordinal: 11060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `backlog/docs/doc-003 - ipod-db Design Document`:

- Correct or remove decision **D15** ("SysInfoExtended is Out of Scope — Only Touch/iPhone/iPad use it"). It is required for hash58, hash72, and hashAB devices.
- Add a "Relationship to Device Capability Architecture" section pointing to doc-030.
- Note that ipod-db consumes parsed FireWireGUID directly (from @podkit/ipod-firmware or cached identity) and does not need the on-disk file for its own purposes.

Documentation-only change, but meaningful for m-8 implementer.

See spec doc-035, Scope > Update doc-003.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 doc-003 D15 either corrected or removed
- [ ] #2 New section added pointing to doc-030 for the device-capability architecture
- [ ] #3 doc-003 clarifies that ipod-db does not own SysInfoExtended handling
- [ ] #4 m-8 implementer guidance is consistent with the device-capability work
<!-- AC:END -->
