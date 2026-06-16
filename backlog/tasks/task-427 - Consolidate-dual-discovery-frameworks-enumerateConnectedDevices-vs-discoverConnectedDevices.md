---
id: TASK-427
title: >-
  Consolidate dual discovery frameworks: enumerateConnectedDevices vs
  discoverConnectedDevices
status: In Progress
assignee: []
created_date: '2026-06-15 21:52'
updated_date: '2026-06-16 22:17'
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
- [ ] #1 Audit complete: identify every consumer of `enumerateConnectedDevices`, `EnumeratedDevice`, `DeviceProvider`, and document migration path
- [ ] #2 `suggestAddIntents` consumes `DiscoveredDevice[]` (directly or via internal `discoverConnectedDevices` call); old multi-parameter shape gone
- [ ] #3 `EnumeratedDevice` / `DeviceProvider` either deleted or scoped to "user-defined preset registration only" (if that's still needed)
- [ ] #4 `describeAddIntent` becomes a per-kind dispatcher (e.g., in `@podkit/core/discovery` next to `displayFor`)
- [ ] #5 No regression in `device add` scan-fallback behaviour — existing tests pass byte-identically
- [ ] #6 Documentation updated where it refers to providers
- [ ] #7 User-defined mass-storage preset extensibility still works (TASK-325 path)
<!-- AC:END -->
