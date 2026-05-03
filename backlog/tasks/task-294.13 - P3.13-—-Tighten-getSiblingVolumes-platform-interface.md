---
id: TASK-294.13
title: P3.13 — Tighten getSiblingVolumes platform interface
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
ordinal: 10130
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reconcile the `DeviceManager.getSiblingVolumes` divergence between platforms. Currently macOS implements it (for Echo Mini dual-LUN); Linux does not. Linux gains a stub returning `[]`. Behaviour matches the platform reality (no Linux dual-LUN devices today) but the contract is uniform.

See spec doc-034, Scope > Core changes > getSiblingVolumes interface tightening.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 LinuxDeviceManager implements getSiblingVolumes returning []
- [ ] #2 macOS implementation unchanged
- [ ] #3 DeviceManager interface contract is uniform across platforms
- [ ] #4 No tests broken by the change
<!-- AC:END -->
