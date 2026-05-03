---
id: TASK-295.04
title: P4.4 — Snapshot tests pre/post resolveCapabilities migration
status: To Do
assignee: []
created_date: '2026-05-03 11:34'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Snapshot-test capability resolution against representative configs (both iPod and Echo Mini, with and without firmware data). Diff outputs from before and after the resolveCapabilities migration in P4.3 — must be empty.

This catches any drift introduced when moving sync engine call sites from `createIpodCapabilities` to `resolveCapabilities`.

See spec doc-035, Test plan > Integration tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Snapshot tests cover representative iPod + Echo Mini configs
- [ ] #2 Snapshots compared pre-P4.3 and post-P4.3 — byte-identical
- [ ] #3 Any drift triggers a deliberate review; documented or fixed
<!-- AC:END -->
