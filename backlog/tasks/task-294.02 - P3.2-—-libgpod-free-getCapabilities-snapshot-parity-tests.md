---
id: TASK-294.02
title: P3.2 — libgpod-free getCapabilities + snapshot parity tests
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
ordinal: 10020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `getCapabilities(identity, opts?)` in `@podkit/devices-ipod` purely from generation tables, with optional firmware overlay. No dependency on libgpod's `LibgpodDeviceInfo`.

Snapshot-test the new function against the old `createIpodCapabilities` for every generation. Diffs must be reviewed and either fixed (if a bug) or accepted (if a deliberate improvement). HITL: snapshot diffs need user review.

See spec doc-034, Scope > New package: @podkit/devices-ipod, capabilities.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getCapabilities(identity, opts?) implemented purely from tables (no LibgpodDeviceInfo dependency)
- [ ] #2 Firmware overlay correctly merges with table-derived values when opts.firmware supplied
- [ ] #3 Snapshot tests cover every generation × { with firmware, without firmware }
- [ ] #4 Snapshot diffs against the pre-P3 createIpodCapabilities reviewed and accepted
- [ ] #5 Documentation captures any deliberate behaviour changes
<!-- AC:END -->
