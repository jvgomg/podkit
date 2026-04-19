/**
 * Unified iPod model registry.
 *
 * Provides multiple access patterns for iPod device identification:
 * - USB product ID -> generation + display name
 * - SysInfo ModelNumStr -> display name + generation + capacity + color
 * - Serial number suffix (last 3 chars) -> model variant
 * - Generation -> checksum type required for iTunesDB
 *
 * Sources:
 * - USB product IDs: linux-usb.org usb.ids, community databases, direct hardware testing
 * - Model numbers / serial suffixes: libgpod itdb_device.c (0.8.3), lines 633-868
 * - Checksum types: libgpod hash implementation selection logic
 *
 * Note: This module duplicates some data from @podkit/ipod-db (packages/ipod-db/src/device/models.ts).
 * The ipod-db package is the authoritative source for model capabilities (musicDirs, video support, etc.).
 * This module focuses on device identification and checksum classification. A future consolidation
 * (tracked in ipod-db) will unify these into a single source of truth.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Checksum type required for iPod database */
export type IpodChecksumType = 'none' | 'hash58' | 'hash72' | 'hashAB';

/** iPod generation identifier */
export type IpodGenerationId =
  | 'classic_1g'
  | 'classic_2g'
  | 'classic_3g'
  | 'classic_4g'
  | 'photo'
  | 'video_5g'
  | 'video_5_5g'
  | 'classic_6g'
  | 'classic_7g'
  | 'mini_1g'
  | 'mini_2g'
  | 'nano_1g'
  | 'nano_2g'
  | 'nano_3g'
  | 'nano_4g'
  | 'nano_5g'
  | 'nano_6g'
  | 'nano_7g'
  | 'shuffle_1g'
  | 'shuffle_2g'
  | 'shuffle_3g'
  | 'shuffle_4g'
  | 'touch_1g'
  | 'touch_2g'
  | 'touch_3g'
  | 'touch_4g'
  | 'touch_5g'
  | 'touch_6g'
  | 'touch_7g';

/** Generation metadata */
export interface IpodGeneration {
  id: IpodGenerationId;
  displayName: string;
  checksumType: IpodChecksumType;
}

/** Model entry from serial suffix lookup -- specific variant (color, capacity) */
export interface IpodModelVariant {
  modelNumber: string; // e.g., "B261" (without M prefix)
  displayName: string; // e.g., "iPod nano 8GB Black (3rd Generation)"
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
}

// ── Generation definitions ──────────────────────────────────────────────────

const GENERATIONS: Record<IpodGenerationId, IpodGeneration> = {
  classic_1g: { id: 'classic_1g', displayName: 'iPod (1st Generation)', checksumType: 'none' },
  classic_2g: { id: 'classic_2g', displayName: 'iPod (2nd Generation)', checksumType: 'none' },
  classic_3g: { id: 'classic_3g', displayName: 'iPod (3rd Generation)', checksumType: 'none' },
  classic_4g: { id: 'classic_4g', displayName: 'iPod (4th Generation)', checksumType: 'none' },
  photo: { id: 'photo', displayName: 'iPod Photo', checksumType: 'none' },
  video_5g: { id: 'video_5g', displayName: 'iPod Video (5th Generation)', checksumType: 'none' },
  video_5_5g: {
    id: 'video_5_5g',
    displayName: 'iPod Video (5.5th Generation)',
    checksumType: 'none',
  },
  classic_6g: {
    id: 'classic_6g',
    displayName: 'iPod Classic (6th Generation)',
    checksumType: 'hash58',
  },
  classic_7g: {
    id: 'classic_7g',
    displayName: 'iPod Classic (7th Generation)',
    checksumType: 'hash58',
  },
  mini_1g: { id: 'mini_1g', displayName: 'iPod mini (1st Generation)', checksumType: 'none' },
  mini_2g: { id: 'mini_2g', displayName: 'iPod mini (2nd Generation)', checksumType: 'none' },
  nano_1g: { id: 'nano_1g', displayName: 'iPod nano (1st Generation)', checksumType: 'none' },
  nano_2g: { id: 'nano_2g', displayName: 'iPod nano (2nd Generation)', checksumType: 'none' },
  nano_3g: { id: 'nano_3g', displayName: 'iPod nano (3rd Generation)', checksumType: 'hash58' },
  nano_4g: { id: 'nano_4g', displayName: 'iPod nano (4th Generation)', checksumType: 'hash58' },
  nano_5g: { id: 'nano_5g', displayName: 'iPod nano (5th Generation)', checksumType: 'hash72' },
  nano_6g: { id: 'nano_6g', displayName: 'iPod nano (6th Generation)', checksumType: 'hashAB' },
  nano_7g: { id: 'nano_7g', displayName: 'iPod nano (7th Generation)', checksumType: 'none' },
  shuffle_1g: {
    id: 'shuffle_1g',
    displayName: 'iPod shuffle (1st Generation)',
    checksumType: 'none',
  },
  shuffle_2g: {
    id: 'shuffle_2g',
    displayName: 'iPod shuffle (2nd Generation)',
    checksumType: 'none',
  },
  shuffle_3g: {
    id: 'shuffle_3g',
    displayName: 'iPod shuffle (3rd Generation)',
    checksumType: 'none',
  },
  shuffle_4g: {
    id: 'shuffle_4g',
    displayName: 'iPod shuffle (4th Generation)',
    checksumType: 'none',
  },
  touch_1g: { id: 'touch_1g', displayName: 'iPod touch (1st Generation)', checksumType: 'none' },
  touch_2g: { id: 'touch_2g', displayName: 'iPod touch (2nd Generation)', checksumType: 'none' },
  touch_3g: { id: 'touch_3g', displayName: 'iPod touch (3rd Generation)', checksumType: 'none' },
  touch_4g: { id: 'touch_4g', displayName: 'iPod touch (4th Generation)', checksumType: 'hashAB' },
  touch_5g: { id: 'touch_5g', displayName: 'iPod touch (5th Generation)', checksumType: 'none' },
  touch_6g: { id: 'touch_6g', displayName: 'iPod touch (6th Generation)', checksumType: 'none' },
  touch_7g: { id: 'touch_7g', displayName: 'iPod touch (7th Generation)', checksumType: 'none' },
};

// ── USB product ID table ────────────────────────────────────────────────────
//
// Maps Apple USB product IDs (vendor 0x05ac) to generation identifiers.
//
// Two ID ranges exist for many models:
// - 0x120x range: original community-catalogued IDs (USB ID repository, libimobiledevice)
// - 0x126x range: confirmed by linux-usb.org and real hardware testing; appears on
//   devices in disk mode or with newer firmware revisions.
//
// Both ranges map to the same generations. DFU/WTF mode IDs (0x1223, 0x1224, etc.)
// are intentionally excluded -- those are recovery-mode endpoints, not disk-mode devices.
//
// Note: 0x1266 (nano 6g via 0x126x range) should be added to UNSUPPORTED_IPODS
// in usb-discovery.ts (parallel task 279.02 is editing that file).

interface UsbProductIdEntry {
  generation: IpodGenerationId;
  displayName: string;
}

const USB_PRODUCT_IDS: Record<string, UsbProductIdEntry> = {
  // ── iPod Classic (hard disk / iFlash) ───────────────────────────────────
  '0x1207': { generation: 'video_5g', displayName: 'iPod 5th generation (Video)' },
  '0x1209': { generation: 'classic_6g', displayName: 'iPod Classic 6th generation' },
  '0x120a': { generation: 'classic_7g', displayName: 'iPod Classic 7th generation' },

  // ── iPod mini ───────────────────────────────────────────────────────────
  '0x1202': { generation: 'mini_1g', displayName: 'iPod mini 1st generation' },
  '0x1204': { generation: 'mini_2g', displayName: 'iPod mini 2nd generation' },

  // ── iPod nano (0x120x range) ────────────────────────────────────────────
  '0x1205': { generation: 'nano_1g', displayName: 'iPod nano 1st generation' },
  '0x1206': { generation: 'nano_2g', displayName: 'iPod nano 2nd generation' },
  '0x1208': { generation: 'nano_3g', displayName: 'iPod nano 3rd generation' },
  '0x120b': { generation: 'nano_4g', displayName: 'iPod nano 4th generation' },
  '0x120c': { generation: 'nano_5g', displayName: 'iPod nano 5th generation' },
  '0x120d': { generation: 'nano_6g', displayName: 'iPod nano 6th generation' },
  '0x120e': { generation: 'nano_7g', displayName: 'iPod nano 7th generation' },

  // ── iPod nano (0x126x range) ────────────────────────────────────────────
  // Source: linux-usb.org usb.ids + real hardware testing.
  // These appear on devices in disk mode or with newer firmware revisions.
  '0x1260': { generation: 'nano_2g', displayName: 'iPod nano 2nd generation' },
  '0x1261': { generation: 'classic_6g', displayName: 'iPod Classic 6th generation' },
  '0x1262': { generation: 'nano_3g', displayName: 'iPod nano 3rd generation' }, // confirmed on real iPod Nano 3G
  '0x1263': { generation: 'nano_4g', displayName: 'iPod nano 4th generation' },
  '0x1265': { generation: 'nano_5g', displayName: 'iPod nano 5th generation' },
  '0x1266': { generation: 'nano_6g', displayName: 'iPod nano 6th generation' },
  '0x1267': { generation: 'nano_7g', displayName: 'iPod nano 7th generation' },

  // ── iPod shuffle ────────────────────────────────────────────────────────
  '0x1300': { generation: 'shuffle_1g', displayName: 'iPod shuffle 1st generation' },
  '0x1301': { generation: 'shuffle_2g', displayName: 'iPod shuffle 2nd generation' },
  '0x1302': { generation: 'shuffle_3g', displayName: 'iPod shuffle 3rd generation' },
  '0x1303': { generation: 'shuffle_4g', displayName: 'iPod shuffle 4th generation' },

  // ── iPod touch ──────────────────────────────────────────────────────────
  '0x1291': { generation: 'touch_1g', displayName: 'iPod touch 1st generation' },
  '0x1292': { generation: 'touch_2g', displayName: 'iPod touch 2nd generation' },
  '0x1293': { generation: 'touch_3g', displayName: 'iPod touch 3rd generation' },
  '0x129a': { generation: 'touch_4g', displayName: 'iPod touch 4th generation' },
  '0x12a0': { generation: 'touch_5g', displayName: 'iPod touch 5th generation' },
  '0x12ab': { generation: 'touch_6g', displayName: 'iPod touch 6th generation' },
  '0x12a8': { generation: 'touch_7g', displayName: 'iPod touch 7th generation' },
};

// ── Model number registry ───────────────────────────────────────────────────
//
// Maps model numbers (without "M" prefix) to variant information.
// SysInfo stores "MA147"; we strip the "M" prefix to get "A147".
//
// Sources: libgpod itdb_device.c ipod_info_table, @podkit/ipod-db MODEL_TABLE.
// Note: Duplicates data from @podkit/ipod-db -- that package is the canonical
// source for model capabilities. This table focuses on identification lookups.

interface ModelEntry {
  displayName: string;
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
}

const MODEL_NUMBERS: Record<string, ModelEntry> = {
  // ── iPod (1st Generation) ───────────────────────────────────────────────
  '8513': { displayName: 'iPod 5GB (1st Generation)', generation: 'classic_1g', capacityGb: 5 },
  '8541': { displayName: 'iPod 5GB (1st Generation)', generation: 'classic_1g', capacityGb: 5 },
  '8697': { displayName: 'iPod 5GB (1st Generation)', generation: 'classic_1g', capacityGb: 5 },
  '8709': {
    displayName: 'iPod 10GB (1st Generation)',
    generation: 'classic_1g',
    capacityGb: 10,
  },

  // ── iPod (2nd Generation) ───────────────────────────────────────────────
  '8737': {
    displayName: 'iPod 10GB (2nd Generation)',
    generation: 'classic_2g',
    capacityGb: 10,
  },
  '8738': {
    displayName: 'iPod 20GB (2nd Generation)',
    generation: 'classic_2g',
    capacityGb: 20,
  },
  '8740': {
    displayName: 'iPod 10GB (2nd Generation)',
    generation: 'classic_2g',
    capacityGb: 10,
  },
  '8741': {
    displayName: 'iPod 20GB (2nd Generation)',
    generation: 'classic_2g',
    capacityGb: 20,
  },

  // ── iPod (3rd Generation) ───────────────────────────────────────────────
  '8946': {
    displayName: 'iPod 15GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 15,
  },
  '8948': {
    displayName: 'iPod 30GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 30,
  },
  '8976': {
    displayName: 'iPod 10GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 10,
  },
  '9244': {
    displayName: 'iPod 20GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 20,
  },
  '9245': {
    displayName: 'iPod 40GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 40,
  },
  '9460': {
    displayName: 'iPod 15GB (3rd Generation)',
    generation: 'classic_3g',
    capacityGb: 15,
  },

  // ── iPod (4th Generation) ───────────────────────────────────────────────
  '9268': {
    displayName: 'iPod 40GB (4th Generation)',
    generation: 'classic_4g',
    capacityGb: 40,
  },
  '9282': {
    displayName: 'iPod 20GB (4th Generation)',
    generation: 'classic_4g',
    capacityGb: 20,
  },
  '9787': {
    displayName: 'iPod U2 25GB (4th Generation)',
    generation: 'classic_4g',
    capacityGb: 25,
  },

  // ── iPod Photo ──────────────────────────────────────────────────────────
  '9585': { displayName: 'iPod Photo 40GB', generation: 'photo', capacityGb: 40 },
  '9586': { displayName: 'iPod Photo 60GB', generation: 'photo', capacityGb: 60 },
  '9829': { displayName: 'iPod Photo 30GB', generation: 'photo', capacityGb: 30 },
  '9830': { displayName: 'iPod Photo 60GB', generation: 'photo', capacityGb: 60 },
  A079: { displayName: 'iPod Photo 20GB', generation: 'photo', capacityGb: 20 },
  A127: { displayName: 'iPod Photo 20GB U2', generation: 'photo', capacityGb: 20 },

  // ── iPod Video (5th Generation) ─────────────────────────────────────────
  A002: {
    displayName: 'iPod Video 30GB White (5th Generation)',
    generation: 'video_5g',
    capacityGb: 30,
    color: 'White',
  },
  A003: {
    displayName: 'iPod Video 60GB White (5th Generation)',
    generation: 'video_5g',
    capacityGb: 60,
    color: 'White',
  },
  A146: {
    displayName: 'iPod Video 30GB Black (5th Generation)',
    generation: 'video_5g',
    capacityGb: 30,
    color: 'Black',
  },
  A147: {
    displayName: 'iPod Video 60GB Black (5th Generation)',
    generation: 'video_5g',
    capacityGb: 60,
    color: 'Black',
  },

  // ── iPod Video (5.5th Generation) ───────────────────────────────────────
  A444: {
    displayName: 'iPod Video 30GB White (5.5th Generation)',
    generation: 'video_5_5g',
    capacityGb: 30,
    color: 'White',
  },
  A446: {
    displayName: 'iPod Video 30GB Black (5.5th Generation)',
    generation: 'video_5_5g',
    capacityGb: 30,
    color: 'Black',
  },
  A448: {
    displayName: 'iPod Video 80GB White (5.5th Generation)',
    generation: 'video_5_5g',
    capacityGb: 80,
    color: 'White',
  },
  A450: {
    displayName: 'iPod Video 80GB Black (5.5th Generation)',
    generation: 'video_5_5g',
    capacityGb: 80,
    color: 'Black',
  },
  A664: {
    displayName: 'iPod Video 30GB U2 (5.5th Generation)',
    generation: 'video_5_5g',
    capacityGb: 30,
  },

  // ── iPod Classic (6th Generation) ───────────────────────────────────────
  B029: {
    displayName: 'iPod Classic 80GB Silver (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 80,
    color: 'Silver',
  },
  B145: {
    displayName: 'iPod Classic 160GB Silver (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 160,
    color: 'Silver',
  },
  B147: {
    displayName: 'iPod Classic 80GB Black (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 80,
    color: 'Black',
  },
  B150: {
    displayName: 'iPod Classic 160GB Black (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 160,
    color: 'Black',
  },
  B562: {
    displayName: 'iPod Classic 120GB Silver (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 120,
    color: 'Silver',
  },
  B565: {
    displayName: 'iPod Classic 120GB Black (6th Generation)',
    generation: 'classic_6g',
    capacityGb: 120,
    color: 'Black',
  },

  // ── iPod Classic (7th Generation) ───────────────────────────────────────
  C293: {
    displayName: 'iPod Classic 160GB Silver (7th Generation)',
    generation: 'classic_7g',
    capacityGb: 160,
    color: 'Silver',
  },
  C297: {
    displayName: 'iPod Classic 160GB Black (7th Generation)',
    generation: 'classic_7g',
    capacityGb: 160,
    color: 'Black',
  },

  // ── iPod mini (1st Generation) ──────────────────────────────────────────
  '9160': {
    displayName: 'iPod mini 4GB (1st Generation)',
    generation: 'mini_1g',
    capacityGb: 4,
  },
  '9434': {
    displayName: 'iPod mini 4GB Green (1st Generation)',
    generation: 'mini_1g',
    capacityGb: 4,
    color: 'Green',
  },
  '9435': {
    displayName: 'iPod mini 4GB Pink (1st Generation)',
    generation: 'mini_1g',
    capacityGb: 4,
    color: 'Pink',
  },
  '9436': {
    displayName: 'iPod mini 4GB Blue (1st Generation)',
    generation: 'mini_1g',
    capacityGb: 4,
    color: 'Blue',
  },
  '9437': {
    displayName: 'iPod mini 4GB Gold (1st Generation)',
    generation: 'mini_1g',
    capacityGb: 4,
    color: 'Gold',
  },

  // ── iPod mini (2nd Generation) ──────────────────────────────────────────
  '9800': {
    displayName: 'iPod mini 4GB (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 4,
  },
  '9801': {
    displayName: 'iPod mini 6GB (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 6,
  },
  '9802': {
    displayName: 'iPod mini 4GB Blue (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 4,
    color: 'Blue',
  },
  '9803': {
    displayName: 'iPod mini 6GB Blue (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 6,
    color: 'Blue',
  },
  '9804': {
    displayName: 'iPod mini 4GB Pink (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 4,
    color: 'Pink',
  },
  '9805': {
    displayName: 'iPod mini 6GB Pink (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 6,
    color: 'Pink',
  },
  '9806': {
    displayName: 'iPod mini 4GB Green (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 4,
    color: 'Green',
  },
  '9807': {
    displayName: 'iPod mini 6GB Green (2nd Generation)',
    generation: 'mini_2g',
    capacityGb: 6,
    color: 'Green',
  },

  // ── iPod nano (1st Generation) ──────────────────────────────────────────
  A004: {
    displayName: 'iPod nano 2GB White (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 2,
    color: 'White',
  },
  A005: {
    displayName: 'iPod nano 4GB White (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 4,
    color: 'White',
  },
  A099: {
    displayName: 'iPod nano 2GB Black (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 2,
    color: 'Black',
  },
  A107: {
    displayName: 'iPod nano 4GB Black (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 4,
    color: 'Black',
  },
  A350: {
    displayName: 'iPod nano 1GB White (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 1,
    color: 'White',
  },
  A352: {
    displayName: 'iPod nano 1GB Black (1st Generation)',
    generation: 'nano_1g',
    capacityGb: 1,
    color: 'Black',
  },

  // ── iPod nano (2nd Generation) ──────────────────────────────────────────
  A426: {
    displayName: 'iPod nano 4GB Silver (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 4,
    color: 'Silver',
  },
  A428: {
    displayName: 'iPod nano 4GB Blue (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 4,
    color: 'Blue',
  },
  A477: {
    displayName: 'iPod nano 2GB Silver (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 2,
    color: 'Silver',
  },
  A487: {
    displayName: 'iPod nano 4GB Green (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 4,
    color: 'Green',
  },
  A489: {
    displayName: 'iPod nano 4GB Pink (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 4,
    color: 'Pink',
  },
  A497: {
    displayName: 'iPod nano 8GB Black (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 8,
    color: 'Black',
  },
  A725: {
    displayName: 'iPod nano 4GB Red (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 4,
    color: 'Red',
  },
  A726: {
    displayName: 'iPod nano 8GB Red (2nd Generation)',
    generation: 'nano_2g',
    capacityGb: 8,
    color: 'Red',
  },

  // ── iPod nano (3rd Generation) ──────────────────────────────────────────
  A978: {
    displayName: 'iPod nano 4GB Silver (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 4,
    color: 'Silver',
  },
  A980: {
    displayName: 'iPod nano 8GB Silver (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 8,
    color: 'Silver',
  },
  B249: {
    displayName: 'iPod nano 8GB Blue (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 8,
    color: 'Blue',
  },
  B253: {
    displayName: 'iPod nano 8GB Green (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 8,
    color: 'Green',
  },
  B257: {
    displayName: 'iPod nano 8GB Red (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 8,
    color: 'Red',
  },
  B261: {
    displayName: 'iPod nano 8GB Black (3rd Generation)',
    generation: 'nano_3g',
    capacityGb: 8,
    color: 'Black',
  },

  // ── iPod nano (4th Generation) ──────────────────────────────────────────
  B480: {
    displayName: 'iPod nano 4GB Silver (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Silver',
  },
  B598: {
    displayName: 'iPod nano 8GB Silver (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Silver',
  },
  B651: {
    displayName: 'iPod nano 4GB Blue (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Blue',
  },
  B654: {
    displayName: 'iPod nano 4GB Pink (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Pink',
  },
  B657: {
    displayName: 'iPod nano 4GB Purple (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Purple',
  },
  B660: {
    displayName: 'iPod nano 4GB Orange (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Orange',
  },
  B663: {
    displayName: 'iPod nano 4GB Green (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Green',
  },
  B666: {
    displayName: 'iPod nano 4GB Yellow (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
    color: 'Yellow',
  },
  B732: {
    displayName: 'iPod nano 8GB Blue (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Blue',
  },
  B735: {
    displayName: 'iPod nano 8GB Pink (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Pink',
  },
  B739: {
    displayName: 'iPod nano 8GB Purple (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Purple',
  },
  B742: {
    displayName: 'iPod nano 8GB Orange (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Orange',
  },
  B745: {
    displayName: 'iPod nano 8GB Green (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Green',
  },
  B748: {
    displayName: 'iPod nano 8GB Yellow (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Yellow',
  },
  B751: {
    displayName: 'iPod nano 8GB Red (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Red',
  },
  B754: {
    displayName: 'iPod nano 8GB Black (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 8,
    color: 'Black',
  },
  B903: {
    displayName: 'iPod nano 16GB Silver (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Silver',
  },
  B905: {
    displayName: 'iPod nano 16GB Blue (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Blue',
  },
  B907: {
    displayName: 'iPod nano 16GB Pink (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Pink',
  },
  B909: {
    displayName: 'iPod nano 16GB Purple (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Purple',
  },
  B911: {
    displayName: 'iPod nano 16GB Orange (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Orange',
  },
  B913: {
    displayName: 'iPod nano 16GB Green (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Green',
  },
  B915: {
    displayName: 'iPod nano 16GB Yellow (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Yellow',
  },
  B917: {
    displayName: 'iPod nano 16GB Red (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Red',
  },
  B918: {
    displayName: 'iPod nano 16GB Black (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 16,
    color: 'Black',
  },
  B867: {
    displayName: 'iPod nano 4GB (4th Generation)',
    generation: 'nano_4g',
    capacityGb: 4,
  },

  // ── iPod nano (5th Generation) ──────────────────────────────────────────
  C027: {
    displayName: 'iPod nano 8GB Silver (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Silver',
  },
  C031: {
    displayName: 'iPod nano 8GB Black (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Black',
  },
  C034: {
    displayName: 'iPod nano 8GB Purple (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Purple',
  },
  C037: {
    displayName: 'iPod nano 8GB Blue (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Blue',
  },
  C040: {
    displayName: 'iPod nano 8GB Green (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Green',
  },
  C046: {
    displayName: 'iPod nano 8GB Orange (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Orange',
  },
  C049: {
    displayName: 'iPod nano 8GB Red (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Red',
  },
  C050: {
    displayName: 'iPod nano 8GB Pink (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 8,
    color: 'Pink',
  },
  C060: {
    displayName: 'iPod nano 16GB Silver (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Silver',
  },
  C062: {
    displayName: 'iPod nano 16GB Black (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Black',
  },
  C064: {
    displayName: 'iPod nano 16GB Purple (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Purple',
  },
  C066: {
    displayName: 'iPod nano 16GB Blue (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Blue',
  },
  C068: {
    displayName: 'iPod nano 16GB Green (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Green',
  },
  C070: {
    displayName: 'iPod nano 16GB Yellow (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Yellow',
  },
  C072: {
    displayName: 'iPod nano 16GB Orange (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Orange',
  },
  C074: {
    displayName: 'iPod nano 16GB Red (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Red',
  },
  C075: {
    displayName: 'iPod nano 16GB Pink (5th Generation)',
    generation: 'nano_5g',
    capacityGb: 16,
    color: 'Pink',
  },

  // ── iPod nano (6th Generation) ──────────────────────────────────────────
  C525: {
    displayName: 'iPod nano 8GB Silver (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Silver',
  },
  C526: {
    displayName: 'iPod nano 16GB Silver (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Silver',
  },
  C688: {
    displayName: 'iPod nano 8GB Black (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Black',
  },
  C689: {
    displayName: 'iPod nano 8GB Blue (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Blue',
  },
  C690: {
    displayName: 'iPod nano 8GB Green (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Green',
  },
  C691: {
    displayName: 'iPod nano 8GB Orange (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Orange',
  },
  C692: {
    displayName: 'iPod nano 8GB Pink (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Pink',
  },
  C693: {
    displayName: 'iPod nano 8GB Red (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 8,
    color: 'Red',
  },
  C694: {
    displayName: 'iPod nano 16GB Black (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Black',
  },
  C695: {
    displayName: 'iPod nano 16GB Blue (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Blue',
  },
  C696: {
    displayName: 'iPod nano 16GB Green (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Green',
  },
  C697: {
    displayName: 'iPod nano 16GB Orange (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Orange',
  },
  C698: {
    displayName: 'iPod nano 16GB Pink (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Pink',
  },
  C699: {
    displayName: 'iPod nano 16GB Red (6th Generation)',
    generation: 'nano_6g',
    capacityGb: 16,
    color: 'Red',
  },

  // ── iPod nano (7th Generation) ──────────────────────────────────────────
  D477: {
    displayName: 'iPod nano 16GB (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
  },

  // ── iPod shuffle (1st Generation) ───────────────────────────────────────
  '9724': {
    displayName: 'iPod shuffle 512MB (1st Generation)',
    generation: 'shuffle_1g',
    capacityGb: 0.5,
  },
  '9725': {
    displayName: 'iPod shuffle 1GB (1st Generation)',
    generation: 'shuffle_1g',
    capacityGb: 1,
  },

  // ── iPod shuffle (2nd Generation) ───────────────────────────────────────
  A546: {
    displayName: 'iPod shuffle 1GB Silver (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Silver',
  },
  A947: {
    displayName: 'iPod shuffle 1GB Pink (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Pink',
  },
  A949: {
    displayName: 'iPod shuffle 1GB Blue (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Blue',
  },
  A951: {
    displayName: 'iPod shuffle 1GB Green (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Green',
  },
  A953: {
    displayName: 'iPod shuffle 1GB Orange (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Orange',
  },
  B225: {
    displayName: 'iPod shuffle 1GB Silver (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Silver',
  },
  B228: {
    displayName: 'iPod shuffle 1GB Blue (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Blue',
  },
  B233: {
    displayName: 'iPod shuffle 1GB Purple (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Purple',
  },
  B518: {
    displayName: 'iPod shuffle 2GB Silver (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 2,
    color: 'Silver',
  },
  C167: {
    displayName: 'iPod shuffle 1GB Gold (2nd Generation)',
    generation: 'shuffle_2g',
    capacityGb: 1,
    color: 'Gold',
  },

  // ── iPod shuffle (3rd Generation) ───────────────────────────────────────
  C306: {
    displayName: 'iPod shuffle 2GB Silver (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 2,
    color: 'Silver',
  },
  C323: {
    displayName: 'iPod shuffle 2GB Black (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 2,
    color: 'Black',
  },
  C381: {
    displayName: 'iPod shuffle 2GB Green (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 2,
    color: 'Green',
  },
  C384: {
    displayName: 'iPod shuffle 2GB Blue (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 2,
    color: 'Blue',
  },
  C387: {
    displayName: 'iPod shuffle 2GB Pink (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 2,
    color: 'Pink',
  },
  C164: {
    displayName: 'iPod shuffle 4GB Black (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Black',
  },
  C303: {
    displayName: 'iPod shuffle 4GB Stainless (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Stainless',
  },
  C307: {
    displayName: 'iPod shuffle 4GB Green (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Green',
  },
  C328: {
    displayName: 'iPod shuffle 4GB Blue (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Blue',
  },
  C331: {
    displayName: 'iPod shuffle 4GB Pink (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Pink',
  },

  // ── iPod shuffle (4th Generation) ───────────────────────────────────────
  C584: {
    displayName: 'iPod shuffle 2GB Silver (4th Generation)',
    generation: 'shuffle_4g',
    capacityGb: 2,
    color: 'Silver',
  },
  C585: {
    displayName: 'iPod shuffle 2GB Pink (4th Generation)',
    generation: 'shuffle_4g',
    capacityGb: 2,
    color: 'Pink',
  },
  C749: {
    displayName: 'iPod shuffle 2GB Orange (4th Generation)',
    generation: 'shuffle_4g',
    capacityGb: 2,
    color: 'Orange',
  },
  C750: {
    displayName: 'iPod shuffle 2GB Green (4th Generation)',
    generation: 'shuffle_4g',
    capacityGb: 2,
    color: 'Green',
  },
  C751: {
    displayName: 'iPod shuffle 2GB Blue (4th Generation)',
    generation: 'shuffle_4g',
    capacityGb: 2,
    color: 'Blue',
  },

  // ── iPod touch (1st Generation) ─────────────────────────────────────────
  A623: {
    displayName: 'iPod touch 8GB (1st Generation)',
    generation: 'touch_1g',
    capacityGb: 8,
  },
  A627: {
    displayName: 'iPod touch 16GB (1st Generation)',
    generation: 'touch_1g',
    capacityGb: 16,
  },
  B376: {
    displayName: 'iPod touch 32GB (1st Generation)',
    generation: 'touch_1g',
    capacityGb: 32,
  },

  // ── iPod touch (2nd Generation) ─────────────────────────────────────────
  B528: {
    displayName: 'iPod touch 8GB (2nd Generation)',
    generation: 'touch_2g',
    capacityGb: 8,
  },
  B531: {
    displayName: 'iPod touch 16GB (2nd Generation)',
    generation: 'touch_2g',
    capacityGb: 16,
  },

  // ── iPod touch (3rd Generation) ─────────────────────────────────────────
  C008: {
    displayName: 'iPod touch 32GB (3rd Generation)',
    generation: 'touch_3g',
    capacityGb: 32,
  },
  C011: {
    displayName: 'iPod touch 64GB (3rd Generation)',
    generation: 'touch_3g',
    capacityGb: 64,
  },
  C086: {
    displayName: 'iPod touch 8GB (3rd Generation)',
    generation: 'touch_2g', // Hardware is 2nd gen; marketed as 3rd gen
    capacityGb: 8,
  },

  // ── iPod touch (4th Generation) ─────────────────────────────────────────
  C540: {
    displayName: 'iPod touch 8GB (4th Generation)',
    generation: 'touch_4g',
    capacityGb: 8,
  },
  C544: {
    displayName: 'iPod touch 32GB (4th Generation)',
    generation: 'touch_4g',
    capacityGb: 32,
  },
  C547: {
    displayName: 'iPod touch 64GB (4th Generation)',
    generation: 'touch_4g',
    capacityGb: 64,
  },
};

// ── Serial suffix to model number mapping ───────────────────────────────────
//
// Maps the last 3 characters of an iPod serial number to model numbers.
// The model number (prepended with "M") is the SysInfo ModelNumStr.
//
// Source: libgpod itdb_device.c serial_to_model_mapping (lines 633-868).
// Example: serial "5U8280FNYXX" -> suffix "YXX" -> model "B261" -> "MB261"
//        -> "iPod nano 8GB Black (3rd Generation)"
//
// Note: Some suffixes map to the same model. Where libgpod had duplicate
// suffix entries with different models, the last entry wins (matching C behavior).

const SERIAL_SUFFIX_TO_MODEL: Record<string, string> = {
  // iPod (1st Generation)
  LG6: '8541',
  NAM: '8541',
  MJ2: '8541',
  ML1: '8709',
  MME: '8709',

  // iPod (2nd Generation)
  MMB: '8737',
  MMC: '8738',
  NGE: '8740',
  NGH: '8740',
  MMF: '8741',

  // iPod (3rd Generation)
  NLW: '8946',
  NRH: '8976',
  QQF: '9460',
  PQ5: '9244',
  PNT: '9244',
  NLY: '8948',
  NM7: '8948',
  PNU: '9245',
  PS9: '9282',
  Q8U: '9282',

  // iPod (4th Generation)
  V9V: '9787',
  S2X: '9787',
  PQ7: '9268',

  // iPod Photo
  TDU: 'A079',
  TDS: 'A079',
  TM2: 'A127',
  SAZ: '9830',
  SB1: '9830',
  SAY: '9829',
  R5Q: '9585',
  R5R: '9586',
  R5T: '9586',

  // iPod mini (1st Generation)
  PFW: '9160',
  PRC: '9160',
  QKL: '9436',
  QKQ: '9436',
  QKK: '9435',
  QKP: '9435',
  QKJ: '9434',
  QKN: '9434',
  QKM: '9437',
  QKR: '9437',

  // iPod mini (2nd Generation)
  S41: '9800',
  S4C: '9800',
  S43: '9802',
  S45: '9804',
  S47: '9806',
  S4J: '9806',
  S42: '9801',
  S44: '9803',
  S48: '9807',

  // iPod shuffle (1st Generation)
  RS9: '9724',
  QGV: '9724',
  TSX: '9724',
  PFV: '9724',
  R80: '9724',
  RSA: '9725',
  TSY: '9725',
  C60: '9725',

  // iPod shuffle (2nd Generation)
  VTE: 'A546',
  VTF: 'A546',
  XQ5: 'A947',
  XQS: 'A947',
  XQV: 'A949',
  XQX: 'A949',
  XQY: 'A951',
  XR1: 'A953',
  '1ZH': 'B518',
  '8CQ': 'C167',
  // YX7 appears for both nano_1g (A949) and shuffle_2g (B228) in libgpod.
  // YX9 appears for shuffle_2g (B225). In C, last-wins = shuffle_2g entries.
  YX7: 'B228',
  YX9: 'B225',
  YXA: 'B233',
  YX6: 'B225',
  YX8: 'A951',

  // iPod nano (1st Generation)
  UNA: 'A350',
  UNB: 'A350',
  UPR: 'A352',
  UPS: 'A352',
  SZB: 'A004',
  SZV: 'A004',
  SZW: 'A004',
  SZC: 'A005',
  SZT: 'A005',
  TJT: 'A099',
  TJU: 'A099',
  TK2: 'A107',
  TK3: 'A107',

  // iPod nano (2nd Generation)
  VQ5: 'A477',
  VQ6: 'A477',
  V8T: 'A426',
  V8U: 'A426',
  V8W: 'A428',
  V8X: 'A428',
  VQH: 'A487',
  VQJ: 'A487',
  VQK: 'A489',
  VKL: 'A489',
  WL2: 'A725',
  WL3: 'A725',
  X9A: 'A726',
  X9B: 'A726',
  VQT: 'A497',
  VQU: 'A497',

  // iPod Video (5th Generation)
  SZ9: 'A002',
  WEC: 'A002',
  WED: 'A002',
  WEG: 'A002',
  WEH: 'A002',
  WEL: 'A002',
  TXK: 'A146',
  TXM: 'A146',
  // WEE appears for both video_5g (A146) and video_5_5g (A446) in libgpod.
  // In C, last-wins semantics apply, so A446 is correct.
  WEE: 'A446',
  WEF: 'A146',
  WEJ: 'A146',
  WEK: 'A146',
  SZA: 'A003',
  SZU: 'A003',
  TXL: 'A147',
  TXN: 'A147',

  // iPod Video (5.5th Generation)
  V9K: 'A444',
  V9L: 'A444',
  WU9: 'A444',
  VQM: 'A446',
  V9M: 'A446',
  V9N: 'A446',
  V9P: 'A448',
  V9Q: 'A448',
  V9R: 'A450',
  V9S: 'A450',
  V95: 'A450',
  V96: 'A450',
  WUC: 'A450',
  W9G: 'A664',

  // iPod Classic (6th Generation)
  Y5N: 'B029',
  YMV: 'B147',
  YMU: 'B145',
  YMX: 'B150',

  // iPod Classic (6th Generation, revised -- 120GB)
  '2C5': 'B562',
  '2C7': 'B565',

  // iPod Classic (7th Generation)
  '9ZS': 'C293',
  '9ZU': 'C297',

  // iPod nano (3rd Generation)
  Y0P: 'A978',
  Y0R: 'A980',
  YXR: 'B249',
  YXV: 'B257',
  YXT: 'B253',
  YXX: 'B261',

  // iPod nano (4th Generation)
  '37P': 'B663',
  '37Q': 'B666',
  '37H': 'B654',
  '1P1': 'B480',
  '37K': 'B657',
  '37L': 'B660',
  '2ME': 'B598',
  '3QS': 'B732',
  '3QT': 'B735',
  '3QU': 'B739',
  '3QW': 'B742',
  '3QX': 'B745',
  '3QY': 'B748',
  '3R0': 'B754',
  '3QZ': 'B751',
  '5B7': 'B903',
  '5B8': 'B905',
  '5B9': 'B907',
  '5BA': 'B909',
  '5BB': 'B911',
  '5BC': 'B913',
  '5BD': 'B915',
  '5BE': 'B917',
  '5BF': 'B918',

  // iPod nano (5th Generation)
  '71V': 'C027',
  '71Y': 'C031',
  '721': 'C034',
  '726': 'C037',
  '72A': 'C040',
  '72F': 'C046',
  '72K': 'C049',
  '72L': 'C050',
  '72Q': 'C060',
  '72R': 'C062',
  '72S': 'C064',
  '72X': 'C066',
  '734': 'C068',
  '738': 'C070',
  '739': 'C072',
  '73A': 'C074',
  '73B': 'C075',

  // iPod nano (6th Generation)
  CMN: 'C525',
  DVX: 'C688',
  DVY: 'C689',
  DW0: 'C690',
  DW1: 'C691',
  DW2: 'C692',
  DW3: 'C693',
  CMP: 'C526',
  DW4: 'C694',
  DW5: 'C695',
  DW6: 'C696',
  DW7: 'C697',
  DW8: 'C698',
  DW9: 'C699',

  // iPod shuffle (3rd Generation)
  A1S: 'C306',
  A78: 'C323',
  ALB: 'C381',
  ALD: 'C384',
  ALG: 'C387',
  '4NZ': 'B867',
  '891': 'C164',
  A1L: 'C303',
  A1U: 'C307',
  A7B: 'C328',
  A7D: 'C331',

  // iPod shuffle (4th Generation)
  CMJ: 'C584',
  CMK: 'C585',
  FDM: 'C749',
  FDN: 'C750',
  FDP: 'C751',

  // iPod touch (1st Generation)
  W4N: 'A623',
  W4T: 'A627',
  '0JW': 'B376',

  // iPod touch (2nd Generation)
  '201': 'B528',
  '203': 'B531',

  // iPod touch (3rd Generation)
  '75J': 'C086',
  '6K2': 'C008',
  '6K4': 'C011',
};

// Duplicate-suffix handling: libgpod's C array has duplicate keys where "last wins".
// YX7 (shuffle_2g B228 vs nano_1g A949), YX9 (shuffle_2g B225), and WEE (video_5_5g A446
// vs video_5g A146) are resolved inline above using libgpod's last-wins ordering.

// ── Backward-compatible SysInfo model names ─────────────────────────────────
//
// This provides the same lookup as the old SYSINFO_MODEL_NAMES table, now backed
// by the unified MODEL_NUMBERS registry. The old table used "MA147" format keys;
// we normalise by stripping the "M" prefix in the lookup function.
//
// Entries that existed in the old table but NOT in MODEL_NUMBERS are preserved
// here for backward compatibility. The old table had some entries with "LL" suffix
// (e.g., "MA099LL") and "MC477" which we include.

const LEGACY_MODEL_OVERRIDES: Record<string, string> = {
  // MA099LL was in the old table -- a locale-specific SKU
  A099LL: 'iPod nano 1GB (1st Generation)',
  // MC477 was in the old table but not in ipod-db -- a late Classic 7G SKU
  C477: 'iPod Classic 160GB (7th Generation)',
  // MB263 was in the old table -- a nano 4G SKU not in libgpod or ipod-db
  B263: 'iPod nano 4GB (4th Generation)',
};

// ── Lookup indexes (populated once) ─────────────────────────────────────────

const USB_INDEX = new Map<string, UsbProductIdEntry>();
for (const [id, entry] of Object.entries(USB_PRODUCT_IDS)) {
  USB_INDEX.set(id.toLowerCase(), entry);
}

const MODEL_INDEX = new Map<string, ModelEntry>();
for (const [num, entry] of Object.entries(MODEL_NUMBERS)) {
  MODEL_INDEX.set(num.toUpperCase(), entry);
}
// Add legacy overrides
for (const [num, displayName] of Object.entries(LEGACY_MODEL_OVERRIDES)) {
  if (!MODEL_INDEX.has(num.toUpperCase())) {
    // Infer generation from nearby entries or default
    const gen: IpodGenerationId = num.startsWith('A099')
      ? 'nano_1g'
      : num === 'C477'
        ? 'classic_7g'
        : num === 'B263'
          ? 'nano_4g'
          : 'classic_1g';
    MODEL_INDEX.set(num.toUpperCase(), { displayName, generation: gen });
  }
}

const SERIAL_INDEX = new Map<string, string>();
for (const [suffix, model] of Object.entries(SERIAL_SUFFIX_TO_MODEL)) {
  SERIAL_INDEX.set(suffix.toUpperCase(), model.toUpperCase());
}

// ── Public API: backward-compatible functions ───────────────────────────────

/**
 * Look up a human-readable model name from an Apple USB product ID.
 *
 * @param productId - Hex product ID string, with or without leading zeros
 *                    (e.g., "0x1209", "1209")
 * @returns Model name if the ID is in the lookup table, undefined otherwise
 */
export function lookupIpodModel(productId: string): string | undefined {
  const normalised = productId.toLowerCase().startsWith('0x')
    ? productId.toLowerCase()
    : `0x${productId.toLowerCase()}`;

  return USB_INDEX.get(normalised)?.displayName;
}

/**
 * Look up a human-readable model name from an iPod SysInfo model number string.
 *
 * @param modelNumStr - The `ModelNumStr` value from `iPod_Control/Device/SysInfo`
 *                      (e.g., "MA147", "MC297")
 * @returns Model name if the model number is known, undefined otherwise
 */
export function lookupIpodModelByNumber(modelNumStr: string): string | undefined {
  const upper = modelNumStr.toUpperCase();

  // Strip leading "M" if present (SysInfo format -> internal format)
  const stripped = upper.startsWith('M') ? upper.slice(1) : upper;

  // Try the stripped form first, then the full form (for entries like "A099LL")
  const entry = MODEL_INDEX.get(stripped) ?? MODEL_INDEX.get(upper);
  return entry?.displayName;
}

// ── Public API: new functions ───────────────────────────────────────────────

/**
 * Look up a specific iPod model variant from a serial number suffix.
 *
 * The last 3 characters of an iPod serial number identify the exact model
 * variant (color, capacity, generation). This maps that suffix through the
 * model number table to return full variant information.
 *
 * @param serialSuffix - Last 3 characters of the iPod serial number
 * @returns Model variant info, or undefined if the suffix is unknown
 *
 * @example
 * ```ts
 * // Serial "5U8280FNYXX" -> suffix "YXX"
 * const variant = lookupIpodModelBySerial('YXX');
 * // { modelNumber: 'B261', displayName: 'iPod nano 8GB Black (3rd Generation)',
 * //   generation: 'nano_3g', capacityGb: 8, color: 'Black' }
 * ```
 */
export function lookupIpodModelBySerial(serialSuffix: string): IpodModelVariant | undefined {
  if (!serialSuffix || serialSuffix.length !== 3) return undefined;

  const modelNumber = SERIAL_INDEX.get(serialSuffix.toUpperCase());
  if (!modelNumber) return undefined;

  const entry = MODEL_INDEX.get(modelNumber);
  if (!entry) {
    // Model number exists in serial table but not in model table.
    // Return minimal info using the model number.
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
 * Get generation metadata for a generation identifier.
 *
 * @param generationId - Generation identifier
 * @returns Generation metadata (always returns a valid result for valid IDs)
 */
export function getGenerationInfo(generationId: IpodGenerationId): IpodGeneration {
  return GENERATIONS[generationId];
}

/**
 * Get the checksum type required for a given iPod generation.
 *
 * @param generationId - Generation identifier
 * @returns Checksum type: 'none', 'hash58', 'hash72', or 'hashAB'
 */
export function getChecksumType(generationId: IpodGenerationId): IpodChecksumType {
  return GENERATIONS[generationId].checksumType;
}

/**
 * Look up the generation identifier for a USB product ID.
 *
 * @param productId - Hex product ID string (e.g., "0x1209", "1262")
 * @returns Generation identifier, or undefined if the product ID is unknown
 */
export function lookupGenerationByProductId(productId: string): IpodGenerationId | undefined {
  const normalised = productId.toLowerCase().startsWith('0x')
    ? productId.toLowerCase()
    : `0x${productId.toLowerCase()}`;

  return USB_INDEX.get(normalised)?.generation;
}
