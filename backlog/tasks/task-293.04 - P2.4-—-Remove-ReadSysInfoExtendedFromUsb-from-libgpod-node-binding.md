---
id: TASK-293.04
title: P2.4 — Remove ReadSysInfoExtendedFromUsb from libgpod-node binding
status: To Do
assignee: []
created_date: '2026-05-03 11:31'
labels:
  - device-capability-architecture
  - phase-2
  - breaking-change
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Delete the C++ entry point and dlsym shim from the native binding. Remove TypeScript wrapper exports.

Files touched:
- packages/libgpod-node/native/gpod_binding.cc (delete typedef, resolve_sysinfo_fn, ReadSysInfoExtendedFromUsb function, exports.Set call)
- packages/libgpod-node/src/binding.ts (remove field from NativeBinding interface, loader plumbing)
- packages/libgpod-node/src/index.ts (remove re-export)

See spec doc-033, Scope > Removed from @podkit/libgpod-node.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ReadSysInfoExtendedFromUsb function removed from gpod_binding.cc
- [ ] #2 ReadSysInfoExtendedFn typedef and resolve_sysinfo_fn helper removed
- [ ] #3 exports.Set('readSysInfoExtendedFromUsb', ...) line removed from Init
- [ ] #4 readSysInfoExtendedFromUsb removed from NativeBinding interface in binding.ts
- [ ] #5 readSysInfoExtendedFromUsb removed from package public exports
- [ ] #6 grep -r 'libusb\|sysinfo_extended\|read_sysinfo' packages/libgpod-node/native/ returns nothing
<!-- AC:END -->
