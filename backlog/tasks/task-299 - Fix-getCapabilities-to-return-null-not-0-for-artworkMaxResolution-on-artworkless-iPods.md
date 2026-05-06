---
id: TASK-299
title: >-
  Fix getCapabilities() to return null (not 0) for artworkMaxResolution on
  artworkless iPods
status: To Do
assignee: []
created_date: '2026-05-06 22:04'
labels:
  - phase-4
  - review-debt
dependencies: []
references:
  - packages/devices-ipod/src/capabilities.ts
  - packages/devices-ipod/src/capabilities.test.ts
  - packages/podkit-core/src/device/capability-adapter.ts
  - packages/podkit-core/src/device/capability-adapter.test.ts
  - packages/device-types/src/capabilities.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

`getCapabilities()` in `packages/devices-ipod/src/capabilities.ts` returns `artworkMaxResolution: 0` for iPod generations with no artwork support (classic 1G–4G, mini 1G, nano 1G/2G, all shuffles). The `DeviceCapabilities` interface in `@podkit/device-types` documents `null` as the sentinel for "no artwork support" — `0` is semantically incorrect.

## Root cause

`IpodGeneration.artworkMaxResolution` (in `types.ts`) uses `0` as the no-artwork sentinel. `getCapabilities()` passes this through directly:

```ts
const artworkMaxResolution = gen.artworkMaxResolution; // 0 for no-artwork devices
```

But `DeviceCapabilities.artworkMaxResolution: number | null` defines `null` as the no-artwork sentinel.

## Evidence

- `capability-adapter.test.ts` line 37: the legacy `createIpodCapabilities()` returns `null` (verified with `toBeNull()`) when `supportsArtwork: false`.
- `ipod/capabilities.ts` (old code, now deprecated): calls `getArtworkMaxResolution()` which returns `null`, checked via `artworkMaxResolution !== null && artworkMaxResolution > 0`.
- The parity test in `devices-ipod/src/capabilities.test.ts` uses a custom `referenceCreateIpodCapabilities` that returns `0` (not `null`) for no-artwork — so it does NOT catch this divergence from the real legacy adapter.

## Fix

In `capabilities.ts`:
```ts
const artworkMaxResolution = gen.artworkMaxResolution > 0 ? gen.artworkMaxResolution : null;
const artworkSources: DeviceArtworkSource[] = artworkMaxResolution !== null ? ['database'] : [];
```

Also update `capabilities.test.ts` `referenceCreateIpodCapabilities` to return `null` (not `0`) when `supportsArtwork: false`, so parity tests catch future regressions.

## Current impact

Low — no runtime bug in P3. The sync pipeline only uses `artworkMaxResolution` for embedded artwork resize (mass-storage), not for iPod database artwork. The `0 vs null` difference is invisible today. However, when P4 migrates `open-device.ts` to use `getCapabilities()` instead of `createIpodCapabilities()`, callers doing `artworkMaxResolution === null` checks would misbehave for artworkless iPods.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getCapabilities() returns artworkMaxResolution: null for classic_1g, classic_2g, classic_3g, classic_4g, mini_1g, shuffle_* and other artworkless generations
- [ ] #2 parity test referenceCreateIpodCapabilities updated to use null (not 0) for no-artwork case
- [ ] #3 capabilities.test.ts parity assertions still pass
- [ ] #4 No existing tests broken
<!-- AC:END -->
