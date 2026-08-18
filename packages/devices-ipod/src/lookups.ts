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

// ── FamilyID → generation mapping ───────────────────────────────────────────
//
// Apple's FamilyID is an integer embedded in the SysInfoExtended plist.
// It identifies the iPod family/generation at the firmware level.
//
// IMPORTANT — source of truth:
//   libgpod's ipod_info_table is keyed by model number string, not by FamilyID.
//   libgpod uses FamilyID only to detect iTunes-phone devices (value >= 10000).
//   There is NO FamilyID-to-generation table in libgpod or gtkpod.
//   Entries here come from real device SysInfoExtended captures, from the macOS
//   iPod cache (which records the same firmware value per connected device), or
//   from community SysInfo dumps shared via the iPod Linux wiki and similar
//   reverse-engineering efforts. Hardware always outranks research.
//
// Every entry carries its own `evidence` and `source`, so the difference
// between "a device told us this" and "a forum post told us this" survives in
// the data rather than in a comment block that a later edit can drift from.
//
// Three invariants constrain what may be added here. They are enforced by
// tests, not at runtime, so a bad entry fails at commit time rather than
// becoming silently inert on a user's machine:
//
//   1. Band. FamilyID is banded by device class, and a value from one band
//      never names a generation from another:
//        < 100      disk-mode click-wheel iPods (3, 6, 9, 12, 15, 18 observed)
//        100 – 999  iPod shuffle                (130, 132, 133 observed)
//        >= 10000   iOS devices                 (10055 observed — touch 6G)
//   2. Chronology. Within a band, FamilyID increases with release date. The
//      hardware entries are the anchors; every inferred entry must fall inside
//      the release-date window its neighbouring anchors leave open. Hardware is
//      never constrained by this — if two captures contradict the ordering, the
//      ordering assumption is what's wrong.
//   3. Direction of risk. An inferred entry may only name a `syncable`
//      generation. A guess is allowed to open a door, never to close one: an
//      unverified value that resolves to a `read-only` or `none` generation
//      turns a forum post into a non-overridable refusal on someone's working
//      hardware, whereas a missing entry fails closed with an honest
//      unknown-model error naming the inputs.
//
// Hardware sources: captures live in documents/sysinfo-captures/; the macOS
// iPod cache is ~/Library/Preferences/com.apple.iPod.plist, which records
// `Family ID` and `Updater Family ID` as *separate* keys — only the former
// belongs here. The updater values for the three shuffles below are 133, 132
// and 135, which is exactly why an updater reading must never be pasted in.
//
// Deliberate omissions:
//   classic_1g, classic_2g — pre-date SysInfoExtended; these devices have no
//     FamilyID field (SysInfoExtended wasn't introduced until ~2005 on the Photo).
//     Use USB product ID or SysInfo ModelNumStr to identify these generations.
//   iPod touch / iPhone / iPad — an iOS device has no disk mode and never emits
//     a SysInfoExtended, so no touch FamilyID is obtainable through the inquiry
//     path that fills this table. The only iOS value ever observed here is a
//     macOS-cache reading of 10055 for an iPod touch 6G — five orders of
//     magnitude away from the small integers previously guessed for touches,
//     and consistent with libgpod's own `>= 10000` iTunes-phone test. iOS
//     devices are refused at the USB product ID instead (tables/unsupported.ts).
//   photo, mini_1g, nano_1g, nano_6g and a second classic_6g value — previously
//     carried at 4, 5, 8, 24 and 7. All five contradict the chronology the
//     hardware anchors establish (e.g. the Photo shipped Oct 2004, a FamilyID
//     of 4 would put it after the Feb-2005 mini 2G at 3), so the numbers were
//     wrong even where the generation is real. Removed rather than kept as
//     inferred: a value known to be misplaced is not weak evidence, it is
//     counter-evidence.
//   A second nano_3g at 13 — hardware puts nano_3g at 12 (two units), and no
//     evidence says what 13 is. 13 sits in the window where the classic 6G
//     (same month as the nano 3G) would fall, so claiming it for nano_3g is a
//     guess that could shadow a real device.

/** Whether a FamilyID entry was read off hardware or inferred from research. */
export type FamilyIdEvidence = 'hardware' | 'inferred';

/**
 * One row of the FamilyID table: the generation, how well we know it, and the
 * evidence trail that backs it.
 */
export interface FamilyIdEntry {
  /** The generation this FamilyID identifies. */
  readonly generation: IpodGenerationId;
  /**
   * `'hardware'` — read from a device podkit has actually seen (SysInfoExtended
   * capture or macOS iPod cache entry). `'inferred'` — from community SysInfo
   * dumps, unconfirmed by any device in this project.
   */
  readonly evidence: FamilyIdEvidence;
  /** Where the value came from: device + serial + artifact, or the research trail. */
  readonly source: string;
}

/**
 * Apple FamilyID (firmware integer) → generation, with provenance per entry.
 *
 * Nine values are confirmed on real hardware (3, 6, 9, 12, 15, 18, 130, 132,
 * 133); the rest are inferred from community SysInfo dumps and may be wrong.
 * See the invariants above before adding a row.
 *
 * Note: `video_5_5g` has no separate FamilyID entry because it shares FamilyID
 * 6 with `video_5g`. Both generations have identical capabilities.
 */
export const FAMILY_ID_TABLE: Readonly<Record<number, FamilyIdEntry>> = {
  1: {
    generation: 'classic_3g',
    evidence: 'inferred',
    source:
      'Community SysInfo dumps (iPod Linux wiki) for the 10/15/20/30/40GB iPod 3G. ' +
      'Unconfirmed: the 3G predates SysInfoExtended by ~2 years, so it may emit no FamilyID at all.',
  },
  2: {
    generation: 'classic_4g',
    evidence: 'inferred',
    source:
      'Community SysInfo dumps (iPod Linux wiki) for the 20/40GB iPod 4G. ' +
      'Unconfirmed: like the 3G, it may predate the SysInfoExtended plist entirely.',
  },
  3: {
    generation: 'mini_2g',
    evidence: 'hardware',
    source: 'iPod mini 2G 4GB Pink, serial JQ5141TFS4G — sysinfo-captures/mini-2g.xml',
  },
  6: {
    generation: 'video_5g',
    evidence: 'hardware',
    source:
      'iPod 5G Video iFlash 1TB, serial 9C642MEFV9M — sysinfo-captures/ipod-5g-video-iflash-1tb.xml. ' +
      'The captured unit is a 5.5G (A446) yet reports 6, so 5G and 5.5G share this FamilyID.',
  },
  9: {
    generation: 'nano_2g',
    evidence: 'hardware',
    source: 'iPod nano 2G 4GB Green, serial YM7275YSVQH — sysinfo-captures/nano-2g-4gb-green.xml',
  },
  12: {
    generation: 'nano_3g',
    evidence: 'hardware',
    source:
      'Two iPod nano 3Gs: serial 5U8280FNYXX (sysinfo-captures/nano-3g-8gb-black.xml, mirrored by ' +
      'the ipod-nano-3g-black persona) and serial YM803JBW13F (macOS iPod cache). Corroborated on ' +
      'two further axes: serial suffix YXX → B261 → nano_3g, and USB PID 0x1262 → nano_3g.',
  },
  // Open risk on 12 and 14: the iPod Classic 6G shipped the same month as the
  // nano 3G (September 2007) and no capture from one exists, so it is not ruled
  // out that a classic 6G also reports 12. That risk is bounded — the serial
  // axis is tried first, so only a classic 6G with an unmapped serial suffix
  // reaches the FamilyID axis at all, and classic_6g and nano_3g carry
  // identical capability rows (hash58, ALAC, video, artwork 320, both
  // syncable). A collision costs a wrong display name, not wrong checksums,
  // artwork format, or transcode targets.
  14: {
    generation: 'classic_6g',
    evidence: 'inferred',
    source: 'Community SysInfo dumps (iPod Linux wiki) for the 120GB iPod Classic 6G.',
  },
  15: {
    generation: 'nano_4g',
    evidence: 'hardware',
    source: 'iPod nano 4G 8GB Black, serial 5U851AEH3R0 — sysinfo-captures/nano-4g-8gb-black.xml',
  },
  16: {
    generation: 'nano_5g',
    evidence: 'inferred',
    source: 'Community SysInfo dumps (iPod Linux wiki) for the iPod nano 5G.',
  },
  17: {
    generation: 'nano_6g',
    evidence: 'hardware',
    // Read from firmware over USB on a connected iPod nano 6G (16GB, serial
    // DCYGLUGVDDW4, USB PID 0x1266). Supersedes a research guess of
    // classic_7g: the Classic 7G's FamilyID is simply unknown, and guessing it
    // here would have made a nano 6G resolve as a syncable Classic — this
    // entry sat one unmapped serial suffix away from offering to write to a
    // device podkit cannot write to.
    source: 'iPod nano 6G 16GB, serial DCYGLUGVDDW4 — read from firmware over USB',
  },
  18: {
    generation: 'nano_7g',
    evidence: 'hardware',
    source:
      'iPod nano 7G 16GB, serial DCYN72R8FJQ1 — sysinfo-captures/nano-7g-16gb-scsi.xml and -usb.xml',
  },
  // ── Shuffle band ──────────────────────────────────────────────────────────
  // All three read from real hardware on the same day.
  130: {
    generation: 'shuffle_2g',
    evidence: 'hardware',
    source:
      'iPod shuffle 2G 1GB Pink, serial 6V925GZ9436 — sysinfo-captures/shuffle-2g-1gb-pink.xml, ' +
      'corroborated by the macOS iPod cache (updater FamilyID 133 — not this value).',
  },
  132: {
    generation: 'shuffle_3g',
    evidence: 'hardware',
    source:
      'iPod shuffle 3G, serial 4H02918LALD — macOS iPod cache. Serial suffix ALD → C384 ' +
      'corroborates shuffle_3g on the serial axis.',
  },
  133: {
    generation: 'shuffle_4g',
    evidence: 'hardware',
    source:
      'iPod shuffle 4G (Late 2012), serial CC4LXAVUF4T0 — macOS iPod cache (updater FamilyID 135 ' +
      '— not this value). Serial suffix 4T0 → D777 corroborates on the serial axis.',
  },
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
    // Serial-table model number not in MODEL_NUMBERS — refuse to invent a
    // generation. The cascade falls through to other axes (USB, FamilyID).
    return undefined;
  }

  return {
    modelNumber,
    generation: entry.generation,
    capacityGb: entry.capacityGb,
    color: entry.color,
    ...(entry.variant ? { variant: entry.variant } : {}),
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
 * Render a bare model number back into the `ModelNumStr` form that Apple's own
 * SysInfo writers produce, and that every consumer of that file expects.
 *
 * `IpodModel.modelNumber` holds the bare code (`A947`) because the registry is
 * keyed that way. Both the classic `iPod_Control/Device/SysInfo` file and
 * libgpod's model lookup want the prefixed form (`MA947`) — libgpod strips a
 * single leading letter before consulting its table, so handing it the bare
 * code would drop a significant character and miss.
 *
 * `M` is the retail prefix. Apple also ships `P` (service stock) and `F`
 * (factory refurbished) for the same hardware; all three resolve identically,
 * so retail is the right neutral choice when podkit is synthesising the value
 * from a serial-suffix or FamilyID resolution rather than copying one off the
 * device.
 *
 * Already-prefixed input is returned unchanged, so this is safe to apply to a
 * value of uncertain provenance.
 */
export function toModelNumStr(modelNumber: string): string {
  const upper = modelNumber.toUpperCase();
  return /^[MPF]/.test(upper) ? upper : `M${upper}`;
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
 * Look up a FamilyID entry — generation plus the provenance behind it.
 *
 * Use this instead of {@link lookupByFamilyId} wherever the *confidence* in the
 * answer matters: `device info` output, diagnostics, docs generation, or any
 * message that would read differently if the value came from a forum post
 * rather than a device. `evidence: 'inferred'` should be rendered as such.
 *
 * @param familyId - The `FamilyID` integer from firmware (e.g., 15 for nano_4g)
 * @returns The matching entry, or `undefined` for unknown values
 */
export function lookupFamilyIdEntry(familyId: number): FamilyIdEntry | undefined {
  return FAMILY_ID_TABLE[familyId];
}

/**
 * Look up an IpodGenerationId from an Apple firmware FamilyID integer.
 *
 * FamilyID is the small integer embedded in SysInfoExtended plist under the
 * `FamilyID` key. It identifies the iPod generation/family at the firmware
 * level and is exposed as `IpodIdentity.familyId` after a firmware inquiry.
 *
 * Inferred entries resolve exactly like hardware-confirmed ones: provenance
 * records confidence, it does not gate behaviour (the same split ADR-024 draws
 * between `support.access` and `support.verified`). What keeps an unverified
 * guess from driving a refusal is the table invariant that an inferred entry
 * may only name a `syncable` generation — enforced at commit time, so a bad row
 * fails the build instead of silently disappearing at runtime. Callers that
 * want to *show* the difference use {@link lookupFamilyIdEntry}.
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
  return FAMILY_ID_TABLE[familyId]?.generation;
}
