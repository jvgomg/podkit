/**
 * Lookup functions for iPod model identification.
 *
 * Provides efficient indexed lookups across all identification axes:
 * USB product ID, SysInfo model number, serial suffix, and generation info.
 *
 * @module
 */

import { GENERATIONS } from './tables/generations.js';
import { IPOD_USB_IDS, type UsbProductIdEntry } from './tables/usb-ids.js';
import { MODEL_NUMBERS, LEGACY_MODEL_OVERRIDES, type ModelEntry } from './tables/model-numbers.js';
import { SERIAL_TO_MODEL } from './tables/serials.js';
import { GENERATION_ID_TO_LIBGPOD, type LibgpodGenerationName } from './tables/libgpod-mapping.js';
import type {
  IpodChecksumType,
  IpodGeneration,
  IpodGenerationId,
  IpodModelVariant,
} from './types.js';

// ── Build lookup indexes (once at module load) ───────────────────────────────

const USB_INDEX = new Map<string, UsbProductIdEntry>();
for (const [id, entry] of Object.entries(IPOD_USB_IDS)) {
  USB_INDEX.set(id.toLowerCase(), entry);
}

const MODEL_INDEX = new Map<string, ModelEntry>();
for (const [num, entry] of Object.entries(MODEL_NUMBERS)) {
  MODEL_INDEX.set(num.toUpperCase(), entry);
}
// Add legacy overrides (without overwriting primary entries)
for (const [num, override] of Object.entries(LEGACY_MODEL_OVERRIDES)) {
  if (!MODEL_INDEX.has(num.toUpperCase())) {
    MODEL_INDEX.set(num.toUpperCase(), override);
  }
}

const SERIAL_INDEX = new Map<string, string>();
for (const [suffix, model] of Object.entries(SERIAL_TO_MODEL)) {
  SERIAL_INDEX.set(suffix.toUpperCase(), model.toUpperCase());
}

// ── Normalisation helpers ────────────────────────────────────────────────────

function normaliseProductId(productId: string): string {
  const lower = productId.toLowerCase();
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

function normaliseModelNum(modelNumStr: string): { stripped: string; full: string } {
  const upper = modelNumStr.toUpperCase();
  const stripped = /^[MPF]/.test(upper) ? upper.slice(1) : upper;
  return { stripped, full: upper };
}

// ── Public lookup API ────────────────────────────────────────────────────────

/**
 * Look up a human-readable model name from an Apple USB product ID.
 *
 * @param productId - Hex product ID string, with or without leading zeros
 *                    (e.g., "0x1209", "1209")
 * @returns Model name if the ID is in the lookup table, undefined otherwise
 */
export function lookupByUsbId(productId: string): UsbProductIdEntry | undefined {
  return USB_INDEX.get(normaliseProductId(productId));
}

/**
 * Look up iPod model info from a serial number suffix (last 3 characters).
 *
 * @param serialSuffix - Last 3 characters of the iPod serial number
 * @returns Model variant info, or undefined if the suffix is unknown
 */
export function lookupBySerial(serialSuffix: string): IpodModelVariant | undefined {
  if (!serialSuffix || serialSuffix.length !== 3) return undefined;

  const modelNumber = SERIAL_INDEX.get(serialSuffix.toUpperCase());
  if (!modelNumber) return undefined;

  const entry = MODEL_INDEX.get(modelNumber);
  if (!entry) {
    // Model number exists in serial table but not in model table.
    return {
      modelNumber,
      displayName: `Unknown iPod (model M${modelNumber})`,
      generation: 'classic_1g', // fallback
    };
  }

  return {
    modelNumber,
    displayName: entry.displayName,
    generation: entry.generation,
    capacityGb: entry.capacityGb,
    color: entry.color,
  };
}

/**
 * Look up iPod model info from a SysInfo ModelNumStr.
 *
 * Apple uses single-letter prefixes that all map to the same underlying
 * hardware: M (retail), P (service stock / replacement unit), F (factory
 * refurbished). The registry is keyed on the bare suffix, so we strip any
 * of those before looking up.
 *
 * @param modelNumStr - The `ModelNumStr` value from `iPod_Control/Device/SysInfo`
 *                      (e.g., "MA147", "P9804", "F9436")
 * @returns Model entry if known, undefined otherwise
 */
export function lookupByModelNumber(modelNumStr: string): ModelEntry | undefined {
  const { stripped, full } = normaliseModelNum(modelNumStr);
  return MODEL_INDEX.get(stripped) ?? MODEL_INDEX.get(full);
}

/**
 * Get generation metadata for a generation identifier.
 *
 * @param generationId - Generation identifier
 * @returns Generation metadata
 */
export function lookupGenerationInfo(generationId: IpodGenerationId): IpodGeneration {
  return GENERATIONS[generationId];
}

// ── Backward-compatible named functions (mirrors core ipod-models.ts) ────────

/**
 * Look up a human-readable model name from an Apple USB product ID.
 *
 * @deprecated Prefer `lookupByUsbId` which returns the full entry.
 */
export function lookupIpodModel(productId: string): string | undefined {
  return lookupByUsbId(productId)?.displayName;
}

/**
 * Look up a human-readable model name from an iPod SysInfo model number string.
 *
 * @deprecated Prefer `lookupByModelNumber` which returns the full entry.
 */
export function lookupIpodModelByNumber(modelNumStr: string): string | undefined {
  return lookupByModelNumber(modelNumStr)?.displayName;
}

/**
 * Get the checksum type required for a device identified by its ModelNumStr.
 */
export function getChecksumTypeByModelNumber(modelNumStr: string): IpodChecksumType | undefined {
  const entry = lookupByModelNumber(modelNumStr);
  if (!entry) return undefined;
  return GENERATIONS[entry.generation].checksumType;
}

/**
 * Look up the generation identifier for an iPod from its SysInfo model number.
 */
export function lookupGenerationByModelNumber(modelNumStr: string): IpodGenerationId | undefined {
  return lookupByModelNumber(modelNumStr)?.generation;
}

/**
 * Look up a specific iPod model variant from a serial number suffix.
 *
 * The last 3 characters of an iPod serial number identify the exact model
 * variant (color, capacity, generation).
 *
 * @deprecated Prefer `lookupBySerial`.
 */
export function lookupIpodModelBySerial(serialSuffix: string): IpodModelVariant | undefined {
  return lookupBySerial(serialSuffix);
}

/**
 * Get generation metadata for a generation identifier.
 *
 * @deprecated Prefer `lookupGenerationInfo`.
 */
export function getGenerationInfo(generationId: IpodGenerationId): IpodGeneration {
  return lookupGenerationInfo(generationId);
}

/**
 * Get the checksum type required for a given iPod generation.
 */
export function getChecksumType(generationId: IpodGenerationId): IpodChecksumType {
  return GENERATIONS[generationId].checksumType;
}

/**
 * Look up the generation identifier for a USB product ID.
 */
export function lookupGenerationByProductId(productId: string): IpodGenerationId | undefined {
  return lookupByUsbId(productId)?.generation;
}

/**
 * Map an IpodGenerationId (detection-layer) to a libgpod IpodGeneration name.
 *
 * Returns 'unknown' for generations not supported by libgpod (nano_7g, touch 5-7g).
 */
export function toLibgpodGeneration(generationId: IpodGenerationId): LibgpodGenerationName {
  return GENERATION_ID_TO_LIBGPOD[generationId];
}
