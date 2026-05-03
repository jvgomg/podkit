---
id: TASK-294.03
title: P3.3 — ipodProvider implementation
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
ordinal: 10030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `provider.ts` to `@podkit/devices-ipod` exporting `ipodProvider: DeviceProvider<IpodIdentity>` — a pure value with `kind: 'ipod'`, `matches(usb)` checking Apple VID + known iPod product IDs, and `identify(usb)` calling the package's identify() facade.

See spec doc-034, Scope > New package: @podkit/devices-ipod, provider.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ipodProvider exported as a pure value (not a factory)
- [ ] #2 matches(usb) returns true for Apple VID + known iPod product IDs
- [ ] #3 identify(usb) returns IpodIdentity with full metadata (generation, modelNumber, variant, etc.)
- [ ] #4 Unit tests cover provider matching across all known USB IDs
- [ ] #5 Returns null for unknown product IDs
<!-- AC:END -->
