---
id: TASK-294.03
title: P3.3 — ipodProvider implementation
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:30'
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
ordinal: 10030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `provider.ts` to `@podkit/devices-ipod` exporting `ipodProvider: DeviceProvider<IpodIdentity>` — a pure value with `kind: 'ipod'`, `matches(usb)` checking Apple VID + known iPod product IDs, and `identify(usb)` calling the package's identify() facade.

See spec doc-034, Scope > New package: @podkit/devices-ipod, provider.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ipodProvider exported as a pure value (not a factory)
- [x] #2 matches(usb) returns true for Apple VID + known iPod product IDs
- [x] #3 identify(usb) returns IpodIdentity with full metadata (generation, modelNumber, variant, etc.)
- [x] #4 Unit tests cover provider matching across all known USB IDs
- [x] #5 Returns null for unknown product IDs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Alignment option A chosen: `detect(fp)` pulls `@podkit/ipod-firmware` as a live-device dependency and calls `inquireFirmware(fp)`. Returns full `IpodIdentity { kind, firewireGuid, serialNumber, familyId }` on success, null on any failure (non-Apple vendor, unknown product ID, firmware inquiry failure).

Dep addition: `@podkit/ipod-firmware: workspace:*` added to `packages/devices-ipod/package.json`. Graph remains acyclic — ipod-firmware → device-types; devices-ipod → ipod-firmware + device-types.

familyId extraction: `firmware.capabilities?.familyId ?? -1`. The `??` guard is a safety net only — `extractFromPlist` requires FamilyID as a required field and returns null if it's absent, so capabilities will always carry familyId when firmware is non-null.

Interface conformance: `DeviceProvider<IpodIdentity>.detect` only accepts `fp: UsbFingerprint` (no opts parameter). `inquireFirmware` is called without override options in production. Tests use `mock.module('@podkit/ipod-firmware', ...)` for clean isolation.

Files:
- packages/devices-ipod/src/provider.ts (new)
- packages/devices-ipod/src/provider.test.ts (new, 14 tests)
- packages/devices-ipod/src/index.ts (export added)
- packages/devices-ipod/package.json (dep added)

All quality gates passed: typecheck clean, 167 tests 0 fail, lint 0 errors, build succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created `ipodProvider: DeviceProvider<IpodIdentity>` in `packages/devices-ipod/src/provider.ts`. Chose alignment Option A: provider calls `inquireFirmware` from `@podkit/ipod-firmware`, returning the canonical `IpodIdentity { kind: 'ipod', firewireGuid, serialNumber, familyId }` when firmware inquiry succeeds. Pre-filters by Apple VID and known iPod product ID table before hitting the wire. 14 unit tests via `mock.module`. All five quality gates green.
<!-- SECTION:FINAL_SUMMARY:END -->
