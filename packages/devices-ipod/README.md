# @podkit/devices-ipod

Pure TypeScript iPod generation tables, model lookups, and capability synthesis. No libgpod, no I/O.

## Why this package exists

`@podkit/devices-ipod` is the canonical home for everything podkit needs to classify an iPod and determine what it can do. The data was extracted from `podkit-core/device/ipod-models.ts` so that packages outside core — the enumeration framework, the doctor checks, the CLI readiness pipeline — can consume iPod identity and capabilities without pulling in the entire sync engine.

`getCapabilities` is purely table-driven — no libgpod coupling. Snapshot parity was verified in tests across all 29 generations (the 4 that were libgpod `unknown` degenerate cases are now correctly populated from the table). The legacy `createIpodCapabilities` adapter was removed from `@podkit/core` in P4; use `resolveCapabilities` from `@podkit/core` or `getCapabilities` from this package directly.

## Public API

### Headline functions

**`identify(input: IpodModelInput): IpodModel | undefined`**

Multi-axis lookup facade. Accepts a discriminated input and routes to the appropriate lookup table.

```ts
import { identify } from '@podkit/devices-ipod';

// From USB product ID — generation-level only
identify({ from: 'usb', productId: '0x1260' });
// → { displayName: 'iPod nano 2nd generation', generationId: 'nano_2g', source: 'usb', ... }

// From SysInfo model number — full variant (color, capacity)
identify({ from: 'sysinfo', modelNumStr: 'MA477' });
// → { displayName: 'iPod nano 2GB Silver (2nd Generation)', color: 'Silver', source: 'sysinfo', ... }

// From serial number — full variant from last 3 characters
identify({ from: 'serial', serialNumber: '5U828GFNYXX' });
// → { displayName: 'iPod nano 8GB Black (3rd Generation)', color: 'Black', source: 'serial', ... }
```

**`getCapabilities(identity: IpodModel, opts?: GetCapabilitiesOptions): DeviceCapabilities`**

Table-driven capability synthesis. No libgpod dependency. Optionally enriched with a firmware overlay from `@podkit/ipod-firmware`.

```ts
import { identify, getCapabilities } from '@podkit/devices-ipod';

const model = identify({ from: 'usb', productId: '0x1261' });
const caps = getCapabilities(model!);
// → { supportsVideo: true, artworkMaxResolution: 320, supportedAudioCodecs: ['aac', 'mp3'], ... }

// With firmware overlay (adds codecs the device advertises at runtime)
const caps2 = getCapabilities(model!, { firmware });
```

**`ipodProvider: DeviceProvider<IpodIdentity>`**

Used by `enumerateConnectedDevices` in podkit-core. Pre-filters by Apple VID and known iPod product IDs, then calls `inquireFirmware` to obtain the full identity (FireWire GUID, serial number, family ID). For the offline / table-only case, use `lookupByUsbId` or `identify` directly without the provider.

### Primary lookups

| Function | Input | Returns |
|---|---|---|
| `lookupByUsbId(productId)` | USB product ID (hex string) | `UsbProductIdEntry \| undefined` |
| `lookupBySerial(serialSuffix)` | Last 3 chars of serial | `IpodModelVariant \| undefined` |
| `lookupByModelNumber(modelNumStr)` | SysInfo `ModelNumStr` (e.g. `"MA477"`) | `ModelEntry \| undefined` |
| `lookupGenerationInfo(generationId)` | `IpodGenerationId` | `IpodGeneration` |

`lookupByModelNumber` strips the M/P/F retail/service/factory prefix automatically.

### Tables (exposed for advanced callers and debugging)

| Export | Contents |
|---|---|
| `GENERATIONS` | `IpodGenerationId → IpodGeneration` metadata (display name, checksum type, codec flags, artwork resolution) |
| `IPOD_USB_IDS` | Apple USB product ID → generation + display name |
| `MODEL_NUMBERS` | SysInfo model number → generation + variant details |
| `SERIAL_TO_MODEL` | Serial suffix (3 chars) → model number |
| `ARTWORK_MAX_RESOLUTION` | Generation → max artwork pixel dimension |
| `GENERATION_ID_TO_LIBGPOD` | Generation → libgpod sequential naming |
| `IPOD_GENERATION_IDS` | Const array of all 29 generation IDs |

### Types

| Type | Description |
|---|---|
| `IpodGenerationId` | Literal union of all 29 generation identifiers |
| `IpodGenerationIdLike` | `IpodGenerationId \| (string & {})` — accepts user-defined strings without losing autocomplete |
| `IpodGeneration` | Per-generation metadata record |
| `IpodModel` | Identified model result (generation + optional variant details) |
| `IpodModelVariant` | Full variant from serial/model-number lookup (color, capacity, model number) |
| `IpodChecksumType` | `'none' \| 'hash58' \| 'hash72' \| 'hashAB'` |

## Design notes

- **`getCapabilities` is libgpod-free.** Capability synthesis consults only the `GENERATIONS` table and an optional firmware overlay. The `createIpodCapabilities` adapter that depended on `LibgpodDeviceInfo` was removed from `@podkit/core` in P4; `resolveCapabilities` from `@podkit/core` is the replacement.
- **`IpodGenerationId` literal-plus-runtime union pattern.** `IPOD_GENERATION_IDS` (const array) enables runtime iteration; `IpodGenerationId` (type alias) provides compile-time autocomplete; `IpodGenerationIdLike` accepts user strings without losing the autocomplete suggestions.
- **Model number prefixes.** Apple uses M (retail), P (service stock), F (factory refurbished). All three map to the same hardware; `lookupByModelNumber` strips any prefix before lookup.
- **Each `identify` call is independent.** No merging of multiple sources — callers hold multiple `IpodModel` values from different axes and pick or compare as needed.

## Dependencies

- `@podkit/device-types` — shared type interfaces (`DeviceCapabilities`, `DeviceProvider`, `IpodIdentity`, etc.)
- `@podkit/ipod-firmware` — used only by `ipodProvider` for live SCSI/USB inquiry; the table lookups and `getCapabilities` have no I/O dependencies
