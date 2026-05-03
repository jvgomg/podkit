---
id: TASK-292.06
title: P1.6 — Method-availability probe
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 13:18'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `probeInquiryMethods()` in `@podkit/ipod-firmware`. Detects whether SCSI and USB inquiry methods are available on the current system. Used by the inquiry orchestrator and by the doctor diagnostics check.

Detection signals:
- macOS: iPodDriver.kext presence (`/System/Library/Extensions/iPodDriver.kext`).
- Linux: /dev/sg* device presence and accessibility.
- Both platforms: libusb library availability through FFI loader.

See spec doc-032, Scope > inquiry/probe.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 probeInquiryMethods() returns availability for SCSI and USB methods on the current platform
- [x] #2 Reports specific reason when a method is unavailable (kext missing, libusb not loadable, /dev/sg* absent)
- [x] #3 Pure / cacheable — results are stable for a given system across calls
- [x] #4 Unit tests with mocked filesystem and FFI loader cover availability and unavailability paths
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented `probeInquiryMethods()` in `packages/ipod-firmware/src/inquiry/probe.ts` and added tests at `packages/ipod-firmware/src/inquiry/probe.test.ts`.

**Caching:** Module-scoped `cached` variable populated on first no-opts call. `clearProbeCache()` exported for tests.

**Dependency injection:** Follows the same pattern as `usb.ts` — `ProbeFs`, `ProbePlatform`, and `ProbeUsbLoader` interfaces with real defaults. No bun:test module mocking needed; tests inject fakes directly via `probeInquiryMethods(opts)`.

**USB probe:** Uses `@podkit/libgpod-node`'s `isNativeAvailable()` instead of koffi loading libusb directly. Simpler, reflects the actual P1 runtime requirement (USB inquiry depends on the compiled `.node` binding). koffi is not needed in ipod-firmware's package.json.

**SCSI probes:**
- macOS: `existsSync('/System/Library/Extensions/iPodDriver.kext')` — follows FINDINGS.md gotcha #7.
- Linux: `readdirSync('/dev')` filtered by `/^sg\d+$/`, then `accessSync` for readability check — produces distinct reasons for "no nodes" vs "present but unreadable".
- Other platforms: static unavailable with platform reason.

**Quality gates:**
- `typecheck`: 0 errors introduced (pre-existing errors in plist/parser.ts and scsi/index.ts remain — verified by stash test).
- `test`: 52/52 pass.
- `lint`: 0 errors (14 pre-existing warnings in gpod-testing unrelated to this task).
- `build`: fails on same pre-existing errors as before my changes (confirmed by stash test).
<!-- SECTION:FINAL_SUMMARY:END -->
