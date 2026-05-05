/**
 * @podkit/device-types — shared device capability and identity types
 *
 * Foundational type definitions used across the podkit ecosystem.
 * Canonical home for `DeviceCapabilities`, `UsbFingerprint`, `DeviceIdentity`,
 * `ParsedFirmware`, and the `DeviceProvider` interface.
 *
 * @module
 */

export type {
  DeviceArtworkSource,
  AudioCodec,
  AudioNormalizationMode,
  DeviceCapabilities,
} from './capabilities.js';

export type {
  UsbConnectionInfo,
  UsbFingerprint,
  IpodIdentity,
  MassStorageIdentity,
  DeviceIdentity,
} from './identity.js';

export type { FirmwareCapabilities, ParsedFirmware } from './firmware.js';

export type { DeviceProvider } from './provider.js';
