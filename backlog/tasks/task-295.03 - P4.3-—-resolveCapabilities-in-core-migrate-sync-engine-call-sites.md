---
id: TASK-295.03
title: P4.3 — resolveCapabilities in core; migrate sync engine call sites
status: Done
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-06 22:28'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `core/device/resolve-capabilities.ts` exporting `resolveCapabilities(identity, opts?) → DeviceCapabilities`. Dispatches by `identity.kind`:
- 'ipod' → devicesIpod.getCapabilities
- 'mass-storage' → devicesMassStorage.getCapabilities

Migrate sync engine, planner, transcoder, CLI display call sites from `createIpodCapabilities` (now a P3 shim) to `resolveCapabilities`. After this task, no in-tree consumer touches the iPod or mass-storage packages directly.

See spec doc-035, Scope > Unify resolveCapabilities in core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveCapabilities exported from podkit-core
- [x] #2 Dispatch by identity.kind to the correct device package
- [x] #3 Sync engine call sites migrated to resolveCapabilities
- [x] #4 Planner call sites migrated
- [x] #5 Transcoder call sites migrated
- [x] #6 CLI display call sites migrated
- [x] #7 No in-tree call to createIpodCapabilities, devicesIpod.getCapabilities, or devicesMassStorage.getCapabilities outside resolveCapabilities
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

**Alignment decision: Option (b) — bridge in core, not in devices-ipod.**

`devices-ipod.getCapabilities` keeps its `IpodModel` signature unchanged. `resolveCapabilities` in core bridges `IpodIdentity → IpodModel` via:
1. Serial-suffix lookup (`identify({ from: 'serial', serialNumber })`) — exact match
2. FamilyID table lookup (`lookupByFamilyId(familyId)`) — new table added to `devices-ipod`
3. Synthetic fallback to `video_5g` (safe default for unknown devices)

For call sites that hold libgpod `DeviceInfo` (not `IpodIdentity`), a new `modelFromLibgpodInfo(device)` bridge was added to `capability-adapter.ts`. It converts libgpod `generation` + `modelNumber` to an `IpodModel` via `identify({ from: 'sysinfo' })` (primary) or reverse libgpod generation lookup (fallback).

## Files added
- `packages/podkit-core/src/device/resolve-capabilities.ts` — `resolveCapabilities`, `resolveIpodModelCapabilities`, `ResolveCapabilitiesOptions`
- `packages/podkit-core/src/device/resolve-capabilities.test.ts` — 16 unit tests covering all dispatch paths, serial/familyId/fallback bridges, overrides, firmware overlay, custom presets, unknown kind error

## Files modified
- `packages/devices-ipod/src/lookups.ts` — `FAMILY_ID_TO_GENERATION` table + `lookupByFamilyId()` function
- `packages/devices-ipod/src/index.ts` — export `lookupByFamilyId` + `FAMILY_ID_TO_GENERATION`
- `packages/podkit-core/src/device/capability-adapter.ts` — `modelFromLibgpodInfo()` bridge + `LIBGPOD_TO_GENERATION_ID` reverse index
- `packages/podkit-core/src/device/index.ts` — export new functions + `ResolveCapabilitiesOptions`
- `packages/podkit-core/src/index.ts` — export `resolveCapabilities`, `resolveIpodModelCapabilities`, `modelFromLibgpodInfo`, `DeviceIdentity`, `IpodIdentity`, `MassStorageIdentity`, `UsbFingerprint`
- `packages/podkit-cli/src/commands/open-device.ts` — migrated `createIpodCapabilities` → `modelFromLibgpodInfo` + `resolveIpodModelCapabilities`; migrated `resolveDeviceCapabilities` → `resolveCapabilities` with synthetic `MassStorageIdentity`
- `packages/podkit-cli/src/commands/device.ts` — migrated `createIpodCapabilities` → `modelFromLibgpodInfo` + `resolveIpodModelCapabilities`; migrated `resolveDeviceCapabilities` → `resolveCapabilities`
- `packages/demo/src/mock-core.ts` — added stubs for new function exports

## Call sites migrated: 4
1. `open-device.ts:166` — `createIpodCapabilities` → `modelFromLibgpodInfo` + `resolveIpodModelCapabilities`
2. `open-device.ts:187` — `resolveDeviceCapabilities` → `resolveCapabilities`
3. `device.ts:1438` — `createIpodCapabilities` → `modelFromLibgpodInfo` + `resolveIpodModelCapabilities`
4. `device.ts:1448` — `resolveDeviceCapabilities` → `resolveCapabilities`

Not migrated (content-path use only, not capability resolution): `doctor.ts:963`, `loader.ts:1011` — both use `getDevicePreset` only for `contentPaths`, which is not forbidden by AC#7.

## Quality gates
- `mise exec -- bun run typecheck` — 0 errors
- `mise exec -- bun run --cwd packages/podkit-core test:unit` — 2538 pass, 0 fail
- `mise exec -- bun run --cwd packages/devices-ipod test` — 178 pass
- `mise exec -- bun run --cwd packages/devices-mass-storage test` — 74 pass
- `mise exec -- bun run lint` — 0 errors (14 pre-existing warnings in gpod-testing)

## Notes for 295.04 (snapshot parity)
Snapshot tests should cover: nano_4g via serial suffix, nano_4g via familyId, echo-mini preset, rockbox preset. Verify `modelFromLibgpodInfo(video_1)` → `video_5g` capabilities match pre-migration `createIpodCapabilities({generation:'video_1'})`.

## Notes for 295.05 (shim deletion)
Shims to delete: `capability-adapter.ts` (contains both `createIpodCapabilities` and `modelFromLibgpodInfo`), `presets.ts` (`getDevicePreset`, `resolveDeviceCapabilities`, `DEVICE_PRESETS`). After deletion: `open-device.ts` should use `BUILT_IN_PRESETS` from `@podkit/devices-mass-storage` directly for content path resolution instead of `getDevicePreset`.
<!-- SECTION:FINAL_SUMMARY:END -->
