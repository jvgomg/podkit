---
id: TASK-294.06
title: P3.6 — createMassStorageProvider
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:29'
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
ordinal: 10060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `provider.ts` to `@podkit/devices-mass-storage` exporting `createMassStorageProvider(presets) → DeviceProvider<MassStorageIdentity>`. Factory variant because the provider needs the user's preset map at construction time.

The returned provider's `matches` checks USB VID/PID against the preset map's hints; `identify` returns the matching MassStorageIdentity.

See spec doc-034, Scope > New package: @podkit/devices-mass-storage, provider.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createMassStorageProvider(presets) returns a DeviceProvider value
- [x] #2 Returned provider's matches() respects the supplied preset map's USB hints
- [x] #3 Returned provider's identify() returns MassStorageIdentity (preset id internal)
- [x] #4 Different preset maps produce providers with different matching behaviour
- [x] #5 Unit tests cover factory construction and provider operation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
UsbFingerprint→UsbConnectionInfo conversion: field rename only (bus→busNumber, devnum→deviceAddress). identify() does not use bus fields for matching, so this is type-level only. Flag for 294.07/294.08: if the enumeration layer ever needs bus addressing for deduplication, the provider already passes them through.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented `createMassStorageProvider(presets)` in `packages/devices-mass-storage/src/provider.ts`. Factory returns a `DeviceProvider<MassStorageIdentity>` with `id: 'mass-storage'` and an async `detect(fp)` that converts `UsbFingerprint → UsbConnectionInfo` (field rename: `bus → busNumber`, `devnum → deviceAddress`) before delegating to `identify(usb, presets)`.

**UsbFingerprint vs UsbConnectionInfo:** The types overlap heavily — same `vendorId`/`productId`/`serialNumber` fields — but diverge in bus-addressing names. `identify()` only uses VID/PID/serial for matching, so the conversion is purely for type correctness and future-proofing. Documented in the JSDoc. No case for consolidation right now: `UsbFingerprint` is the provider interface's contract (OS-level descriptor with required bus fields), while `UsbConnectionInfo` is the internal matching input (optional bus fields).

**Tests:** 74 tests pass across 5 files (13 new in `provider.test.ts`). Covers: provider id, Echo Mini detect, serial propagation, no-serial case, unknown-VID null return, preset-scope filtering, statelessness (two providers with different maps), and case-insensitive VID/PID.

**Gates:** typecheck clean (after rebuilding device-types dist), podkit-core 2510 tests 0 fail, lint 0 errors, build succeeds.
<!-- SECTION:FINAL_SUMMARY:END -->
