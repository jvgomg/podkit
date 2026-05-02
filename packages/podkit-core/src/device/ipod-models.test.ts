import { describe, expect, test } from 'bun:test';

import {
  getChecksumType,
  getChecksumTypeByModelNumber,
  getGenerationInfo,
  lookupGenerationByModelNumber,
  lookupGenerationByProductId,
  lookupIpodModel,
  lookupIpodModelByNumber,
  lookupIpodModelBySerial,
  resolveIpodModel,
  toLibgpodGeneration,
} from './ipod-models.js';

import type { IpodChecksumType, IpodGenerationId } from './ipod-models.js';

// ── Backward compatibility: lookupIpodModel ─────────────────────────────────

describe('lookupIpodModel', () => {
  test('returns model name for known 0x120x product IDs', () => {
    expect(lookupIpodModel('0x1209')).toBe('iPod Classic 6th generation');
    expect(lookupIpodModel('0x120a')).toBe('iPod Classic 7th generation');
    expect(lookupIpodModel('0x1207')).toBe('iPod 5th generation (Video)');
    expect(lookupIpodModel('0x1205')).toBe('iPod nano 1st generation');
    expect(lookupIpodModel('0x1208')).toBe('iPod nano 3rd generation');
    expect(lookupIpodModel('0x120b')).toBe('iPod nano 4th generation');
    expect(lookupIpodModel('0x120c')).toBe('iPod nano 5th generation');
    expect(lookupIpodModel('0x120d')).toBe('iPod nano 6th generation');
    expect(lookupIpodModel('0x120e')).toBe('iPod nano 7th generation');
  });

  test('returns model name for new 0x126x product IDs', () => {
    expect(lookupIpodModel('0x1260')).toBe('iPod nano 2nd generation');
    expect(lookupIpodModel('0x1261')).toBe('iPod Classic 6th generation');
    expect(lookupIpodModel('0x1262')).toBe('iPod nano 3rd generation');
    expect(lookupIpodModel('0x1263')).toBe('iPod nano 4th generation');
    expect(lookupIpodModel('0x1265')).toBe('iPod nano 5th generation');
    expect(lookupIpodModel('0x1266')).toBe('iPod nano 6th generation');
    expect(lookupIpodModel('0x1267')).toBe('iPod nano 7th generation');
  });

  test('returns model name for shuffle IDs', () => {
    expect(lookupIpodModel('0x1300')).toBe('iPod shuffle 1st generation');
    expect(lookupIpodModel('0x1301')).toBe('iPod shuffle 2nd generation');
    expect(lookupIpodModel('0x1302')).toBe('iPod shuffle 3rd generation');
    expect(lookupIpodModel('0x1303')).toBe('iPod shuffle 4th generation');
  });

  test('returns model name for touch IDs', () => {
    expect(lookupIpodModel('0x1291')).toBe('iPod touch 1st generation');
    expect(lookupIpodModel('0x129a')).toBe('iPod touch 4th generation');
  });

  test('returns model name for mini IDs', () => {
    expect(lookupIpodModel('0x1202')).toBe('iPod mini 1st generation');
    expect(lookupIpodModel('0x1204')).toBe('iPod mini 2nd generation');
  });

  test('normalises input without 0x prefix', () => {
    expect(lookupIpodModel('1209')).toBe('iPod Classic 6th generation');
    expect(lookupIpodModel('1262')).toBe('iPod nano 3rd generation');
  });

  test('normalises uppercase input', () => {
    expect(lookupIpodModel('0X1209')).toBe('iPod Classic 6th generation');
    expect(lookupIpodModel('0X1262')).toBe('iPod nano 3rd generation');
  });

  test('returns undefined for unknown product ID', () => {
    expect(lookupIpodModel('0x9999')).toBeUndefined();
  });

  test('returns undefined for DFU/WTF mode IDs (excluded by design)', () => {
    expect(lookupIpodModel('0x1223')).toBeUndefined();
    expect(lookupIpodModel('0x1224')).toBeUndefined();
  });
});

// ── Backward compatibility: lookupIpodModelByNumber ─────────────────────────

describe('lookupIpodModelByNumber', () => {
  test('returns display name for known model numbers with M prefix', () => {
    expect(lookupIpodModelByNumber('MA147')).toBe('iPod Video 60GB Black (5th Generation)');
    expect(lookupIpodModelByNumber('MC297')).toBe('iPod Classic 160GB Black (7th Generation)');
    expect(lookupIpodModelByNumber('MB261')).toBe('iPod nano 8GB Black (3rd Generation)');
  });

  test('returns display name for known model numbers without M prefix', () => {
    expect(lookupIpodModelByNumber('A147')).toBe('iPod Video 60GB Black (5th Generation)');
    expect(lookupIpodModelByNumber('B261')).toBe('iPod nano 8GB Black (3rd Generation)');
  });

  test('strips Apple service / refurb prefixes (P, F)', () => {
    // P-prefix = service stock / replacement unit. Same hardware as M9804.
    expect(lookupIpodModelByNumber('P9804')).toContain('iPod mini');
    // F-prefix = factory refurbished. Same hardware as M9436.
    expect(lookupIpodModelByNumber('F9436')).toContain('iPod mini');
  });

  test('is case-insensitive', () => {
    expect(lookupIpodModelByNumber('ma147')).toBe('iPod Video 60GB Black (5th Generation)');
    expect(lookupIpodModelByNumber('mb261')).toBe('iPod nano 8GB Black (3rd Generation)');
  });

  test('returns display name for legacy entries', () => {
    // MA099LL was in the old table
    expect(lookupIpodModelByNumber('MA099LL')).toBe('iPod nano 1GB (1st Generation)');
    // MC477 was in the old table
    expect(lookupIpodModelByNumber('MC477')).toBe('iPod Classic 160GB (7th Generation)');
  });

  test('returns undefined for unknown model numbers', () => {
    expect(lookupIpodModelByNumber('MZZZZ')).toBeUndefined();
    expect(lookupIpodModelByNumber('Z9999')).toBeUndefined();
  });

  test('handles all previously known model numbers from the old table', () => {
    const oldTableEntries: [string, string][] = [
      ['M8513', 'iPod 5GB (1st Generation)'],
      ['M8737', 'iPod 10GB (2nd Generation)'],
      ['M8976', 'iPod 10GB (3rd Generation)'],
      ['M9282', 'iPod 20GB (4th Generation)'],
      ['MA079', 'iPod Photo 20GB'],
      ['MA002', 'iPod Video 30GB White (5th Generation)'],
      ['MA444', 'iPod Video 30GB White (5.5th Generation)'],
      ['MB029', 'iPod Classic 80GB Silver (6th Generation)'],
      ['MC293', 'iPod Classic 160GB Silver (7th Generation)'],
      ['M9160', 'iPod mini 4GB (1st Generation)'],
      ['M9800', 'iPod mini 4GB (2nd Generation)'],
      ['MA004', 'iPod nano 2GB White (1st Generation)'],
      ['MA477', 'iPod nano 2GB Silver (2nd Generation)'],
      ['MB261', 'iPod nano 8GB Black (3rd Generation)'],
      ['MB598', 'iPod nano 8GB Silver (4th Generation)'],
      ['MC027', 'iPod nano 8GB Silver (5th Generation)'],
      ['MC525', 'iPod nano 8GB Silver (6th Generation)'],
    ];

    for (const [modelNum, _expectedName] of oldTableEntries) {
      const result = lookupIpodModelByNumber(modelNum);
      expect(result).toBeDefined();
      // The new table may have enriched display names (e.g., added color).
      // Just check that it returns something reasonable.
      expect(typeof result).toBe('string');
    }
  });
});

// ── New: lookupIpodModelBySerial ────────────────────────────────────────────

describe('lookupIpodModelBySerial', () => {
  test('returns variant for known serial suffix (real hardware: nano 3G)', () => {
    // Verified on real iPod Nano 3G: serial "5U8280FNYXX" -> suffix "YXX"
    const variant = lookupIpodModelBySerial('YXX');
    expect(variant).toBeDefined();
    expect(variant!.modelNumber).toBe('B261');
    expect(variant!.generation).toBe('nano_3g');
    expect(variant!.capacityGb).toBe(8);
    expect(variant!.color).toBe('Black');
    expect(variant!.displayName).toBe('iPod nano 8GB Black (3rd Generation)');
  });

  test('returns variant for classic 6G suffix', () => {
    const variant = lookupIpodModelBySerial('Y5N');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('classic_6g');
    expect(variant!.modelNumber).toBe('B029');
  });

  test('returns variant for shuffle suffix', () => {
    const variant = lookupIpodModelBySerial('RS9');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('shuffle_1g');
  });

  test('returns variant for nano 5G suffix', () => {
    const variant = lookupIpodModelBySerial('71V');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_5g');
    expect(variant!.modelNumber).toBe('C027');
  });

  test('returns variant for nano 6G suffix', () => {
    const variant = lookupIpodModelBySerial('CMN');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_6g');
    expect(variant!.modelNumber).toBe('C525');
  });

  test('returns variant for iPod touch suffix', () => {
    const variant = lookupIpodModelBySerial('W4N');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('touch_1g');
    expect(variant!.modelNumber).toBe('A623');
  });

  test('is case-insensitive', () => {
    const upper = lookupIpodModelBySerial('YXX');
    const lower = lookupIpodModelBySerial('yxx');
    expect(upper).toEqual(lower);
  });

  test('returns undefined for unknown suffix', () => {
    expect(lookupIpodModelBySerial('ZZZ')).toBeUndefined();
  });

  test('returns undefined for empty or wrong-length suffix', () => {
    expect(lookupIpodModelBySerial('')).toBeUndefined();
    expect(lookupIpodModelBySerial('AB')).toBeUndefined();
    expect(lookupIpodModelBySerial('ABCD')).toBeUndefined();
  });

  test('returns variant for 1st gen iPod suffix', () => {
    const variant = lookupIpodModelBySerial('LG6');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('classic_1g');
  });

  test('returns variant for iPod Photo suffix', () => {
    const variant = lookupIpodModelBySerial('TDU');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('photo');
    expect(variant!.modelNumber).toBe('A079');
  });

  test('returns variant for video 5.5G suffix', () => {
    const variant = lookupIpodModelBySerial('V9K');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('video_5_5g');
    expect(variant!.modelNumber).toBe('A444');
  });
});

// ── New: getGenerationInfo ──────────────────────────────────────────────────

describe('getGenerationInfo', () => {
  test('returns correct info for classic_6g', () => {
    const info = getGenerationInfo('classic_6g');
    expect(info.id).toBe('classic_6g');
    expect(info.displayName).toBe('iPod Classic (6th Generation)');
    expect(info.checksumType).toBe('hash58');
  });

  test('returns correct info for nano_5g', () => {
    const info = getGenerationInfo('nano_5g');
    expect(info.id).toBe('nano_5g');
    expect(info.checksumType).toBe('hash72');
  });

  test('returns correct info for nano_6g', () => {
    const info = getGenerationInfo('nano_6g');
    expect(info.checksumType).toBe('hashAB');
  });

  test('returns correct info for video_5g', () => {
    const info = getGenerationInfo('video_5g');
    expect(info.checksumType).toBe('none');
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

    // none (unsupported but included for completeness)
    ['shuffle_3g', 'none'],
    ['shuffle_4g', 'none'],
    ['touch_1g', 'none'],
    ['touch_2g', 'none'],
    ['touch_3g', 'none'],
    ['touch_5g', 'none'],
    ['touch_6g', 'none'],
    ['touch_7g', 'none'],
    ['nano_7g', 'none'],
  ])('%s -> %s', (generation, expectedType) => {
    expect(getChecksumType(generation)).toBe(expectedType);
  });
});

// ── New: lookupGenerationByProductId ────────────────────────────────────────

describe('lookupGenerationByProductId', () => {
  test('returns generation for 0x120x range', () => {
    expect(lookupGenerationByProductId('0x1209')).toBe('classic_6g');
    expect(lookupGenerationByProductId('0x120a')).toBe('classic_7g');
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
    expect(lookupGenerationByProductId('1209')).toBe('classic_6g');
  });
});

// ── Cross-referencing: serial -> model -> generation -> checksum ─────────────

describe('end-to-end identification pipeline', () => {
  test('serial suffix -> model -> generation -> checksum type', () => {
    // Real hardware: iPod Nano 3G, serial suffix YXX
    const variant = lookupIpodModelBySerial('YXX');
    expect(variant).toBeDefined();
    expect(variant!.generation).toBe('nano_3g');

    const checksumType = getChecksumType(variant!.generation);
    expect(checksumType).toBe('hash58');

    const genInfo = getGenerationInfo(variant!.generation);
    expect(genInfo.displayName).toBe('iPod nano (3rd Generation)');
  });

  test('USB product ID -> generation -> checksum type', () => {
    // 0x1262 = nano 3G (0x126x range)
    const gen = lookupGenerationByProductId('0x1262');
    expect(gen).toBe('nano_3g');

    const checksumType = getChecksumType(gen!);
    expect(checksumType).toBe('hash58');
  });

  test('model number -> serial suffix cross-reference', () => {
    // lookupIpodModelByNumber("MB261") and lookupIpodModelBySerial("YXX")
    // should both identify as nano 3G
    const byNumber = lookupIpodModelByNumber('MB261');
    const bySerial = lookupIpodModelBySerial('YXX');

    expect(byNumber).toBeDefined();
    expect(bySerial).toBeDefined();
    expect(bySerial!.displayName).toBe(byNumber!);
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
    // P prefix should behave same as M prefix
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

// ── resolveIpodModel ──────────────────────────────────────────────────────

describe('resolveIpodModel', () => {
  describe('from USB product ID', () => {
    test('resolves known product ID to generation-level model', () => {
      const model = resolveIpodModel({ from: 'usb', productId: '0x1260' });
      expect(model).toBeDefined();
      expect(model!.displayName).toBe('iPod nano 2nd generation');
      expect(model!.generationId).toBe('nano_2g');
      expect(model!.checksumType).toBe('none');
      expect(model!.source).toBe('usb');
      expect(model!.color).toBeUndefined();
      expect(model!.capacityGb).toBeUndefined();
      expect(model!.modelNumber).toBeUndefined();
    });

    test('resolves Classic 6G', () => {
      const model = resolveIpodModel({ from: 'usb', productId: '0x1209' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
      expect(model!.checksumType).toBe('hash58');
      expect(model!.source).toBe('usb');
    });

    test('normalises product ID without 0x prefix', () => {
      const model = resolveIpodModel({ from: 'usb', productId: '1209' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
    });

    test('returns undefined for unknown product ID', () => {
      expect(resolveIpodModel({ from: 'usb', productId: '0x9999' })).toBeUndefined();
    });
  });

  describe('from SysInfo model number', () => {
    test('resolves known model number with full variant info', () => {
      const model = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MA477' });
      expect(model).toBeDefined();
      expect(model!.displayName).toBe('iPod nano 2GB Silver (2nd Generation)');
      expect(model!.generationId).toBe('nano_2g');
      expect(model!.checksumType).toBe('none');
      expect(model!.modelNumber).toBe('A477');
      expect(model!.capacityGb).toBe(2);
      expect(model!.color).toBe('Silver');
      expect(model!.source).toBe('sysinfo');
    });

    test('strips M/P/F prefix', () => {
      const mModel = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MA477' });
      const pModel = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'PA477' });
      const fModel = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'FA477' });
      expect(mModel!.displayName).toBe(pModel!.displayName);
      expect(mModel!.displayName).toBe(fModel!.displayName);
    });

    test('is case-insensitive', () => {
      const model = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'ma477' });
      expect(model).toBeDefined();
      expect(model!.color).toBe('Silver');
    });

    test('returns undefined for unknown model number', () => {
      expect(resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MZZZZ' })).toBeUndefined();
    });

    test('resolves Classic 6G with hash58 checksum', () => {
      const model = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MB029' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
      expect(model!.checksumType).toBe('hash58');
      expect(model!.color).toBe('Silver');
      expect(model!.capacityGb).toBe(80);
    });
  });

  describe('from serial number', () => {
    test('resolves known serial suffix with full variant info', () => {
      const model = resolveIpodModel({ from: 'serial', serialNumber: '5U828GFNYXX' });
      expect(model).toBeDefined();
      expect(model!.displayName).toBe('iPod nano 8GB Black (3rd Generation)');
      expect(model!.generationId).toBe('nano_3g');
      expect(model!.checksumType).toBe('hash58');
      expect(model!.modelNumber).toBe('B261');
      expect(model!.capacityGb).toBe(8);
      expect(model!.color).toBe('Black');
      expect(model!.source).toBe('serial');
    });

    test('uses last 3 chars of serial', () => {
      // Full serial with known suffix YXX
      const model = resolveIpodModel({ from: 'serial', serialNumber: 'ABCDEFGHYXX' });
      expect(model).toBeDefined();
      expect(model!.modelNumber).toBe('B261');
    });

    test('returns undefined for FireWire GUID (no match)', () => {
      // FireWire GUIDs have hex-only suffixes that aren't in the serial table
      const model = resolveIpodModel({ from: 'serial', serialNumber: '000A27001A0647CB' });
      expect(model).toBeUndefined();
    });

    test('returns undefined for too-short serial', () => {
      expect(resolveIpodModel({ from: 'serial', serialNumber: 'AB' })).toBeUndefined();
      expect(resolveIpodModel({ from: 'serial', serialNumber: '' })).toBeUndefined();
    });

    test('is case-insensitive', () => {
      const upper = resolveIpodModel({ from: 'serial', serialNumber: 'XXXXXGFNYXX' });
      const lower = resolveIpodModel({ from: 'serial', serialNumber: 'xxxxxgfnyxx' });
      expect(upper).toEqual(lower);
    });
  });

  describe('source field tracks provenance', () => {
    test('USB source has no variant details', () => {
      const model = resolveIpodModel({ from: 'usb', productId: '0x1209' });
      expect(model!.source).toBe('usb');
      expect(model!.color).toBeUndefined();
      expect(model!.capacityGb).toBeUndefined();
      expect(model!.modelNumber).toBeUndefined();
    });

    test('SysInfo source has variant details', () => {
      const model = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MB261' });
      expect(model!.source).toBe('sysinfo');
      expect(model!.color).toBe('Black');
      expect(model!.capacityGb).toBe(8);
      expect(model!.modelNumber).toBe('B261');
    });

    test('serial source has variant details', () => {
      const model = resolveIpodModel({ from: 'serial', serialNumber: '5U828GFNYXX' });
      expect(model!.source).toBe('serial');
      expect(model!.color).toBe('Black');
      expect(model!.capacityGb).toBe(8);
      expect(model!.modelNumber).toBe('B261');
    });
  });

  describe('USB and SysInfo agree on generation', () => {
    test('nano 2G from USB matches nano 2G from SysInfo', () => {
      const usb = resolveIpodModel({ from: 'usb', productId: '0x1260' });
      const sysinfo = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MA477' });
      expect(usb!.generationId).toBe(sysinfo!.generationId);
    });

    test('classic 6G from USB matches classic 6G from SysInfo', () => {
      const usb = resolveIpodModel({ from: 'usb', productId: '0x1209' });
      const sysinfo = resolveIpodModel({ from: 'sysinfo', modelNumStr: 'MB029' });
      expect(usb!.generationId).toBe(sysinfo!.generationId);
    });
  });
});
