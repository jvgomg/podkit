---
id: TASK-279.01
title: Move ipod-usb.c into libgpod library and expose in libgpod-node
status: Done
assignee: []
created_date: '2026-04-19 17:11'
updated_date: '2026-04-19 18:01'
labels:
  - libgpod
  - native
  - usb
dependencies: []
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
  - agents/libgpod-node.md
parent_task_id: TASK-279
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move the `read_sysinfo_extended_from_usb()` function from libgpod's `tools/ipod-usb.c` into the library itself (`src/`) so it becomes part of `libgpod.a`/`libgpod.dylib`. Then add a thin N-API wrapper in libgpod-node exposing it as a standalone function (not on DatabaseWrapper — doesn't need an open database).

**libgpod build changes:**
- Move `ipod-usb.c` from `tools/` to `src/`
- Update `src/Makefile.am` to include it conditionally when `HAVE_LIBUSB`
- Declare `read_sysinfo_extended_from_usb()` in public header (`itdb.h`)
- Update `configure.ac` to link libusb into the library (not just the tool)

**libgpod-node binding:**
- Add standalone function in `gpod_binding.cc` following the pattern of `Parse()`, `InitIpod()` etc
- Function signature: `ReadSysInfoExtendedFromUsb(busNumber: number, deviceAddress: number): string | null`
- Add `libusb-1.0` to pkg-config dependencies in `binding.gyp`
- TypeScript wrapper in binding module

**Key reference:**
- `tools/libgpod-macos/build/libgpod-0.8.3/tools/ipod-usb.c` — ~85 lines, uses libusb vendor control transfers (request 0x40, value 0x02)
- `packages/libgpod-node/native/gpod_binding.cc` — see `InitIpod()` for standalone function pattern
- The function depends on GLib (GString, g_print) which is fine since libgpod already depends on GLib

See PRD: doc-029 — "libgpod Library Modification" and "libgpod-node Native Binding" sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 read_sysinfo_extended_from_usb() is compiled into libgpod.a and declared in itdb.h
- [x] #2 libgpod macOS build succeeds with libusb linked into the library
- [x] #3 libgpod-node binding exposes readSysInfoExtendedFromUsb() as a standalone module-level function
- [x] #4 binding.gyp includes libusb-1.0 in pkg-config dependencies
- [x] #5 Calling with invalid bus/address returns null without crashing
- [x] #6 TypeScript types exported for the new function
- [x] #7 Existing libgpod-node tests still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created src/itdb_usb.c from tools/ipod-usb.c — renamed function to itdb_read_sysinfo_extended_from_usb, removed g_print calls, fixed GString leak in error path. Updated Makefile.am with HAVE_LIBUSB conditional, declared in itdb.h. Rebuilt and installed libgpod. Added N-API wrapper in gpod_binding.cc with extern C linkage, argument validation, g_free after JS string copy. Updated binding.gyp with libusb-1.0. TypeScript wrapper and export added. Verified on real hardware: 14KB XML returned from iPod Nano 4G (bus=3, addr=17). Invalid address returns null without crash. 282 libgpod-node tests pass, full build clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved `read_sysinfo_extended_from_usb()` from libgpod's `tools/ipod-usb.c` into the library as `itdb_read_sysinfo_extended_from_usb()` in `src/itdb_usb.c`, declared in `itdb.h`, conditionally compiled when `HAVE_LIBUSB` is set. Rebuilt and installed libgpod with the new symbol verified in `libgpod.a`. Added N-API wrapper `ReadSysInfoExtendedFromUsb()` in `gpod_binding.cc` with TypeScript bindings exported from `@podkit/libgpod-node`. Updated `binding.gyp` to link `libusb-1.0`. All 282 existing tests pass. Verified with real iPod Nano 4G (bus=3, addr=17) returning 14297 bytes of SysInfoExtended XML, and confirmed null return for invalid bus/address without crash.
<!-- SECTION:FINAL_SUMMARY:END -->
