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

// ── FamilyID → IpodGenerationId mapping ─────────────────────────────────────
//
// Apple's FamilyID is a small integer embedded in SysInfoExtended. It identifies
// the iPod family/generation at the firmware level. Values are confirmed from
// real device captures in documents/sysinfo-captures/ and documents/test-devices.md.
//
// One generation can cover multiple FamilyID values (e.g. 5G and 5.5G share
// FamilyID 6). When multiple FamilyIDs map to the same family, prefer the one
// that gives the richer capability set (video_5_5g > video_5g is the same caps).
//
// Values from real captures:
//   3  → mini_2g   (iPod mini 2G 4GB, SCSI inquiry)
//   6  → video_5g  (iPod 5G Video iFlash, SCSI inquiry; covers 5.5G too)
//   9  → nano_2g   (iPod nano 2G 4GB Green, SCSI inquiry)
//  15  → nano_4g   (iPod nano 4G 8GB Black, SCSI inquiry)
//  18  → nano_7g   (iPod nano 7G 16GB, SCSI+USB inquiry)
//
// Additional values sourced from community research (gtkpod, libgpod sources,
// iPod Linux wiki) — marked with (research):
//   1  → classic_3g  (iPod 3G, 10/15/20/30/40GB)
//   2  → classic_4g  (iPod 4G, 20/40GB mono)
//   4  → photo       (iPod Photo, 30/40/60GB)
//   5  → mini_1g     (iPod mini 1G)
//   7  → classic_6g  (iPod Classic 6G 80/160GB)
//   8  → nano_1g     (iPod nano 1G)
//  10  → shuffle_1g  (iPod shuffle 1G)
//  11  → shuffle_2g  (iPod shuffle 2G)
//  12  → touch_1g    (iPod touch 1G)
//  13  → nano_3g     (iPod nano 3G)
//  14  → classic_6g  (iPod Classic 6G 120GB — same gen, different FamilyID)
//  16  → nano_5g     (iPod nano 5G)
//  17  → classic_7g  (iPod Classic 7G 160GB — research)
//  19  → touch_4g    (iPod touch 4G — research)
//  20  → shuffle_3g  (iPod shuffle 3G — research)
//  21  → touch_3g    (iPod touch 3G — research)
//  22  → shuffle_4g  (iPod shuffle 4G — research)
//  23  → touch_5g    (iPod touch 5G — research)
//  24  → nano_6g     (iPod nano 6G — research)
//  25  → touch_6g    (iPod touch 6G — research)
//  26  → touch_7g    (iPod touch 7G — research)
//  27  → touch_2g    (iPod touch 2G — research)

/**
 * Best-effort mapping from Apple FamilyID (firmware integer) to IpodGenerationId.
 *
 * Values confirmed from real device captures (documents/test-devices.md) are
 * authoritative. Values marked from community research may be approximate —
 * multiple FamilyIDs can map to the same generation.
 */
export const FAMILY_ID_TO_GENERATION: Readonly<Record<number, IpodGenerationId>> = {
  1: 'classic_3g',
  2: 'classic_4g',
  3: 'mini_2g',
  4: 'photo',
  5: 'mini_1g',
  6: 'video_5g',
  7: 'classic_6g',
  8: 'nano_1g',
  9: 'nano_2g',
  10: 'shuffle_1g',
  11: 'shuffle_2g',
  12: 'touch_1g',
  13: 'nano_3g',
  14: 'classic_6g',
  15: 'nano_4g',
  16: 'nano_5g',
  17: 'classic_7g',
  18: 'nano_7g',
  19: 'touch_4g',
  20: 'shuffle_3g',
  21: 'touch_3g',
  22: 'shuffle_4g',
  23: 'touch_5g',
  24: 'nano_6g',
  25: 'touch_6g',
  26: 'touch_7g',
  27: 'touch_2g',
} as const;

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

/**
 * Look up an IpodGenerationId from an Apple firmware FamilyID integer.
 *
 * FamilyID is the small integer embedded in SysInfoExtended plist under the
 * `FamilyID` key. It identifies the iPod generation/family at the firmware
 * level and is exposed as `IpodIdentity.familyId` after a firmware inquiry.
 *
 * @param familyId - The `FamilyID` integer from firmware (e.g., 15 for nano_4g)
 * @returns The matching `IpodGenerationId`, or `undefined` for unknown values
 *
 * @example
 * ```ts
 * lookupByFamilyId(15)   // → 'nano_4g'
 * lookupByFamilyId(6)    // → 'video_5g'
 * lookupByFamilyId(9999) // → undefined
 * ```
 */
export function lookupByFamilyId(familyId: number): IpodGenerationId | undefined {
  return FAMILY_ID_TO_GENERATION[familyId];
}
