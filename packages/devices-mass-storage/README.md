# @podkit/devices-mass-storage

User-extensible mass-storage preset framework for podkit — Echo Mini, Rockbox, generic DAPs, and custom devices.

## Why this package exists

`@podkit/devices-mass-storage` lets users register their own DAP without forking podkit. It provides a preset system (a capability snapshot + content directory layout) that the sync engine, transcoding pipeline, and enumeration framework all consume. USB VID/PID hints enable auto-classification at `device add` time — no `--type echo-mini` flag needed when the Echo Mini is plugged in.

The preset data was extracted from `podkit-core/device/presets.ts` and the relevant parts of `mass-storage-utils.ts`. The architecture is deliberately stateless: there is no global registry. Callers compose the preset map and pass it through.

## Public API

### Headline functions

**`definePreset(input: PresetDefinition, opts?: DefinePresetOptions): MassStoragePreset`**

Pure constructor for a fully-resolved preset. Resolves `extends` chains eagerly at construction time so all downstream lookups see a flat, merged preset.

```ts
import { definePreset, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';

// Custom DAP that extends 'generic'
const myDap = definePreset({
  id: 'my-dap',
  extends: 'generic',
  capabilities: {
    supportedAudioCodecs: ['aac', 'mp3', 'flac', 'ogg'],
    artworkMaxResolution: 300,
  },
  contentPaths: {
    musicDir: 'MUSIC',
  },
});

// Two Echo Minis configured differently (without touching the shared preset)
const echoMini1 = definePreset({
  id: 'echo-mini-256',
  extends: 'echo-mini',
  capabilities: { artworkMaxResolution: 256 },
});
```

Throws if `id` is empty, if `extends` references an unknown preset, or if a cycle is detected.

**`identify(usb: UsbConnectionInfo, presets?: Record<string, MassStoragePreset>): MassStorageIdentity | null`**

Match a USB device against the VID/PID hint table. Returns a `MassStorageIdentity` tagged with the matched preset ID, or `null` if the device is not recognised.

```ts
import { identify } from '@podkit/devices-mass-storage';

const identity = identify({ vendorId: '0x071b', productId: '0x3203' });
// → { kind: 'mass-storage', presetId: 'echo-mini' }
```

The optional `presets` argument restricts matching to presets that are in the caller's active registry.

**`getCapabilities(identity: MassStorageIdentity, opts: GetCapabilitiesOptions): DeviceCapabilities`**

Resolve `DeviceCapabilities` for a mass-storage device. Preset lookup order: `opts.presets[identity.presetId]` → built-in fallback → `'generic'`. Per-call `opts.overrides` are applied last.

```ts
import { getCapabilities, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';

const caps = getCapabilities(identity, {
  presets: BUILT_IN_PRESETS,
  overrides: { artworkMaxResolution: 256 },
});
```

**`createMassStorageProvider(presets: Record<string, MassStoragePreset>): DeviceProvider<MassStorageIdentity>`**

Factory that returns a `DeviceProvider` for use with `enumerateConnectedDevices` in podkit-core. Each call produces an independent provider scoped to the supplied preset map.

```ts
import { createMassStorageProvider, BUILT_IN_PRESETS, definePreset } from '@podkit/devices-mass-storage';

const myDap = definePreset({ id: 'my-dap', extends: 'generic' });
const provider = createMassStorageProvider({ ...BUILT_IN_PRESETS, 'my-dap': myDap });
```

Include `'generic'` in the preset map to enable fallback detection for any unrecognised non-iPod USB mass-storage device. Omit it to require explicit VID/PID recognition.

### Constants and data

| Export | Contents |
|---|---|
| `BUILT_IN_PRESETS` | Record of the three built-in presets: `echo-mini`, `rockbox`, `generic` |
| `BUILT_IN_PRESET_IDS` | Const array `['echo-mini', 'rockbox', 'generic']` |
| `USB_PRESET_HINTS` | VID/PID hint table mapping known devices to built-in preset IDs |

### Types

| Type | Description |
|---|---|
| `MassStoragePreset` | Fully-resolved preset: `DeviceCapabilities` + `ContentPaths` |
| `ContentPaths` | Default content directory layout (`musicDir`, `moviesDir`, `tvShowsDir`) |
| `BuiltInPresetId` | Literal union `'echo-mini' \| 'rockbox' \| 'generic'` |
| `PresetId` | `BuiltInPresetId \| (string & {})` — accepts user strings with built-in autocomplete |
| `PresetDefinition` | Input shape for `definePreset` |
| `UsbPresetHint` | A single entry in the USB VID/PID hint table |

## Design notes

- **Stateless by design.** There is no global preset registry. The caller composes the preset map and passes it to `getCapabilities` and `createMassStorageProvider`. Two providers with different preset maps are fully independent.
- **Eager `extends` resolution.** `definePreset` resolves the inheritance chain at construction time. The stored `MassStoragePreset` is always flat; no chained lookups at capability-resolution time.
- **Arrays replace, not merge.** When merging capabilities during `extends` resolution or per-call overrides, arrays (e.g. `supportedAudioCodecs`) replace entirely — consistent with `resolveDeviceCapabilities` in podkit-core.
- **VID/PID hints are additive.** `USB_PRESET_HINTS` grows as new devices are researched. Exact VID+PID matches take precedence; vendor-only matches are supported for future cases where a vendor's entire line maps to one preset.

## Dependencies

- `@podkit/device-types` — shared type interfaces (`DeviceCapabilities`, `DeviceProvider`, `MassStorageIdentity`, etc.)
