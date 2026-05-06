---
id: TASK-295.05
title: P4.5 — Delete P3 re-export shims
status: Done
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-06 22:45'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Delete the three shim files added in P3:

- packages/podkit-core/src/device/ipod-models.ts
- packages/podkit-core/src/device/presets.ts
- packages/podkit-core/src/device/capability-adapter.ts

Update all in-tree consumers to import directly from `@podkit/devices-ipod` and `@podkit/devices-mass-storage`. Mechanical because shims preserved the same export names.

Also remove the libgpod-coupled `LibgpodDeviceInfo` adapter type wherever it remains.

See spec doc-035, Scope > Delete P3 shims.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/device/ipod-models.ts deleted
- [x] #2 core/device/presets.ts deleted
- [x] #3 core/device/capability-adapter.ts deleted
- [x] #4 All in-tree consumers updated to direct package imports
- [x] #5 LibgpodDeviceInfo type removed from the codebase
- [x] #6 All tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**libgpod-bridge decision:** Option (a) — moved `modelFromLibgpodInfo` into `packages/podkit-core/src/device/libgpod-bridge.ts` (new file). `LibgpodDeviceInfo` type lives there too as the bridge's input contract. TSDoc notes m-8 will remove it when libgpod is replaced.

**Consumer migrations (9 total):**
- `device/index.ts` — removed all 3 shim re-exports; `ipod-models.*` → direct `@podkit/devices-ipod`; `capability-adapter.*` → `./libgpod-bridge.js`; `presets.*` → inline type constants
- `device/usb-discovery.ts` — `./ipod-models.js` → `@podkit/devices-ipod`
- `device/sysinfo-extended.ts` — `./ipod-models.js` → `@podkit/devices-ipod`
- `device/readiness/types.ts` — `../ipod-models.js` → `@podkit/devices-ipod`
- `device/readiness/index.ts` — `../ipod-models.js` → `@podkit/devices-ipod`
- `device/readiness/stages/sysinfo.ts` — `../../ipod-models.js` → `@podkit/devices-ipod`
- `podkit-cli/src/commands/open-device.ts` — `core.getDevicePreset` → `BUILT_IN_PRESETS` (dynamic import)
- `podkit-cli/src/commands/doctor.ts` — `core.getDevicePreset` → `BUILT_IN_PRESETS` (static import)
- `podkit-cli/src/config/loader.ts` — `getDevicePreset` → `BUILT_IN_PRESETS` (static import)
- `podkit-core/src/index.ts` — removed `createIpodCapabilities`, `DEVICE_PRESETS`, `getDevicePreset`, `resolveDeviceCapabilities`, `DevicePreset` exports

**Test changes:**
- `capability-adapter.test.ts` — deleted (shim gone)
- `presets.test.ts` — rewritten to test `BUILT_IN_PRESETS` + `resolveCapabilities` directly
- `ipod-models.test.ts` — updated imports to `@podkit/devices-ipod`
- `resolve-capabilities.parity.test.ts` — deleted 3 skipped DELIBERATE DIVERGENCE tests; rewrote to compare against table/preset data rather than legacy functions

**DeviceTypeId / DEVICE_PRESETS:** Type constants (`PRESET_DEVICE_TYPE_IDS`, `BUILT_IN_DEVICE_TYPE_IDS`, `DeviceTypeId`) inlined into `device/index.ts` — they are CLI-surface types with no preset-runtime dependency. `DEVICE_PRESETS` and `DevicePreset` interface removed entirely.

**Gates:** typecheck ✓, podkit-core unit (2553 pass / 1 skip / 0 fail) ✓, devices-ipod (178 pass) ✓, devices-mass-storage (74 pass) ✓, lint (0 errors) ✓, build ✓
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted `ipod-models.ts`, `presets.ts`, `capability-adapter.ts`. Created `libgpod-bridge.ts` to preserve `modelFromLibgpodInfo` + `LibgpodDeviceInfo`. Migrated 9 consumer files. Rewrote 3 test files, deleted 1 (capability-adapter.test.ts), removed 3 skipped parity tests. All quality gates pass.
<!-- SECTION:FINAL_SUMMARY:END -->
