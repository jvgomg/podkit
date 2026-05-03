---
id: TASK-294.15
title: 'P3.15 — Documentation, AGENTS.md, CHANGELOG, P3 release'
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
labels:
  - device-capability-architecture
  - phase-3
  - release
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final P3 release prep. AGENTS.md monorepo structure updated to include the two new packages. Package READMEs for `@podkit/devices-ipod` and `@podkit/devices-mass-storage`. CHANGELOG entries. Changesets.

See spec doc-034, Migration steps 19–20.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/devices-ipod README written
- [ ] #2 @podkit/devices-mass-storage README written
- [ ] #3 TSDoc on public exports of both packages
- [ ] #4 AGENTS.md updated with both new packages in the monorepo structure list
- [ ] #5 Changeset entries for podkit (auto-detect behaviour change), @podkit/core (internal restructure with shims), new packages
- [ ] #6 P3 released through CI
<!-- AC:END -->
