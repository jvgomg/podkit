import { describe, expect, test } from 'bun:test';

import {
  getChecksumType,
  getChecksumTypeByModelNumber,
  lookupGenerationInfo,
  lookupGenerationByModelNumber,
  lookupGenerationByProductId,
  lookupByUsbId,
  lookupByModelNumber,
  lookupBySerial,
  lookupByFamilyId,
  toLibgpodGeneration,
} from './lookups.js';
import { identify } from './identity.js';

import type { IpodChecksumType, IpodGenerationId } from './types.js';

// ── Sentinel: package re-exports work ──────────────────────────────────────

describe('package re-exports', () => {
  test('all named exports are importable from index', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.identify).toBe('function');
    expect(typeof mod.identify).toBe('function');
    expect(typeof mod.lookupByUsbId).toBe('function');
    expect(typeof mod.lookupBySerial).toBe('function');
    expect(typeof mod.lookupByModelNumber).toBe('function');
    expect(typeof mod.lookupGenerationInfo).toBe('function');
    expect(typeof mod.GENERATIONS).toBe('object');
    expect(typeof mod.IPOD_USB_IDS).toBe('object');
    expect(typeof mod.MODEL_NUMBERS).toBe('object');
    expect(typeof mod.SERIAL_TO_MODEL).toBe('object');
    expect(typeof mod.GENERATION_ID_TO_LIBGPOD).toBe('object');
    expect(Array.isArray(mod.IPOD_GENERATION_IDS)).toBe(true);
    expect(mod.IPOD_GENERATION_IDS.length).toBe(29);
    expect(typeof mod.formatIpodLabel).toBe('function');
    expect(typeof mod.formatIpodShortLabel).toBe('function');
  });
});

// ── lookupByUsbId ───────────────────────────────────────────────────────────
//
// Per ADR-020 the USB table no longer carries `displayName` strings — only
// the generation reference. `identify({ from: 'usb', ... })` composes the
// canonical label via `formatIpodLabel`.

describe('lookupByUsbId', () => {
  test('returns generation for known 0x120x product IDs', () => {
    expect(lookupByUsbId('0x1207')?.generation).toBe('video_5g');
    expect(lookupByUsbId('0x1209')?.generation).toBe('video_5g');
    expect(lookupByUsbId('0x1205')?.generation).toBe('mini_1g');
    expect(lookupByUsbId('0x120a')?.generation).toBe('nano_1g');
    expect(lookupByUsbId('0x1208')?.generation).toBe('nano_3g');
    expect(lookupByUsbId('0x120b')?.generation).toBe('nano_4g');
    expect(lookupByUsbId('0x120c')?.generation).toBe('nano_5g');
    expect(lookupByUsbId('0x120d')?.generation).toBe('nano_6g');
    expect(lookupByUsbId('0x120e')?.generation).toBe('nano_7g');
  });

  test('returns generation for new 0x126x product IDs', () => {
    expect(lookupByUsbId('0x1260')?.generation).toBe('nano_2g');
    expect(lookupByUsbId('0x1261')?.generation).toBe('classic_6g');
    expect(lookupByUsbId('0x1262')?.generation).toBe('nano_3g');
    expect(lookupByUsbId('0x1263')?.generation).toBe('nano_4g');
    expect(lookupByUsbId('0x1265')?.generation).toBe('nano_5g');
    expect(lookupByUsbId('0x1266')?.generation).toBe('nano_6g');
    expect(lookupByUsbId('0x1267')?.generation).toBe('nano_7g');
  });

  test('returns generation for shuffle IDs', () => {
    expect(lookupByUsbId('0x1300')?.generation).toBe('shuffle_1g');
    expect(lookupByUsbId('0x1303')?.generation).toBe('shuffle_4g');
  });

  test('returns generation for touch IDs', () => {
    expect(lookupByUsbId('0x1291')?.generation).toBe('touch_1g');
    expect(lookupByUsbId('0x129a')?.generation).toBe('touch_4g');
  });

  test('returns generation for mini IDs', () => {
    expect(lookupByUsbId('0x1202')?.generation).toBe('mini_1g');
    expect(lookupByUsbId('0x1204')?.generation).toBe('mini_2g');
  });

  test('normalises input without 0x prefix', () => {
    expect(lookupByUsbId('1209')?.generation).toBe('video_5g');
    expect(lookupByUsbId('1262')?.generation).toBe('nano_3g');
  });

  test('normalises uppercase input', () => {
    expect(lookupByUsbId('0X1209')?.generation).toBe('video_5g');
    expect(lookupByUsbId('0X1262')?.generation).toBe('nano_3g');
  });

  test('returns undefined for unknown product ID', () => {
    expect(lookupByUsbId('0x9999')).toBeUndefined();
  });

  test('returns undefined for DFU/WTF mode IDs (excluded by design)', () => {
    expect(lookupByUsbId('0x1223')).toBeUndefined();
    expect(lookupByUsbId('0x1224')).toBeUndefined();
  });
});

// ── identify({ from: 'usb' }) — display strings ─────────────────────────────
//
// Per ADR-020 USB-sourced displayNames use the canonical parenthetical
// form composed from the generation entry's family + ordinal.

describe('identify({ from: usb })', () => {
  test('composes parenthetical labels for known product IDs', () => {
    expect(identify({ from: 'usb', productId: '0x1209' })?.displayName).toBe(
      'iPod Video (5th Generation)'
    );
    expect(identify({ from: 'usb', productId: '0x120a' })?.displayName).toBe(
      'iPod nano (1st Generation)'
    );
    expect(identify({ from: 'usb', productId: '0x1208' })?.displayName).toBe(
      'iPod nano (3rd Generation)'
    );
    expect(identify({ from: 'usb', productId: '0x1262' })?.displayName).toBe(
      'iPod nano (3rd Generation)'
    );
    expect(identify({ from: 'usb', productId: '0x1261' })?.displayName).toBe(
      'iPod Classic (6th Generation)'
    );
    expect(identify({ from: 'usb', productId: '0x1300' })?.displayName).toBe(
      'iPod shuffle (1st Generation)'
    );
  });

  test('mini 0x1205 resolves via mini_1g (family + ordinal)', () => {
    // 0x1205 covers both mini 1G and 2G; mapped to mini_1g per lookups.
    const model = identify({ from: 'usb', productId: '0x1205' });
    expect(model?.family).toBe('iPod mini');
    expect(model?.ordinal).toBe(1);
    expect(model?.displayName).toBe('iPod mini (1st Generation)');
  });

  test('exposes structured family + ordinal fields', () => {
    const nano3 = identify({ from: 'usb', productId: '0x1262' });
    expect(nano3?.family).toBe('iPod nano');
    expect(nano3?.ordinal).toBe(3);

    const video55 = identify({ from: 'usb', productId: '0x1209' });
    expect(video55?.family).toBe('iPod Video');
    expect(video55?.ordinal).toBe(5);
  });
});

// ── lookupByModelNumber ──────────────────────────────────────────────────────

describe('lookupByModelNumber', () => {
  test('returns generation + variant for known model numbers with M prefix', () => {
    const a147 = lookupByModelNumber('MA147');
    expect(a147?.generation).toBe('video_5g');
    expect(a147?.capacityGb).toBe(60);
    expect(a147?.color).toBe('Black');

    const c297 = lookupByModelNumber('MC297');
    expect(c297?.generation).toBe('classic_7g');
    expect(c297?.capacityGb).toBe(160);
    expect(c297?.color).toBe('Black');

    const b261 = lookupByModelNumber('MB261');
    expect(b261?.generation).toBe('nano_3g');
    expect(b261?.capacityGb).toBe(8);
    expect(b261?.color).toBe('Black');
  });

  test('returns entry for known model numbers without M prefix', () => {
    expect(lookupByModelNumber('A147')?.generation).toBe('video_5g');
    expect(lookupByModelNumber('B261')?.generation).toBe('nano_3g');
  });

  test('strips Apple service / refurb prefixes (P, F)', () => {
    expect(lookupByModelNumber('P9804')?.generation).toBe('mini_2g');
    expect(lookupByModelNumber('F9436')?.generation).toBe('mini_1g');
  });

  test('is case-insensitive', () => {
    expect(lookupByModelNumber('ma147')?.generation).toBe('video_5g');
    expect(lookupByModelNumber('mb261')?.generation).toBe('nano_3g');
  });

  test('returns entry for legacy entries', () => {
    expect(lookupByModelNumber('MA099LL')?.generation).toBe('nano_1g');
    expect(lookupByModelNumber('MC477')?.generation).toBe('classic_7g');
  });

  test('returns undefined for unknown model numbers', () => {
    expect(lookupByModelNumber('MZZZZ')).toBeUndefined();
    expect(lookupByModelNumber('Z9999')).toBeUndefined();
  });

  test('handles all previously known model numbers from the old table', () => {
    const oldTableEntries: string[] = [
      'M8513',
      'M8737',
      'M8976',
      'M9282',
      'MA079',
      'MA002',
      'MA444',
      'MB029',
      'MC293',
      'M9160',
      'M9800',
      'MA004',
      'MA477',
      'MB261',
      'MB598',
      'MC027',
      'MC525',
    ];

    for (const modelNum of oldTableEntries) {
      const result = lookupByModelNumber(modelNum);
      expect(result).toBeDefined();
      expect(typeof result?.generation).toBe('string');
    }
  });
});

// ── identify({ from: 'sysinfo' }) — display strings ─────────────────────────

describe('identify({ from: sysinfo })', () => {
  test('composes rich labels with capacity + colour', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'MA147' })?.displayName).toBe(
      'iPod Video 60GB Black (5th Generation)'
    );
    expect(identify({ from: 'sysinfo', modelNumStr: 'MB261' })?.displayName).toBe(
      'iPod nano 8GB Black (3rd Generation)'
    );
    expect(identify({ from: 'sysinfo', modelNumStr: 'MC297' })?.displayName).toBe(
      'iPod Classic 160GB Black (7th Generation)'
    );
  });

  test('inserts variant tag between family and capacity (U2)', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'M9787' })?.displayName).toBe(
      'iPod U2 25GB (4th Generation)'
    );
    expect(identify({ from: 'sysinfo', modelNumStr: 'MA127' })?.displayName).toBe(
      'iPod Photo U2 20GB'
    );
    expect(identify({ from: 'sysinfo', modelNumStr: 'MA664' })?.displayName).toBe(
      'iPod Video U2 30GB (5.5th Generation)'
    );
  });

  test('inserts variant tag for 2015 nano 7G refresh', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'KN52' })?.displayName).toBe(
      'iPod nano 2015 16GB Space Gray (7th Generation)'
    );
  });

  test('photo family renders without a generation marker', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'MA079' })?.displayName).toBe(
      'iPod Photo 20GB'
    );
  });

  test('decimal ordinals render with -th suffix', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'MA444' })?.displayName).toBe(
      'iPod Video 30GB White (5.5th Generation)'
    );
  });

  test('sub-GB capacities render as MB', () => {
    expect(identify({ from: 'sysinfo', modelNumStr: 'M9724' })?.displayName).toBe(
      'iPod shuffle 512MB (1st Generation)'
    );
  });
});

// ── lookupBySerial ───────────────────────────────────────────────────────────

describe('lookupBySerial', () => {
  test('returns variant for known serial suffix (real hardware: nano 3G)', () => {
    const variant = lookupBySerial('YXX');
    expect(variant).toBeDefined();
    expect(variant!.modelNumber).toBe('B261');
    expect(variant!.generation).toBe('nano_3g');
    expect(variant!.capacityGb).toBe(8);
    expect(variant!.color).toBe('Black');
  });

  test('returns variant for classic 6G suffix', () => {
    const variant = lookupBySerial('Y5N');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('classic_6g');
    expect(variant!.modelNumber).toBe('B029');
  });

  test('returns variant for shuffle suffix', () => {
    const variant = lookupBySerial('RS9');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('shuffle_1g');
  });

  test('returns variant for nano 5G suffix', () => {
    const variant = lookupBySerial('71V');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_5g');
    expect(variant!.modelNumber).toBe('C027');
  });

  test('returns variant for nano 6G suffix', () => {
    const variant = lookupBySerial('CMN');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_6g');
    expect(variant!.modelNumber).toBe('C525');
  });

  test('returns variant for iPod touch suffix', () => {
    const variant = lookupBySerial('W4N');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('touch_1g');
    expect(variant!.modelNumber).toBe('A623');
  });

  test('returns variant for mini 2G 4GB Pink (real hardware: serial JQ5141TFS4G)', () => {
    const variant = lookupBySerial('S4G');
    expect(variant).toBeDefined();
    expect(variant!.modelNumber).toBe('9804');
    expect(variant!.generation).toBe('mini_2g');
    expect(variant!.capacityGb).toBe(4);
    expect(variant!.color).toBe('Pink');
  });

  test('returns variant for nano 7G 16GB Blue (real hardware: serial DCYL44J8F0GP)', () => {
    const variant = lookupBySerial('0GP');
    expect(variant).toBeDefined();
    expect(variant!.modelNumber).toBe('D477');
    expect(variant!.generation).toBe('nano_7g');
    expect(variant!.capacityGb).toBe(16);
    expect(variant!.color).toBe('Blue');
  });

  test('is case-insensitive', () => {
    const upper = lookupBySerial('YXX');
    const lower = lookupBySerial('yxx');
    expect(upper).toEqual(lower);
  });

  test('returns undefined for unknown suffix', () => {
    expect(lookupBySerial('ZZZ')).toBeUndefined();
  });

  test('returns undefined for empty or wrong-length suffix', () => {
    expect(lookupBySerial('')).toBeUndefined();
    expect(lookupBySerial('AB')).toBeUndefined();
    expect(lookupBySerial('ABCD')).toBeUndefined();
  });

  test('returns variant for 1st gen iPod suffix', () => {
    const variant = lookupBySerial('LG6');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('classic_1g');
  });

  test('returns variant for iPod Photo suffix', () => {
    const variant = lookupBySerial('TDU');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('photo');
    expect(variant!.modelNumber).toBe('A079');
  });

  test('returns variant for video 5.5G suffix', () => {
    const variant = lookupBySerial('V9K');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('video_5_5g');
    expect(variant!.modelNumber).toBe('A444');
  });
});

// ── lookupGenerationInfo ─────────────────────────────────────────────────────

describe('lookupGenerationInfo', () => {
  test('returns correct info for classic_6g', () => {
    const info = lookupGenerationInfo('classic_6g');
    expect(info.id).toBe('classic_6g');
    expect(info.family).toBe('iPod Classic');
    expect(info.ordinal).toBe(6);
    expect(info.checksumType).toBe('hash58');
  });

  test('returns correct info for nano_5g', () => {
    const info = lookupGenerationInfo('nano_5g');
    expect(info.id).toBe('nano_5g');
    expect(info.family).toBe('iPod nano');
    expect(info.ordinal).toBe(5);
    expect(info.checksumType).toBe('hash72');
  });

  test('returns correct info for nano_6g', () => {
    const info = lookupGenerationInfo('nano_6g');
    expect(info.checksumType).toBe('hashAB');
  });

  test('returns correct info for video_5g', () => {
    const info = lookupGenerationInfo('video_5g');
    expect(info.checksumType).toBe('none');
  });

  test('photo carries a null ordinal (no generation marker)', () => {
    const info = lookupGenerationInfo('photo');
    expect(info.family).toBe('iPod Photo');
    expect(info.ordinal).toBeNull();
  });

  test('video_5_5g carries the decimal ordinal 5.5', () => {
    const info = lookupGenerationInfo('video_5_5g');
    expect(info.family).toBe('iPod Video');
    expect(info.ordinal).toBe(5.5);
  });
});

// ── New: getChecksumType ────────────────────────────────────────────────────

describe('getChecksumType', () => {
  test.each<[IpodGenerationId, IpodChecksumType]>([
    // none -- early generations
    ['classic_1g', 'none'],
    ['classic_2g', 'none'],
    ['classic_3g', 'none'],
    ['classic_4g', 'none'],
    ['photo', 'none'],
    ['video_5g', 'none'],
    ['video_5_5g', 'none'],
    ['mini_1g', 'none'],
    ['mini_2g', 'none'],
    ['nano_1g', 'none'],
    ['nano_2g', 'none'],
    ['shuffle_1g', 'none'],
    ['shuffle_2g', 'none'],

    // hash58
    ['classic_6g', 'hash58'],
    ['classic_7g', 'hash58'],
    ['nano_3g', 'hash58'],
    ['nano_4g', 'hash58'],

    // hash72
    ['nano_5g', 'hash72'],

    // hashAB
    ['nano_6g', 'hashAB'],
    ['touch_4g', 'hashAB'],

    ['nano_7g', 'hashAB'],
    ['touch_1g', 'hash72'],
    ['touch_2g', 'hash72'],
    ['touch_3g', 'hash72'],

    // none (unsupported but included for completeness)
    ['shuffle_3g', 'none'],
    ['shuffle_4g', 'none'],
    ['touch_5g', 'none'],
    ['touch_6g', 'none'],
    ['touch_7g', 'none'],
  ])('%s -> %s', (generation, expectedType) => {
    expect(getChecksumType(generation)).toBe(expectedType);
  });
});

// ── New: lookupGenerationByProductId ────────────────────────────────────────

describe('lookupGenerationByProductId', () => {
  test('returns generation for 0x120x range', () => {
    expect(lookupGenerationByProductId('0x1209')).toBe('video_5g');
    expect(lookupGenerationByProductId('0x120a')).toBe('nano_1g');
    expect(lookupGenerationByProductId('0x1208')).toBe('nano_3g');
    expect(lookupGenerationByProductId('0x120b')).toBe('nano_4g');
    expect(lookupGenerationByProductId('0x120c')).toBe('nano_5g');
  });

  test('returns generation for 0x126x range', () => {
    expect(lookupGenerationByProductId('0x1261')).toBe('classic_6g');
    expect(lookupGenerationByProductId('0x1262')).toBe('nano_3g');
    expect(lookupGenerationByProductId('0x1263')).toBe('nano_4g');
    expect(lookupGenerationByProductId('0x1265')).toBe('nano_5g');
    expect(lookupGenerationByProductId('0x1266')).toBe('nano_6g');
  });

  test('both ranges map to the same generation', () => {
    expect(lookupGenerationByProductId('0x1206')).toBe(lookupGenerationByProductId('0x1260'));
    expect(lookupGenerationByProductId('0x1208')).toBe(lookupGenerationByProductId('0x1262'));
    expect(lookupGenerationByProductId('0x120b')).toBe(lookupGenerationByProductId('0x1263'));
    expect(lookupGenerationByProductId('0x120c')).toBe(lookupGenerationByProductId('0x1265'));
  });

  test('returns undefined for unknown product ID', () => {
    expect(lookupGenerationByProductId('0x9999')).toBeUndefined();
  });

  test('normalises input without 0x prefix', () => {
    expect(lookupGenerationByProductId('1209')).toBe('video_5g');
  });
});

// ── Cross-referencing: serial -> model -> generation -> checksum ─────────────

describe('end-to-end identification pipeline', () => {
  test('serial suffix -> model -> generation -> checksum type', () => {
    const variant = lookupBySerial('YXX');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_3g');

    const checksumType = getChecksumType(variant!.generation);
    expect(checksumType).toBe('hash58');

    const genInfo = lookupGenerationInfo(variant!.generation);
    expect(genInfo.family).toBe('iPod nano');
    expect(genInfo.ordinal).toBe(3);
  });

  test('USB product ID -> generation -> checksum type', () => {
    const gen = lookupGenerationByProductId('0x1262');
    expect(gen).toBe('nano_3g');

    const checksumType = getChecksumType(gen!);
    expect(checksumType).toBe('hash58');
  });

  test('model number -> serial suffix cross-reference produces identical IpodModel', () => {
    const byNumber = identify({ from: 'sysinfo', modelNumStr: 'MB261' });
    const bySerial = identify({ from: 'serial', serialNumber: 'AAAAAAAAYXX' });

    expect(byNumber).toBeDefined();
    expect(bySerial).toBeDefined();
    expect(bySerial!.displayName).toBe(byNumber!.displayName);
  });
});

// ── getChecksumTypeByModelNumber ────────────────────────────────────────────

describe('getChecksumTypeByModelNumber', () => {
  test('returns none for iPod Video 5G (MA147)', () => {
    expect(getChecksumTypeByModelNumber('MA147')).toBe('none');
  });

  test('returns hash58 for iPod Classic 6G (MB147)', () => {
    expect(getChecksumTypeByModelNumber('MB147')).toBe('hash58');
  });

  test('returns hash58 for iPod Classic 7G (MC297)', () => {
    expect(getChecksumTypeByModelNumber('MC297')).toBe('hash58');
  });

  test('returns hash58 for iPod Nano 3G (MB261)', () => {
    expect(getChecksumTypeByModelNumber('MB261')).toBe('hash58');
  });

  test('returns none for iPod Nano 1G (MA350)', () => {
    expect(getChecksumTypeByModelNumber('MA350')).toBe('none');
  });

  test('returns undefined for unrecognized model number', () => {
    expect(getChecksumTypeByModelNumber('ZZZZ')).toBeUndefined();
  });

  test('handles lowercase model numbers', () => {
    expect(getChecksumTypeByModelNumber('mb147')).toBe('hash58');
  });
});

// ── lookupGenerationByModelNumber ──────────────────────────────────────────

describe('lookupGenerationByModelNumber', () => {
  test('returns generation for known model number', () => {
    expect(lookupGenerationByModelNumber('MA147')).toBe('video_5g');
  });

  test('returns generation for Classic 6G (MB147)', () => {
    expect(lookupGenerationByModelNumber('MB147')).toBe('classic_6g');
  });

  test('returns generation for Classic 7G (MC297)', () => {
    expect(lookupGenerationByModelNumber('MC297')).toBe('classic_7g');
  });

  test('strips M prefix (retail)', () => {
    expect(lookupGenerationByModelNumber('MA350')).toBe('nano_1g');
  });

  test('strips P prefix (service stock)', () => {
    expect(lookupGenerationByModelNumber('PA147')).toBe('video_5g');
  });

  test('strips F prefix (refurbished)', () => {
    expect(lookupGenerationByModelNumber('FA147')).toBe('video_5g');
  });

  test('returns undefined for unrecognized model number', () => {
    expect(lookupGenerationByModelNumber('ZZZZ')).toBeUndefined();
  });

  test('handles lowercase model numbers', () => {
    expect(lookupGenerationByModelNumber('mb147')).toBe('classic_6g');
  });

  test('returns generation for legacy override (MC477)', () => {
    expect(lookupGenerationByModelNumber('MC477')).toBe('classic_7g');
  });
});

describe('toLibgpodGeneration', () => {
  test('maps nano generations correctly', () => {
    expect(toLibgpodGeneration('nano_1g')).toBe('nano_1');
    expect(toLibgpodGeneration('nano_4g')).toBe('nano_4');
    expect(toLibgpodGeneration('nano_6g')).toBe('nano_6');
  });

  test('maps classic generations (non-trivial naming)', () => {
    expect(toLibgpodGeneration('classic_6g')).toBe('classic_1');
    expect(toLibgpodGeneration('classic_7g')).toBe('classic_3');
  });

  test('maps video generations (non-trivial naming)', () => {
    expect(toLibgpodGeneration('video_5g')).toBe('video_1');
    expect(toLibgpodGeneration('video_5_5g')).toBe('video_2');
  });

  test('maps early iPod generations', () => {
    expect(toLibgpodGeneration('classic_1g')).toBe('first');
    expect(toLibgpodGeneration('classic_2g')).toBe('second');
    expect(toLibgpodGeneration('classic_3g')).toBe('third');
    expect(toLibgpodGeneration('classic_4g')).toBe('fourth');
    expect(toLibgpodGeneration('photo')).toBe('photo');
  });

  test('maps touch/shuffle/mini generations', () => {
    expect(toLibgpodGeneration('touch_1g')).toBe('touch_1');
    expect(toLibgpodGeneration('shuffle_2g')).toBe('shuffle_2');
    expect(toLibgpodGeneration('mini_1g')).toBe('mini_1');
    expect(toLibgpodGeneration('mini_2g')).toBe('mini_2');
  });

  test('returns unknown for generations not in libgpod', () => {
    expect(toLibgpodGeneration('nano_7g')).toBe('unknown');
    expect(toLibgpodGeneration('touch_5g')).toBe('unknown');
    expect(toLibgpodGeneration('touch_6g')).toBe('unknown');
    expect(toLibgpodGeneration('touch_7g')).toBe('unknown');
  });
});

// ── lookupByFamilyId ─────────────────────────────────────────────────────────

describe('lookupByFamilyId', () => {
  // Confirmed from real device SysInfoExtended captures in documents/sysinfo-captures/
  test('FamilyID 3 → mini_2g (confirmed: mini-2g.xml)', () => {
    expect(lookupByFamilyId(3)).toBe('mini_2g');
  });

  test('FamilyID 6 → video_5g (confirmed: ipod-5g-video-iflash-1tb.xml; covers 5.5G too)', () => {
    expect(lookupByFamilyId(6)).toBe('video_5g');
  });

  test('FamilyID 9 → nano_2g (confirmed: nano-2g-4gb-green.xml)', () => {
    expect(lookupByFamilyId(9)).toBe('nano_2g');
  });

  test('FamilyID 15 → nano_4g (confirmed: nano-4g-8gb-black.xml)', () => {
    expect(lookupByFamilyId(15)).toBe('nano_4g');
  });

  test('FamilyID 18 → nano_7g (confirmed: nano-7g-16gb-scsi.xml + usb.xml)', () => {
    expect(lookupByFamilyId(18)).toBe('nano_7g');
  });

  // Spot-checks on research-sourced entries (unconfirmed by real captures)
  test('FamilyID 1 → classic_3g (research)', () => {
    expect(lookupByFamilyId(1)).toBe('classic_3g');
  });

  test('FamilyID 5 → mini_1g (research)', () => {
    expect(lookupByFamilyId(5)).toBe('mini_1g');
  });

  test('FamilyID 7 → classic_6g (research)', () => {
    expect(lookupByFamilyId(7)).toBe('classic_6g');
  });

  test('FamilyID 14 → classic_6g (research; 120GB model shares generation with FamilyID 7)', () => {
    expect(lookupByFamilyId(14)).toBe('classic_6g');
  });

  test('FamilyID 24 → nano_6g (research)', () => {
    expect(lookupByFamilyId(24)).toBe('nano_6g');
  });

  // Sentinel / boundary cases
  test('returns undefined for unknown FamilyID', () => {
    expect(lookupByFamilyId(9999)).toBeUndefined();
  });

  test('returns undefined for FamilyID 0 (not-detected sentinel)', () => {
    expect(lookupByFamilyId(0)).toBeUndefined();
  });

  test('returns undefined for negative FamilyID', () => {
    expect(lookupByFamilyId(-1)).toBeUndefined();
  });

  // classic_1g and classic_2g are intentionally absent (pre-SysInfoExtended era)
  test('no FamilyID entry resolves to classic_1g or classic_2g (pre-SysInfoExtended era)', () => {
    const allMapped = Array.from({ length: 30 }, (_, i) => lookupByFamilyId(i)).filter(Boolean);
    expect(allMapped).not.toContain('classic_1g');
    expect(allMapped).not.toContain('classic_2g');
  });

  // video_5_5g has no separate FamilyID — it shares FamilyID 6 with video_5g
  test('video_5_5g has no separate FamilyID entry (shares FamilyID 6 with video_5g)', () => {
    const allMapped = Array.from({ length: 30 }, (_, i) => lookupByFamilyId(i)).filter(Boolean);
    expect(allMapped).not.toContain('video_5_5g');
    expect(allMapped).toContain('video_5g');
  });
});
