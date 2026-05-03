---
id: TASK-295.05
title: P4.5 — Delete P3 re-export shims
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
ordinal: 11050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Delete the three shim files added in P3:

- packages/podkit-core/src/device/ipod-models.ts
- packages/podkit-core/src/device/presets.ts
- packages/podkit-core/src/device/capability-adapter.ts

Update all in-tree consumers to import directly from `@podkit/devices-ipod` and `@podkit/devices-mass-storage`. Mechanical because shims preserved the same export names.

Also remove the libgpod-coupled `LibgpodDeviceInfo` adapter type wherever it remains.

See spec doc-035, Scope > Delete P3 shims.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/device/ipod-models.ts deleted
- [ ] #2 core/device/presets.ts deleted
- [ ] #3 core/device/capability-adapter.ts deleted
- [ ] #4 All in-tree consumers updated to direct package imports
- [ ] #5 LibgpodDeviceInfo type removed from the codebase
- [ ] #6 All tests pass
<!-- AC:END -->
