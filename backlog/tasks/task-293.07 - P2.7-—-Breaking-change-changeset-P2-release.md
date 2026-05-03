---
id: TASK-293.07
title: P2.7 — Breaking-change changeset + P2 release
status: To Do
assignee: []
created_date: '2026-05-03 11:31'
labels:
  - device-capability-architecture
  - phase-2
  - release
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final P2 release prep. Changeset entries with breaking-change note for `@podkit/libgpod-node` (export removed). All in-tree callers were already routed through `@podkit/ipod-firmware` since P1, so the breaking change is contained in practice.

See spec doc-033, Migration steps 11–12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Changeset entry for @podkit/libgpod-node marked as breaking change (removal of readSysInfoExtendedFromUsb)
- [ ] #2 Changeset entry for @podkit/ipod-firmware (no API change, internal implementation swap)
- [ ] #3 CHANGELOG documents the libgpod-node export removal
- [ ] #4 P2 released through CI
<!-- AC:END -->
