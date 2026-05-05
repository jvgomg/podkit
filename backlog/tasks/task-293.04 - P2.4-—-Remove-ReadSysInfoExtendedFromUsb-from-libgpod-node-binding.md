---
id: TASK-293.04
title: P2.4 — Remove ReadSysInfoExtendedFromUsb from libgpod-node binding
status: Done
assignee: []
created_date: '2026-05-03 11:31'
updated_date: '2026-05-05 17:57'
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
- [x] #1 ReadSysInfoExtendedFromUsb function removed from gpod_binding.cc
- [x] #2 ReadSysInfoExtendedFn typedef and resolve_sysinfo_fn helper removed
- [x] #3 exports.Set('readSysInfoExtendedFromUsb', ...) line removed from Init
- [x] #4 readSysInfoExtendedFromUsb removed from NativeBinding interface in binding.ts
- [x] #5 readSysInfoExtendedFromUsb removed from package public exports
- [x] #6 grep -r 'libusb\|sysinfo_extended\|read_sysinfo' packages/libgpod-node/native/ returns nothing
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed all USB/libusb code from the libgpod-node native binding.

Files modified:
- packages/libgpod-node/native/gpod_binding.cc: Deleted lines 25-34 (dlfcn.h include, ReadSysInfoExtendedFn typedef, resolve_sysinfo_fn helper), deleted ReadSysInfoExtendedFromUsb function (~40 lines), removed exports.Set("readSysInfoExtendedFromUsb", ...) from Init.
- packages/libgpod-node/src/binding.ts: Removed readSysInfoExtendedFromUsb field from NativeBinding interface; removed the wrapper function export.
- packages/libgpod-node/src/index.ts: Removed the USB re-export line.
- packages/libgpod-node/src/__tests__/sysinfo-extended-usb.test.ts: Deleted file.
- packages/libgpod-node/README.md: Removed section 6 "SysInfoExtended USB Read: Custom libgpod Patch" which documented the now-deleted code.

Grep for readSysInfoExtendedFromUsb/ReadSysInfoExtendedFn/resolve_sysinfo_fn in packages/libgpod-node/ returns only stale .turbo log files (not source). All native/ files clean.
<!-- SECTION:FINAL_SUMMARY:END -->
