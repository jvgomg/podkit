---
id: TASK-294.09
title: P3.9 — Split readiness.ts into stages/ directory
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
ordinal: 10090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the 815-line `core/device/readiness.ts` with a `readiness/` subdirectory:

- index.ts — orchestrator (the small replacement for the old monolithic file)
- types.ts — ReadinessStage, ReadinessLevel, ReadinessResult, ReadinessInput, etc.
- stages/usb.ts, stages/partition.ts, stages/filesystem.ts, stages/mount.ts, stages/sysinfo.ts, stages/database.ts
- determine-level.ts — extracted rule-based level determination logic

The sysinfo stage now imports identity logic from `@podkit/devices-ipod` and file-read logic from `@podkit/ipod-firmware` (already routed through the orchestrator since P1).

Public exports preserved as re-exports during P3.

See spec doc-034, Scope > Core changes > Readiness pipeline split.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 core/device/readiness.ts replaced by readiness/ directory
- [ ] #2 Each readiness stage is its own module
- [ ] #3 determine-level.ts isolated and unit-testable
- [ ] #4 Existing readiness.test.ts continues to pass without modification (via re-exports)
- [ ] #5 Public exports unchanged from podkit-core's perspective
<!-- AC:END -->
