/**
 * @podkit/device-types — shared device capability and identity types
 *
 * Foundational type definitions used across the podkit ecosystem.
 * Canonical home for `DeviceCapabilities`, `UsbFingerprint`, `DeviceIdentity`,
 * `ParsedFirmware`, and the `DeviceAddIntent` CLI hint shape.
 *
 * @module
 */

export type {
  DeviceArtworkSource,
  AudioCodec,
  AudioContainer,
  AudioNormalizationMode,
  DeviceCapabilities,
} from './capabilities.js';
export {
  ARTWORK_SOURCES,
  AUDIO_CODECS,
  AUDIO_CONTAINERS,
  CODEC_CANONICAL_CONTAINER,
} from './capabilities.js';

export type {
  UsbFingerprint,
  IpodIdentity,
  MassStorageIdentity,
  DeviceIdentity,
} from './identity.js';

export type { FirmwareCapabilities, ParsedFirmware } from './firmware.js';

export type { DeviceAddIntent } from './provider.js';

export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGenerationIdLike,
  IpodModelSource,
  IpodModel,
} from './ipod-model.js';
export { IPOD_GENERATION_IDS } from './ipod-model.js';

export type { ReadinessUnsupportedReason } from './unsupported-reason.js';

export type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from './subprocess.js';

// Inheritance-resolution primitive — used by config resolver, capability
// resolver, and any other walk that needs `{ value, source }` provenance.
export type { Resolved, ResolutionLayer } from './resolved.js';
export { resolveChain, resolveChainOptional, projectResolved } from './resolved.js';

// Provenance-tracked capabilities (shape used by `getCapabilities` and
// `resolveCapabilities` when a consumer needs to know which inheritance
// layer contributed each field).
export type { CapabilitySource, ResolvedDeviceCapabilities } from './resolved-capabilities.js';
