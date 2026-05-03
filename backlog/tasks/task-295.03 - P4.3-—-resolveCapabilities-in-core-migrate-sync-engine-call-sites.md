---
id: TASK-295.03
title: P4.3 — resolveCapabilities in core; migrate sync engine call sites
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
ordinal: 11030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `core/device/resolve-capabilities.ts` exporting `resolveCapabilities(identity, opts?) → DeviceCapabilities`. Dispatches by `identity.kind`:
- 'ipod' → devicesIpod.getCapabilities
- 'mass-storage' → devicesMassStorage.getCapabilities

Migrate sync engine, planner, transcoder, CLI display call sites from `createIpodCapabilities` (now a P3 shim) to `resolveCapabilities`. After this task, no in-tree consumer touches the iPod or mass-storage packages directly.

See spec doc-035, Scope > Unify resolveCapabilities in core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveCapabilities exported from podkit-core
- [ ] #2 Dispatch by identity.kind to the correct device package
- [ ] #3 Sync engine call sites migrated to resolveCapabilities
- [ ] #4 Planner call sites migrated
- [ ] #5 Transcoder call sites migrated
- [ ] #6 CLI display call sites migrated
- [ ] #7 No in-tree call to createIpodCapabilities, devicesIpod.getCapabilities, or devicesMassStorage.getCapabilities outside resolveCapabilities
<!-- AC:END -->
