---
id: TASK-292.08
title: P1.8 — Wire core sysinfo-extended into firmware-package orchestrator
status: To Do
assignee: []
created_date: '2026-05-03 11:30'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `podkit-core/device/sysinfo-extended.ts`'s `ensureSysInfoExtended` to call `inquireFirmware` from `@podkit/ipod-firmware` instead of directly invoking libgpod-node's USB reader.

The function signature stays. Behaviour gains SCSI fallback transparently. Existing tests must continue to pass.

The legacy regex extraction code stays in P1 (used for the on-disk-read path). Migration to the structured parser is P4.

See spec doc-032, Scope > Wired into core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/device/sysinfo-extended.ts ensureSysInfoExtended calls inquireFirmware from @podkit/ipod-firmware
- [ ] #2 Function signature unchanged — no caller updates required
- [ ] #3 Existing sysinfo-extended tests pass without modification
- [ ] #4 On test devices that previously worked via USB, behaviour is unchanged
- [ ] #5 On devices where USB inquiry fails, the orchestrator's SCSI fallback now activates
<!-- AC:END -->
