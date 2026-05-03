---
id: TASK-295.09
title: 'P4.9 — Documentation, AGENTS.md, CHANGELOG, P4 release'
status: To Do
assignee: []
created_date: '2026-05-03 11:35'
labels:
  - device-capability-architecture
  - phase-4
  - release
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final release prep. AGENTS.md updated to reflect the final package structure. CHANGELOG entries for all affected packages. Changesets. Release.

After this task, the device capability architecture milestone (m-18) is complete.

See spec doc-035, Migration steps 11–13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AGENTS.md monorepo structure reflects the final layout (4 new packages, smaller core)
- [ ] #2 CHANGELOG entries for podkit, @podkit/core, all four new packages
- [ ] #3 Changeset entries documenting any breaking import path changes
- [ ] #4 P4 released through CI
- [ ] #5 Milestone m-18 marked complete
<!-- AC:END -->
