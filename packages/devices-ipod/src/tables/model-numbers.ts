/**
 * Model number → variant data table.
 *
 * Maps model numbers (without "M" prefix) to variant information.
 * SysInfo stores "MA147"; we strip the "M" prefix to get "A147".
 *
 * Per ADR-020 the table no longer carries hand-written `displayName` strings.
 * Each entry records the variant-specific facts (generation, capacity, colour,
 * variant tag) and `formatIpodLabel` composes the display string from those
 * fields plus `GENERATIONS[gen].family/ordinal`.
 *
 * Sources: libgpod itdb_device.c ipod_info_table, @podkit/ipod-db MODEL_TABLE.
 * Note: Duplicates data from @podkit/ipod-db -- that package is the canonical
 * source for model capabilities. This table focuses on identification lookups.
 *
 * @module
 */

import type { IpodGenerationId } from '../types.js';

export interface ModelEntry {
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
  /**
   * Variant tag (e.g., "U2", "2015"). Inserted by `formatIpodLabel` between
   * the family name and the capacity.
   */
  variant?: string;
}

export const MODEL_NUMBERS: Record<string, ModelEntry> = {
  // ── iPod (1st Generation) ───────────────────────────────────────────────
  '8513': { generation: 'classic_1g', capacityGb: 5 },
  '8541': { generation: 'classic_1g', capacityGb: 5 },
  '8697': { generation: 'classic_1g', capacityGb: 5 },
  '8709': { generation: 'classic_1g', capacityGb: 10 },

  // ── iPod (2nd Generation) ───────────────────────────────────────────────
  '8737': { generation: 'classic_2g', capacityGb: 10 },
  '8738': { generation: 'classic_2g', capacityGb: 20 },
  '8740': { generation: 'classic_2g', capacityGb: 10 },
  '8741': { generation: 'classic_2g', capacityGb: 20 },

  // ── iPod (3rd Generation) ───────────────────────────────────────────────
  '8946': { generation: 'classic_3g', capacityGb: 15 },
  '8948': { generation: 'classic_3g', capacityGb: 30 },
  '8976': { generation: 'classic_3g', capacityGb: 10 },
  '9244': { generation: 'classic_3g', capacityGb: 20 },
  '9245': { generation: 'classic_3g', capacityGb: 40 },
  '9460': { generation: 'classic_3g', capacityGb: 15 },

  // ── iPod (4th Generation) ───────────────────────────────────────────────
  '9268': { generation: 'classic_4g', capacityGb: 40 },
  '9282': { generation: 'classic_4g', capacityGb: 20 },
  '9787': { generation: 'classic_4g', capacityGb: 25, variant: 'U2' },

  // ── iPod Photo ──────────────────────────────────────────────────────────
  '9585': { generation: 'photo', capacityGb: 40 },
  '9586': { generation: 'photo', capacityGb: 60 },
  '9829': { generation: 'photo', capacityGb: 30 },
  '9830': { generation: 'photo', capacityGb: 60 },
  A079: { generation: 'photo', capacityGb: 20 },
  A127: { generation: 'photo', capacityGb: 20, variant: 'U2' },

  // ── iPod Video (5th Generation) ─────────────────────────────────────────
  A002: { generation: 'video_5g', capacityGb: 30, color: 'White' },
  A003: { generation: 'video_5g', capacityGb: 60, color: 'White' },
  A146: { generation: 'video_5g', capacityGb: 30, color: 'Black' },
  A147: { generation: 'video_5g', capacityGb: 60, color: 'Black' },

  // ── iPod Video (5.5th Generation) ───────────────────────────────────────
  A444: { generation: 'video_5_5g', capacityGb: 30, color: 'White' },
  A446: { generation: 'video_5_5g', capacityGb: 30, color: 'Black' },
  A448: { generation: 'video_5_5g', capacityGb: 80, color: 'White' },
  A450: { generation: 'video_5_5g', capacityGb: 80, color: 'Black' },
  A664: { generation: 'video_5_5g', capacityGb: 30, variant: 'U2' },

  // ── iPod Classic (6th Generation) ───────────────────────────────────────
  B029: { generation: 'classic_6g', capacityGb: 80, color: 'Silver' },
  B145: { generation: 'classic_6g', capacityGb: 160, color: 'Silver' },
  B147: { generation: 'classic_6g', capacityGb: 80, color: 'Black' },
  B150: { generation: 'classic_6g', capacityGb: 160, color: 'Black' },
  B562: { generation: 'classic_6g', capacityGb: 120, color: 'Silver' },
  B565: { generation: 'classic_6g', capacityGb: 120, color: 'Black' },

  // ── iPod Classic (7th Generation) ───────────────────────────────────────
  C293: { generation: 'classic_7g', capacityGb: 160, color: 'Silver' },
  C297: { generation: 'classic_7g', capacityGb: 160, color: 'Black' },

  // ── iPod mini (1st Generation) ──────────────────────────────────────────
  '9160': { generation: 'mini_1g', capacityGb: 4 },
  '9434': { generation: 'mini_1g', capacityGb: 4, color: 'Green' },
  '9435': { generation: 'mini_1g', capacityGb: 4, color: 'Pink' },
  '9436': { generation: 'mini_1g', capacityGb: 4, color: 'Blue' },
  '9437': { generation: 'mini_1g', capacityGb: 4, color: 'Gold' },

  // ── iPod mini (2nd Generation) ──────────────────────────────────────────
  '9800': { generation: 'mini_2g', capacityGb: 4 },
  '9801': { generation: 'mini_2g', capacityGb: 6 },
  '9802': { generation: 'mini_2g', capacityGb: 4, color: 'Blue' },
  '9803': { generation: 'mini_2g', capacityGb: 6, color: 'Blue' },
  '9804': { generation: 'mini_2g', capacityGb: 4, color: 'Pink' },
  '9805': { generation: 'mini_2g', capacityGb: 6, color: 'Pink' },
  '9806': { generation: 'mini_2g', capacityGb: 4, color: 'Green' },
  '9807': { generation: 'mini_2g', capacityGb: 6, color: 'Green' },

  // ── iPod nano (1st Generation) ──────────────────────────────────────────
  A004: { generation: 'nano_1g', capacityGb: 2, color: 'White' },
  A005: { generation: 'nano_1g', capacityGb: 4, color: 'White' },
  A099: { generation: 'nano_1g', capacityGb: 2, color: 'Black' },
  A107: { generation: 'nano_1g', capacityGb: 4, color: 'Black' },
  A350: { generation: 'nano_1g', capacityGb: 1, color: 'White' },
  A352: { generation: 'nano_1g', capacityGb: 1, color: 'Black' },

  // ── iPod nano (2nd Generation) ──────────────────────────────────────────
  A426: { generation: 'nano_2g', capacityGb: 4, color: 'Silver' },
  A428: { generation: 'nano_2g', capacityGb: 4, color: 'Blue' },
  A477: { generation: 'nano_2g', capacityGb: 2, color: 'Silver' },
  A487: { generation: 'nano_2g', capacityGb: 4, color: 'Green' },
  A489: { generation: 'nano_2g', capacityGb: 4, color: 'Pink' },
  A497: { generation: 'nano_2g', capacityGb: 8, color: 'Black' },
  A725: { generation: 'nano_2g', capacityGb: 4, color: 'Red' },
  A726: { generation: 'nano_2g', capacityGb: 8, color: 'Red' },

  // ── iPod nano (3rd Generation) ──────────────────────────────────────────
  A978: { generation: 'nano_3g', capacityGb: 4, color: 'Silver' },
  A980: { generation: 'nano_3g', capacityGb: 8, color: 'Silver' },
  B249: { generation: 'nano_3g', capacityGb: 8, color: 'Blue' },
  B253: { generation: 'nano_3g', capacityGb: 8, color: 'Green' },
  B257: { generation: 'nano_3g', capacityGb: 8, color: 'Red' },
  B261: { generation: 'nano_3g', capacityGb: 8, color: 'Black' },

  // ── iPod nano (4th Generation) ──────────────────────────────────────────
  B480: { generation: 'nano_4g', capacityGb: 4, color: 'Silver' },
  B598: { generation: 'nano_4g', capacityGb: 8, color: 'Silver' },
  B651: { generation: 'nano_4g', capacityGb: 4, color: 'Blue' },
  B654: { generation: 'nano_4g', capacityGb: 4, color: 'Pink' },
  B657: { generation: 'nano_4g', capacityGb: 4, color: 'Purple' },
  B660: { generation: 'nano_4g', capacityGb: 4, color: 'Orange' },
  B663: { generation: 'nano_4g', capacityGb: 4, color: 'Green' },
  B666: { generation: 'nano_4g', capacityGb: 4, color: 'Yellow' },
  B732: { generation: 'nano_4g', capacityGb: 8, color: 'Blue' },
  B735: { generation: 'nano_4g', capacityGb: 8, color: 'Pink' },
  B739: { generation: 'nano_4g', capacityGb: 8, color: 'Purple' },
  B742: { generation: 'nano_4g', capacityGb: 8, color: 'Orange' },
  B745: { generation: 'nano_4g', capacityGb: 8, color: 'Green' },
  B748: { generation: 'nano_4g', capacityGb: 8, color: 'Yellow' },
  B751: { generation: 'nano_4g', capacityGb: 8, color: 'Red' },
  B754: { generation: 'nano_4g', capacityGb: 8, color: 'Black' },
  B903: { generation: 'nano_4g', capacityGb: 16, color: 'Silver' },
  B905: { generation: 'nano_4g', capacityGb: 16, color: 'Blue' },
  B907: { generation: 'nano_4g', capacityGb: 16, color: 'Pink' },
  B909: { generation: 'nano_4g', capacityGb: 16, color: 'Purple' },
  B911: { generation: 'nano_4g', capacityGb: 16, color: 'Orange' },
  B913: { generation: 'nano_4g', capacityGb: 16, color: 'Green' },
  B915: { generation: 'nano_4g', capacityGb: 16, color: 'Yellow' },
  B917: { generation: 'nano_4g', capacityGb: 16, color: 'Red' },
  B918: { generation: 'nano_4g', capacityGb: 16, color: 'Black' },

  // ── iPod nano (5th Generation) ──────────────────────────────────────────
  C027: { generation: 'nano_5g', capacityGb: 8, color: 'Silver' },
  C031: { generation: 'nano_5g', capacityGb: 8, color: 'Black' },
  C034: { generation: 'nano_5g', capacityGb: 8, color: 'Purple' },
  C037: { generation: 'nano_5g', capacityGb: 8, color: 'Blue' },
  C040: { generation: 'nano_5g', capacityGb: 8, color: 'Green' },
  C046: { generation: 'nano_5g', capacityGb: 8, color: 'Orange' },
  C049: { generation: 'nano_5g', capacityGb: 8, color: 'Red' },
  C050: { generation: 'nano_5g', capacityGb: 8, color: 'Pink' },
  C060: { generation: 'nano_5g', capacityGb: 16, color: 'Silver' },
  C062: { generation: 'nano_5g', capacityGb: 16, color: 'Black' },
  C064: { generation: 'nano_5g', capacityGb: 16, color: 'Purple' },
  C066: { generation: 'nano_5g', capacityGb: 16, color: 'Blue' },
  C068: { generation: 'nano_5g', capacityGb: 16, color: 'Green' },
  C070: { generation: 'nano_5g', capacityGb: 16, color: 'Yellow' },
  C072: { generation: 'nano_5g', capacityGb: 16, color: 'Orange' },
  C074: { generation: 'nano_5g', capacityGb: 16, color: 'Red' },
  C075: { generation: 'nano_5g', capacityGb: 16, color: 'Pink' },

  // ── iPod nano (6th Generation) ──────────────────────────────────────────
  C525: { generation: 'nano_6g', capacityGb: 8, color: 'Silver' },
  C526: { generation: 'nano_6g', capacityGb: 16, color: 'Silver' },
  // Apple marketed the dark nano 6G as Graphite — never Black (that is the
  // 3G/4G-era name) and never Space Gray (that arrives with the 7G in 2013).
  // Confirmed against a physical 16GB unit, serial DCYGLUGVDDW4. Note
  // `@podkit/ipod-db`'s model table still says Black: it is a faithful port of
  // libgpod's `ipod_info_table`, which uses its own `nano_black` naming.
  C688: { generation: 'nano_6g', capacityGb: 8, color: 'Graphite' },
  C689: { generation: 'nano_6g', capacityGb: 8, color: 'Blue' },
  C690: { generation: 'nano_6g', capacityGb: 8, color: 'Green' },
  C691: { generation: 'nano_6g', capacityGb: 8, color: 'Orange' },
  C692: { generation: 'nano_6g', capacityGb: 8, color: 'Pink' },
  C693: { generation: 'nano_6g', capacityGb: 8, color: 'Red' },
  C694: { generation: 'nano_6g', capacityGb: 16, color: 'Graphite' },
  C695: { generation: 'nano_6g', capacityGb: 16, color: 'Blue' },
  C696: { generation: 'nano_6g', capacityGb: 16, color: 'Green' },
  C697: { generation: 'nano_6g', capacityGb: 16, color: 'Orange' },
  C698: { generation: 'nano_6g', capacityGb: 16, color: 'Pink' },
  C699: { generation: 'nano_6g', capacityGb: 16, color: 'Red' },

  // ── iPod nano (7th Generation) ──────────────────────────────────────────
  // 2012 launch (all 16GB, hardware model A1446)
  D475: { generation: 'nano_7g', capacityGb: 16, color: 'Pink' },
  D476: { generation: 'nano_7g', capacityGb: 16, color: 'Yellow' },
  D477: { generation: 'nano_7g', capacityGb: 16, color: 'Blue' },
  D478: { generation: 'nano_7g', capacityGb: 16, color: 'Green' },
  D479: { generation: 'nano_7g', capacityGb: 16, color: 'Purple' },
  D480: { generation: 'nano_7g', capacityGb: 16, color: 'Silver' },
  D481: { generation: 'nano_7g', capacityGb: 16, color: 'Slate' },
  D744: { generation: 'nano_7g', capacityGb: 16, color: 'Red' },
  // 2013 update
  E971: { generation: 'nano_7g', capacityGb: 16, color: 'Space Gray' },
  // 2015 refresh (all 16GB, same A1446 hardware)
  KN02: { generation: 'nano_7g', capacityGb: 16, color: 'Blue', variant: '2015' },
  KN22: { generation: 'nano_7g', capacityGb: 16, color: 'Silver', variant: '2015' },
  KN52: { generation: 'nano_7g', capacityGb: 16, color: 'Space Gray', variant: '2015' },
  KN72: { generation: 'nano_7g', capacityGb: 16, color: 'Red', variant: '2015' },
  KMV2: { generation: 'nano_7g', capacityGb: 16, color: 'Pink', variant: '2015' },
  KMX2: { generation: 'nano_7g', capacityGb: 16, color: 'Gold', variant: '2015' },

  // ── iPod shuffle (1st Generation) ───────────────────────────────────────
  '9724': { generation: 'shuffle_1g', capacityGb: 0.5 },
  '9725': { generation: 'shuffle_1g', capacityGb: 1 },

  // ── iPod shuffle (2nd Generation) ───────────────────────────────────────
  A546: { generation: 'shuffle_2g', capacityGb: 1, color: 'Silver' },
  A947: { generation: 'shuffle_2g', capacityGb: 1, color: 'Pink' },
  A949: { generation: 'shuffle_2g', capacityGb: 1, color: 'Blue' },
  A951: { generation: 'shuffle_2g', capacityGb: 1, color: 'Green' },
  A953: { generation: 'shuffle_2g', capacityGb: 1, color: 'Orange' },
  B225: { generation: 'shuffle_2g', capacityGb: 1, color: 'Silver' },
  B228: { generation: 'shuffle_2g', capacityGb: 1, color: 'Blue' },
  B233: { generation: 'shuffle_2g', capacityGb: 1, color: 'Purple' },
  B518: { generation: 'shuffle_2g', capacityGb: 2, color: 'Silver' },
  C167: { generation: 'shuffle_2g', capacityGb: 1, color: 'Gold' },

  // ── iPod shuffle (3rd Generation) ───────────────────────────────────────
  C306: { generation: 'shuffle_3g', capacityGb: 2, color: 'Silver' },
  C323: { generation: 'shuffle_3g', capacityGb: 2, color: 'Black' },
  C381: { generation: 'shuffle_3g', capacityGb: 2, color: 'Green' },
  C384: { generation: 'shuffle_3g', capacityGb: 2, color: 'Blue' },
  C387: { generation: 'shuffle_3g', capacityGb: 2, color: 'Pink' },
  C164: { generation: 'shuffle_3g', capacityGb: 4, color: 'Black' },
  C303: { generation: 'shuffle_3g', capacityGb: 4, color: 'Stainless' },
  B867: { generation: 'shuffle_3g', capacityGb: 4, color: 'Silver' },
  C307: { generation: 'shuffle_3g', capacityGb: 4, color: 'Green' },
  C328: { generation: 'shuffle_3g', capacityGb: 4, color: 'Blue' },
  C331: { generation: 'shuffle_3g', capacityGb: 4, color: 'Pink' },

  // ── iPod shuffle (4th Generation) ───────────────────────────────────────
  // Initial (2010) — order numbers MC584–MC751.
  C584: { generation: 'shuffle_4g', capacityGb: 2, color: 'Silver' },
  C585: { generation: 'shuffle_4g', capacityGb: 2, color: 'Pink' },
  C749: { generation: 'shuffle_4g', capacityGb: 2, color: 'Orange' },
  C750: { generation: 'shuffle_4g', capacityGb: 2, color: 'Green' },
  C751: { generation: 'shuffle_4g', capacityGb: 2, color: 'Blue' },
  // Late 2012 (Rev A) refresh — order numbers MD773–MD780, ME949.
  // Source: The Apple Wiki, Models/iPod (per-colour order numbers + serial
  // suffixes). Confirmed against real hardware: serial CC4LXAVUF4T0 → MD777
  // (suffix F4T0), device is Purple. Note MD779 is Slate, not Purple — the
  // order number a plain serial lookup returns is the family representative.
  D773: { generation: 'shuffle_4g', capacityGb: 2, color: 'Pink' },
  D774: { generation: 'shuffle_4g', capacityGb: 2, color: 'Yellow' },
  D775: { generation: 'shuffle_4g', capacityGb: 2, color: 'Blue' },
  D776: { generation: 'shuffle_4g', capacityGb: 2, color: 'Green' },
  D777: { generation: 'shuffle_4g', capacityGb: 2, color: 'Purple' },
  D778: { generation: 'shuffle_4g', capacityGb: 2, color: 'Silver' },
  D779: { generation: 'shuffle_4g', capacityGb: 2, color: 'Slate' },
  D780: { generation: 'shuffle_4g', capacityGb: 2, color: 'Red' },
  E949: { generation: 'shuffle_4g', capacityGb: 2, color: 'Space Gray' },
  // Mid 2015 (Rev B) — order numbers MKM72–MKML2.
  KM72: { generation: 'shuffle_4g', capacityGb: 2, color: 'Pink' },
  KM92: { generation: 'shuffle_4g', capacityGb: 2, color: 'Gold' },
  KME2: { generation: 'shuffle_4g', capacityGb: 2, color: 'Blue' },
  KMG2: { generation: 'shuffle_4g', capacityGb: 2, color: 'Silver' },
  KMJ2: { generation: 'shuffle_4g', capacityGb: 2, color: 'Space Gray' },
  KML2: { generation: 'shuffle_4g', capacityGb: 2, color: 'Red' },

  // ── iPod touch (1st Generation) ─────────────────────────────────────────
  A623: { generation: 'touch_1g', capacityGb: 8 },
  A627: { generation: 'touch_1g', capacityGb: 16 },
  B376: { generation: 'touch_1g', capacityGb: 32 },

  // ── iPod touch (2nd Generation) ─────────────────────────────────────────
  B528: { generation: 'touch_2g', capacityGb: 8 },
  B531: { generation: 'touch_2g', capacityGb: 16 },

  // ── iPod touch (3rd Generation) ─────────────────────────────────────────
  C008: { generation: 'touch_3g', capacityGb: 32 },
  C011: { generation: 'touch_3g', capacityGb: 64 },
  C086: { generation: 'touch_2g', capacityGb: 8 }, // Hardware is 2nd gen; marketed as 3rd gen

  // ── iPod touch (4th Generation) ─────────────────────────────────────────
  C540: { generation: 'touch_4g', capacityGb: 8 },
  C544: { generation: 'touch_4g', capacityGb: 32 },
  C547: { generation: 'touch_4g', capacityGb: 64 },
};

// ── Backward-compatible SysInfo model names ─────────────────────────────────
//
// Entries that existed in the old SYSINFO_MODEL_NAMES table but NOT in
// MODEL_NUMBERS are preserved here for backward compatibility.

export const LEGACY_MODEL_OVERRIDES: Record<string, ModelEntry> = {
  // MA099LL was in the old table -- a locale-specific SKU
  A099LL: { generation: 'nano_1g', capacityGb: 1 },
  // MC477 was in the old table but not in ipod-db -- a late Classic 7G SKU
  C477: { generation: 'classic_7g', capacityGb: 160 },
  // MB263 was in the old table -- a nano 4G SKU not in libgpod or ipod-db
  B263: { generation: 'nano_4g', capacityGb: 4 },
};
