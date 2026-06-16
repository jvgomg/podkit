---
id: TASK-427
title: >-
  Consolidate dual discovery frameworks: enumerateConnectedDevices vs
  discoverConnectedDevices
status: Done
assignee: []
created_date: '2026-06-15 21:52'
updated_date: '2026-06-16 22:32'
labels:
  - device-capability-architecture
  - follow-up
  - refactor
  - core
milestone: m-18
dependencies: []
priority: medium
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the m-18 DiscoveredDevice unification (commits `681b6afc` / `bded663d` / `572ad2f5` / `f734f903`), two parallel "what's plugged in?" surfaces coexist in `@podkit/core`:

1. **`enumerateConnectedDevices`** (`packages/podkit-core/src/device/enumeration.ts`) — provider-driven. Each `DeviceProvider` registers a classifier + `describeAddIntent`. Output: `EnumeratedDevice[]` with provider-attached identity + a flat `discovered: { diskIdentifier?, ... }` context bag. Consumer: `suggestAddIntents` only.

2. **`discoverConnectedDevices`** (`packages/podkit-core/src/device/discovery.ts`) — the new union framework. Internal pipeline: `enumerateUsb` → `classifyUsbDevices` → `reconcileDiscoveredDevices` against block-side `findIpodDevices`. Output: `DiscoveredDevice[]` (discriminated union over iPod / mass-storage / unsupported). Consumers: scan, add, info, init, doctor, all readiness paths.

Both walk the USB bus. Both classify devices. Neither reconciles with the block-device pipeline today (the provider framework drops block-side data entirely). The provider framework was the right shape for the cross-device "how would you add this?" hint, but its abstraction (per-provider classifiers + intent descriptors) is now duplicated by the union (`classifyUsbDevices` + `displayFor` + `DiscoveredDevice.kind`).

## What would consolidation look like?

Pick the simpler shape — likely `discoverConnectedDevices` returning `DiscoveredDevice[]`, with `describeAddIntent(d: DiscoveredDevice)` as a sidecar helper that dispatches on `kind`. The provider abstraction becomes one helper per kind rather than a runtime-registered list, mirroring how `displayFor` already works.

`suggestAddIntents` then takes `DiscoveredDevice[]` (or runs `discoverConnectedDevices` internally), maps to intents, and returns `DeviceAddIntent[]` as today.

## Investigation points

- Verify provider-framework extensibility was actually used (user-defined mass-storage presets touch this surface — they need to keep working).
- Check whether any future device class (Rockbox, generic mass-storage) needs a runtime-registered classifier or whether the per-kind helper pattern suffices.
- Decide what happens to `EnumeratedDevice` vs `DiscoveredDevice` — likely the former dies.

## Out of scope

This is a refactor only — no UX change. `suggestAddIntents`'s public output shape (`DeviceAddIntent[]`) stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Audit complete: identify every consumer of `enumerateConnectedDevices`, `EnumeratedDevice`, `DeviceProvider`, and document migration path
- [x] #2 `suggestAddIntents` consumes `DiscoveredDevice[]` (directly or via internal `discoverConnectedDevices` call); old multi-parameter shape gone
- [x] #3 `EnumeratedDevice` / `DeviceProvider` either deleted or scoped to "user-defined preset registration only" (if that's still needed)
- [x] #4 `describeAddIntent` becomes a per-kind dispatcher (e.g., in `@podkit/core/discovery` next to `displayFor`)
- [x] #5 No regression in `device add` scan-fallback behaviour — existing tests pass byte-identically
- [x] #6 Documentation updated where it refers to providers
- [x] #7 User-defined mass-storage preset extensibility still works (TASK-325 path)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Consolidated onto `discoverConnectedDevices` + the `DiscoveredDevice` discriminated union. The provider-driven `enumerateConnectedDevices` framework is gone.

**Surfaces deleted**:

- `packages/podkit-core/src/device/enumeration.ts` + `enumeration.test.ts` (the orchestrator + its tests)
- `packages/devices-ipod/src/provider.ts` + `provider.test.ts` (`ipodProvider` / `createIpodProvider`)
- `packages/devices-mass-storage/src/provider.ts` + `provider.test.ts` (`createMassStorageProvider`)
- `DeviceProvider` interface + `DiscoveredContext` from `@podkit/device-types` (no external consumer ever extended the provider list — provider construction lived entirely inside the CLI)
- Provider re-exports from each package's `index.ts`

**New surface** (in `packages/podkit-core/src/device/discovery.ts`):

- `describeAddIntent(d: DiscoveredDevice): DeviceAddIntent | null` — per-kind dispatcher, sibling to `displayFor`. Three module-private helpers (`describeAddIntentForIpod` / `…ForMassStorage` / `…ForUnsupported`) ported verbatim from the deleted provider bodies. Adding a new device kind now means one new function instead of a provider registration.
- `DiscoverConnectedDevicesOptions.massStoragePresets?: Record<string, MassStoragePreset>` — threaded through `classifyUsbDevices` so user-defined `[presets.X]` DAPs surface in discovery.

**`suggestAddIntents` rewritten** (`packages/podkit-core/src/device/add-intent.ts`):

```ts
export type SuggestAddIntentsOptions = DiscoverConnectedDevicesOptions;
export async function suggestAddIntents(opts) {
  const discovered = await discoverConnectedDevices(opts);
  return discovered.map(describeAddIntent).filter(intent => intent !== null);
}
```

**CLI callsites updated** to thread `massStoragePresets: mergedPresets(config)` through to discovery:

- `commands/device/scan.ts`
- `commands/device/info.ts`
- `commands/device/init.ts`
- `commands/device/add.ts` (both the scan-fallback intent suggestion + the unsupported-iPod lookup)
- `commands/doctor.ts`

**Before vs after — user-visible**:

`device scan`, `device info`, `device init`, and `doctor` previously recognised only the built-in mass-storage presets, even when the user had declared additional DAPs via `[presets.X]` in their config. `device add`'s scan-fallback was the only path that honored user presets (it built a provider with merged presets baked in). The consolidation closes the gap — every discovery surface now sees the same merged registry.

**Tests**:

- `add-intent.test.ts` rewritten — covers `describeAddIntent` per-kind (8 cases: iPod unsupported, iPod USB-only, iPod block-only, mass-storage with/without diskIdentifier, mass-storage block-only, unsupported device) + `suggestAddIntents` composition (3 cases including unsupported-platform skip).
- `device-add.unit.test.ts` — removed the `enumerateConnectedDevices with real providers and mocked USB walk` describe block; equivalent coverage now lives in `add-intent.test.ts` + `discovery.test.ts`.
- `packages/demo/src/mock-core.ts` — stub `enumerateConnectedDevices` removed.

**ACs satisfied**: 1, 2, 3, 4, 5, 6, 7.

**Quality gates**: workspace build green; 3166 `@podkit/core` unit tests + 1605 podkit-cli unit tests + 67 integration tests pass.

**Changeset**: `.changeset/consolidate-discovery-frameworks.md` — minor bump across `podkit`, `@podkit/core`, `@podkit/device-types`, `@podkit/devices-ipod`, `@podkit/devices-mass-storage`. Includes migration snippet for any out-of-tree consumer of `suggestAddIntents`.
<!-- SECTION:FINAL_SUMMARY:END -->
