# @podkit/device-types

Shared TypeScript type definitions for podkit's device capability and identity model. No runtime code.

## Why this package exists

Both `@podkit/core` and `@podkit/ipod-firmware` need the same foundational types — `DeviceCapabilities`, `DeviceIdentity`, `ParsedFirmware`, and friends. Rather than duplicating them or introducing a circular dependency, they live here as a leaf package that neither depends on.

This is the canonical source of truth for these types across the podkit monorepo.

## Public API

| Export | Description |
|--------|-------------|
| `DeviceCapabilities` | Sync-engine decision surface — artwork sources, supported codecs, video support, normalization mode |
| `AudioCodec` | String union of natively playable audio codecs (`'aac' \| 'alac' \| 'mp3' \| ...`) |
| `AudioNormalizationMode` | `'soundcheck' \| 'replaygain' \| 'none'` |
| `DeviceArtworkSource` | `'database' \| 'embedded' \| 'sidecar'` |
| `UsbFingerprint` | Low-level USB descriptor fields (vendorId, productId, bus, devnum) |
| `DeviceIdentity` | Discriminated union: `IpodIdentity \| MassStorageIdentity` |
| `IpodIdentity` | iPod resolved from SysInfoExtended: firewireGuid, serialNumber, familyId |
| `MassStorageIdentity` | Generic USB mass-storage device: volumeUuid and/or serialNumber |
| `ParsedFirmware` | Result of a SysInfoExtended inquiry: GUID, serial, raw XML, structured capabilities |
| `FirmwareCapabilities` | Structured data from SysInfoExtended: audio/video codecs, artwork formats, RAM, dbVersion |
| `DeviceProvider<T>` | Interface for device-detection providers registered in the core enumeration layer |

## Usage

```typescript
import type {
  DeviceCapabilities,
  UsbFingerprint,
  DeviceIdentity,
} from '@podkit/device-types';

// Implement a custom device provider
import type { DeviceProvider } from '@podkit/device-types';

const myProvider: DeviceProvider = {
  id: 'my-device',
  async detect(fp: UsbFingerprint): Promise<DeviceIdentity | null> {
    if (fp.vendorId === '05ac' && fp.productId === '1261') {
      return { kind: 'ipod', firewireGuid: '...', serialNumber: '...', familyId: 0x78 };
    }
    return null;
  },
};
```

## Stability

These types are evolving through the P1–P4 device-capability architecture refactor (m-18). The surface is stable within each phase but may gain new optional fields or variants between phases. Consumers should use `import type` only — this package ships zero runtime code and has no dependencies.

During the refactor, treat any field documented as "optional" as potentially absent even on devices where you expect it to be present.
