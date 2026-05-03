---
id: TASK-292.04
title: P1.4 — USB inquiry transport (transitional shim over libgpod-node)
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 13:17'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `inquiry/usb.ts` in `@podkit/ipod-firmware` as a thin shim that delegates to libgpod-node's existing `readSysInfoExtendedFromUsb`. This is the transitional implementation; the real libusb FFI replacement is P2.

The shim provides the same external interface as the eventual P2 implementation, so the orchestrator does not change between phases.

See spec doc-032, Scope > inquiry/usb.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 readUsbInquiry(bus, devnum) returns Uint8Array via libgpod-node delegation
- [x] #2 Errors from libgpod-node propagated correctly
- [x] #3 Unit tests verify shim correctly forwards bus/devnum and surfaces errors
- [x] #4 Same external signature as the planned P2 FFI implementation — swappable without changing callers
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented `packages/ipod-firmware/src/inquiry/usb.ts` and `usb.test.ts`.

**API decisions:**
- `readSysInfoExtendedFromUsb(busNumber, deviceAddress)` — takes `fp.bus` and `fp.devnum` exactly as documented in doc-032 and mirroring the core sysinfo-extended.ts pattern.
- libgpod-node returns `string | null`. On null → throws with bus/devnum in message. On string → `new TextEncoder().encode(result)` → `Uint8Array`.
- Errors from libgpod-node propagate with no wrapping (original message intact, satisfying AC #2).
- `timeoutMs` is accepted but documented as a no-op in P1 (honored in P2 FFI).

**DI pattern:** `_reader?: LibgpodReader` injectable third parameter. Default uses lazy dynamic import of `@podkit/libgpod-node` (same pattern as `sysinfo-extended.ts`). Tests bypass native binding entirely.

**Gates:**
- Typecheck: no errors in usb.ts (pre-existing parser.ts errors from A2a worker are unrelated — parser.ts is untracked/not my file)
- Tests: 7/7 pass (5 new + 2 existing public-surface tests)
- Lint: 0 errors, 14 pre-existing warnings (none in my files)
- Build: JS bundle + usb.d.ts emitted cleanly; tsc declaration step fails on parser.ts (pre-existing, not my files)
<!-- SECTION:FINAL_SUMMARY:END -->
