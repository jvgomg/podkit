---
id: TASK-292.11
title: 'P1.11 — Documentation, AGENTS.md update, P1 release'
status: To Do
assignee: []
created_date: '2026-05-03 11:30'
labels:
  - device-capability-architecture
  - phase-1
  - release
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final P1 release prep. Package READMEs for `@podkit/device-types` and `@podkit/ipod-firmware`. TSDoc on all public exports. AGENTS.md updated with the two new package entries. Changeset entries. Remove tools/scsi-spike/. Release.

See spec doc-032, Migration steps 12–14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/device-types README written and accurate
- [ ] #2 @podkit/ipod-firmware README written and accurate
- [ ] #3 TSDoc on all public exports of both packages
- [ ] #4 AGENTS.md monorepo structure updated to include both packages
- [ ] #5 Changeset entries for podkit (doctor output changes), @podkit/core (sysinfo-extended internal change), @podkit/device-types, @podkit/ipod-firmware
- [ ] #6 tools/scsi-spike/ directory removed from repo
- [ ] #7 P1 released through CI
<!-- AC:END -->
