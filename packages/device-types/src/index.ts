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
export { ARTWORK_SOURCES, AUDIO_CODECS } from './capabilities.js';

export type {
  UsbFingerprint,
  IpodIdentity,
  MassStorageIdentity,
  DeviceIdentity,
} from './identity.js';

export type { FirmwareCapabilities, ParsedFirmware } from './firmware.js';

export type { DeviceProvider, DeviceAddIntent, DiscoveredContext } from './provider.js';

export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGenerationIdLike,
  IpodModelSource,
  IpodModel,
} from './ipod-model.js';
export { IPOD_GENERATION_IDS } from './ipod-model.js';
