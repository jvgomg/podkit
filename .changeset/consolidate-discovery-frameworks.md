---
"podkit": minor
"@podkit/core": minor
"@podkit/device-types": minor
"@podkit/devices-ipod": minor
"@podkit/devices-mass-storage": minor
---

Consolidate dual device-discovery frameworks (TASK-427).

`@podkit/core`'s provider-driven `enumerateConnectedDevices` framework is
gone. The discriminated `DiscoveredDevice` union returned by
`discoverConnectedDevices` is now the single discovery surface; every CLI
command (`device scan`, `device add`, `device info`, `device init`, `doctor`,
plus the `suggestAddIntents` add-hint helper) consumes it.

**User-visible win**: `device scan`, `device info`, `device init`, and
`doctor` now recognise user-defined `[presets.X]` mass-storage DAPs in
addition to the built-in set — matching what `device add` already did.
Before the consolidation, only the `device add` scan-fallback consulted
user presets; the rest of the CLI silently saw only built-ins. Now every
discovery path threads `mergedPresets(config)` through to
`classifyUsbDevices`.

**Library / framework changes**:

- `enumerateConnectedDevices`, `EnumeratedDevice`, `EnumerateOptions`
  removed from `@podkit/core`. Use `discoverConnectedDevices`.
- `DeviceProvider` interface + `DiscoveredContext` removed from
  `@podkit/device-types`. The runtime-registered provider list is
  replaced by a per-kind `describeAddIntent(d: DiscoveredDevice)`
  dispatcher in `@podkit/core/discovery`, sibling to `displayFor`.
- `ipodProvider` / `createIpodProvider` removed from `@podkit/devices-ipod`.
- `createMassStorageProvider` removed from `@podkit/devices-mass-storage`.
- `DeviceAddIntent` shape kept (still the CLI hint contract).
- New `DiscoverConnectedDevicesOptions.massStoragePresets` option threads
  user presets into the classification step.
- `suggestAddIntents` signature changed: takes
  `DiscoverConnectedDevicesOptions` (deviceManager + optional presets +
  test seams). The `providers: DeviceProvider[]` parameter is gone.

**Migration**:

```ts
// Before:
import { suggestAddIntents } from '@podkit/core';
import { ipodProvider } from '@podkit/devices-ipod';
import { createMassStorageProvider } from '@podkit/devices-mass-storage';

const intents = await suggestAddIntents({
  providers: [ipodProvider, createMassStorageProvider(presets)],
});

// After:
import { suggestAddIntents, getDeviceManager } from '@podkit/core';

const intents = await suggestAddIntents({
  deviceManager: getDeviceManager(),
  massStoragePresets: presets, // optional; defaults to built-ins
});
```

Closes TASK-427.
