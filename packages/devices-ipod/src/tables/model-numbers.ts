/**
 * Model number → generation + display name table.
 *
 * Maps model numbers (without "M" prefix) to variant information.
 * SysInfo stores "MA147"; we strip the "M" prefix to get "A147".
 *
 * Sources: libgpod itdb_device.c ipod_info_table, @podkit/ipod-db MODEL_TABLE.
 * Note: Duplicates data from @podkit/ipod-db -- that package is the canonical
 * source for model capabilities. This table focuses on identification lookups.
 *
 * @module
 */

import type { IpodGenerationId } from '../types.js';

export interface ModelEntry {
  displayName: string;
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
}

export const MODEL_NUMBERS: Record<string, ModelEntry> = {
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
  // 2012 launch (all 16GB, hardware model A1446)
  D475: {
    displayName: 'iPod nano 16GB Pink (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Pink',
  },
  D476: {
    displayName: 'iPod nano 16GB Yellow (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Yellow',
  },
  D477: {
    displayName: 'iPod nano 16GB Blue (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Blue',
  },
  D478: {
    displayName: 'iPod nano 16GB Green (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Green',
  },
  D479: {
    displayName: 'iPod nano 16GB Purple (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Purple',
  },
  D480: {
    displayName: 'iPod nano 16GB Silver (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Silver',
  },
  D481: {
    displayName: 'iPod nano 16GB Slate (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Slate',
  },
  D744: {
    displayName: 'iPod nano 16GB Red (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Red',
  },
  // 2013 update
  E971: {
    displayName: 'iPod nano 16GB Space Gray (7th Generation)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Space Gray',
  },
  // 2015 refresh (all 16GB, same A1446 hardware)
  KN02: {
    displayName: 'iPod nano 16GB Blue (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Blue',
  },
  KN22: {
    displayName: 'iPod nano 16GB Silver (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Silver',
  },
  KN52: {
    displayName: 'iPod nano 16GB Space Gray (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Space Gray',
  },
  KN72: {
    displayName: 'iPod nano 16GB Red (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Red',
  },
  KMV2: {
    displayName: 'iPod nano 16GB Pink (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Pink',
  },
  KMX2: {
    displayName: 'iPod nano 16GB Gold (7th Generation, 2015)',
    generation: 'nano_7g',
    capacityGb: 16,
    color: 'Gold',
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
  B867: {
    displayName: 'iPod shuffle 4GB Silver (3rd Generation)',
    generation: 'shuffle_3g',
    capacityGb: 4,
    color: 'Silver',
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

// ── Backward-compatible SysInfo model names ─────────────────────────────────
//
// Entries that existed in the old SYSINFO_MODEL_NAMES table but NOT in
// MODEL_NUMBERS are preserved here for backward compatibility.

export const LEGACY_MODEL_OVERRIDES: Record<
  string,
  { displayName: string; generation: IpodGenerationId }
> = {
  // MA099LL was in the old table -- a locale-specific SKU
  A099LL: { displayName: 'iPod nano 1GB (1st Generation)', generation: 'nano_1g' },
  // MC477 was in the old table but not in ipod-db -- a late Classic 7G SKU
  C477: { displayName: 'iPod Classic 160GB (7th Generation)', generation: 'classic_7g' },
  // MB263 was in the old table -- a nano 4G SKU not in libgpod or ipod-db
  B263: { displayName: 'iPod nano 4GB (4th Generation)', generation: 'nano_4g' },
};
