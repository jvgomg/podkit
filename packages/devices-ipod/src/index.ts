/**
 * @podkit/devices-ipod — iPod generation tables, USB ID lookup, and model identification
 *
 * Provides multiple access patterns for iPod device identification:
 * - USB product ID → generation + display name
 * - SysInfo ModelNumStr → display name + generation + capacity + color
 * - Serial number suffix (last 3 chars) → model variant
 * - Generation → checksum type required for iTunesDB
 * - Generation → libgpod sequential naming
 *
 * @module
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGenerationIdLike,
  IpodGeneration,
  IpodModel,
  IpodModelSource,
  IpodModelVariant,
} from './types.js';

export { IPOD_GENERATION_IDS } from './types.js';

// ── Tables ───────────────────────────────────────────────────────────────────

export { GENERATIONS } from './tables/generations.js';
export { IPOD_USB_IDS, type UsbProductIdEntry } from './tables/usb-ids.js';
export { MODEL_NUMBERS, LEGACY_MODEL_OVERRIDES, type ModelEntry } from './tables/model-numbers.js';
export { SERIAL_TO_MODEL } from './tables/serials.js';
export {
  GENERATION_ID_TO_LIBGPOD,
  type LibgpodGenerationName,
  formatGeneration,
} from './tables/libgpod-mapping.js';
export {
  UNSUPPORTED_IPOD_PRODUCT_IDS,
  lookupUnsupportedReason,
  lookupIosRangeFallbackReason,
  lookupUnsupportedReadinessReason,
} from './tables/unsupported.js';

// ── Lookups ───────────────────────────────────────────────────────────────────

export {
  // Primary API
  lookupByUsbId,
  lookupBySerial,
  lookupByModelNumber,
  lookupByFamilyId,
  lookupGenerationInfo,
  FAMILY_ID_TO_GENERATION,
  getChecksumTypeByModelNumber,
  lookupGenerationByModelNumber,
  getChecksumType,
  lookupGenerationByProductId,
  toLibgpodGeneration,
} from './lookups.js';

// ── Identity facade ───────────────────────────────────────────────────────────

export { identify, type IpodModelInput } from './identity.js';

// ── Classifier ────────────────────────────────────────────────────────────────

export {
  classifyAsIpod,
  type IpodClassification,
  type ClassifiableUsbDevice as IpodClassifiableUsbDevice,
} from './classify.js';

// ── Capabilities ──────────────────────────────────────────────────────────────

export { getCapabilities, type GetCapabilitiesOptions } from './capabilities.js';

export {
  IPOD_CAPABILITY_KEYS,
  validateCapabilityOverrides,
  type CapabilityOverrideErrorCode,
  type CapabilityOverrideValidationError,
  type CapabilityOverrideValidationResult,
} from './validate-overrides.js';

// ── Provider ──────────────────────────────────────────────────────────────────

export { ipodProvider } from './provider.js';

// ── libgpod-naming surface ────────────────────────────────────────────────────

export {
  getUnsupportedReasonByLibgpodName,
  type UnsupportedGenerationKind,
} from './tables/libgpod-mapping.js';

// ── Model resolver ────────────────────────────────────────────────────────────

export { resolveIpodModel, type ResolveModelInput } from './resolve.js';
