---
id: TASK-294.06
title: P3.6 — createMassStorageProvider
status: To Do
assignee: []
created_date: '2026-05-03 11:32'
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
ordinal: 10060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `provider.ts` to `@podkit/devices-mass-storage` exporting `createMassStorageProvider(presets) → DeviceProvider<MassStorageIdentity>`. Factory variant because the provider needs the user's preset map at construction time.

The returned provider's `matches` checks USB VID/PID against the preset map's hints; `identify` returns the matching MassStorageIdentity.

See spec doc-034, Scope > New package: @podkit/devices-mass-storage, provider.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 createMassStorageProvider(presets) returns a DeviceProvider value
- [ ] #2 Returned provider's matches() respects the supplied preset map's USB hints
- [ ] #3 Returned provider's identify() returns MassStorageIdentity (preset id internal)
- [ ] #4 Different preset maps produce providers with different matching behaviour
- [ ] #5 Unit tests cover factory construction and provider operation
<!-- AC:END -->
