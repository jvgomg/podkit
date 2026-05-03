---
id: TASK-295.01
title: P4.1 — Move SysInfoExtended file I/O into ipod-firmware
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
ordinal: 11010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move `core/device/sysinfo-extended.ts` implementation into `@podkit/ipod-firmware/sysinfo/`. New layout:

- paths.ts — SYSINFO_EXTENDED_PATH constants
- read.ts — readSysInfoExtended(mountPoint)
- write.ts — writeSysInfoExtended(mountPoint, xml)
- ensure.ts — ensureSysInfoExtended(mountPoint, fingerprint)

`ensureSysInfoExtended` no longer takes a `readFromUsb` injection parameter — the inquiry orchestrator does selection internally. Same `SysInfoExtendedResult` return shape preserved.

`core/device/sysinfo-extended.ts` is replaced by a one-release re-export shim from the firmware package.

See spec doc-035, Scope > Move SysInfoExtended file I/O.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 sysinfo/{read,write,ensure}.ts implemented in @podkit/ipod-firmware
- [ ] #2 ensureSysInfoExtended uses inquireFirmware orchestrator (no readFromUsb param)
- [ ] #3 SysInfoExtendedResult shape preserved as public type
- [ ] #4 core/device/sysinfo-extended.ts becomes a re-export shim
- [ ] #5 All existing in-tree consumers continue to work via the shim
<!-- AC:END -->
