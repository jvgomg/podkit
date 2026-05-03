---
id: TASK-294.12
title: P3.12 — Unify ARTWORK_MAX_RESOLUTION; add re-export shims
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10120
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate the duplicate ARTWORK_MAX_RESOLUTION between `device/capability-adapter.ts` and `ipod/generation.ts`. Single source in `@podkit/devices-ipod/tables/artwork-formats.ts`. `ipod/generation.ts` imports from there.

Add re-export shims in podkit-core for the moved code (one-release back-compat):

- packages/podkit-core/src/device/ipod-models.ts (re-exports from @podkit/devices-ipod)
- packages/podkit-core/src/device/presets.ts (re-exports from @podkit/devices-mass-storage)
- packages/podkit-core/src/device/capability-adapter.ts (re-exports from @podkit/devices-ipod's capabilities module)

Each shim has @deprecated TSDoc.

See spec doc-034, Scope > Core changes > Re-export shims.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ARTWORK_MAX_RESOLUTION exists in exactly one place (@podkit/devices-ipod)
- [ ] #2 ipod/generation.ts imports the unified table
- [ ] #3 Re-export shims for ipod-models, presets, capability-adapter in podkit-core
- [ ] #4 Each shim file marked @deprecated with reference to the new package
- [ ] #5 Existing in-tree consumers continue to work via shims (no source changes required this phase)
<!-- AC:END -->
