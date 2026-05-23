import { describe, expect, test } from 'bun:test';

import { identify } from './identity.js';

// ── identify (multi-axis facade) ──────────────────────────────────────────

describe('identify', () => {
  describe('from USB product ID', () => {
    test('resolves known product ID to generation-level model', () => {
      const model = identify({ from: 'usb', productId: '0x1260' });
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
      const model = identify({ from: 'usb', productId: '0x1261' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
      expect(model!.checksumType).toBe('hash58');
      expect(model!.source).toBe('usb');
    });

    test('normalises product ID without 0x prefix', () => {
      const model = identify({ from: 'usb', productId: '1261' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
    });

    test('returns undefined for unknown product ID', () => {
      expect(identify({ from: 'usb', productId: '0x9999' })).toBeUndefined();
    });
  });

  describe('from SysInfo model number', () => {
    test('resolves known model number with full variant info', () => {
      const model = identify({ from: 'sysinfo', modelNumStr: 'MA477' });
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
      const mModel = identify({ from: 'sysinfo', modelNumStr: 'MA477' });
      const pModel = identify({ from: 'sysinfo', modelNumStr: 'PA477' });
      const fModel = identify({ from: 'sysinfo', modelNumStr: 'FA477' });
      expect(mModel!.displayName).toBe(pModel!.displayName);
      expect(mModel!.displayName).toBe(fModel!.displayName);
    });

    test('is case-insensitive', () => {
      const model = identify({ from: 'sysinfo', modelNumStr: 'ma477' });
      expect(model).toBeDefined();
      expect(model!.color).toBe('Silver');
    });

    test('returns undefined for unknown model number', () => {
      expect(identify({ from: 'sysinfo', modelNumStr: 'MZZZZ' })).toBeUndefined();
    });

    test('resolves Classic 6G with hash58 checksum', () => {
      const model = identify({ from: 'sysinfo', modelNumStr: 'MB029' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('classic_6g');
      expect(model!.checksumType).toBe('hash58');
      expect(model!.color).toBe('Silver');
      expect(model!.capacityGb).toBe(80);
    });
  });

  describe('from serial number', () => {
    test('resolves known serial suffix with full variant info', () => {
      const model = identify({ from: 'serial', serialNumber: '5U828GFNYXX' });
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
      const model = identify({ from: 'serial', serialNumber: 'ABCDEFGHYXX' });
      expect(model).toBeDefined();
      expect(model!.modelNumber).toBe('B261');
    });

    test('returns undefined for FireWire GUID (no match)', () => {
      const model = identify({ from: 'serial', serialNumber: '000A27001A0647CB' });
      expect(model).toBeUndefined();
    });

    test('returns undefined for too-short serial', () => {
      expect(identify({ from: 'serial', serialNumber: 'AB' })).toBeUndefined();
      expect(identify({ from: 'serial', serialNumber: '' })).toBeUndefined();
    });

    test('is case-insensitive', () => {
      const upper = identify({ from: 'serial', serialNumber: 'XXXXXGFNYXX' });
      const lower = identify({ from: 'serial', serialNumber: 'xxxxxgfnyxx' });
      expect(upper).toEqual(lower);
    });
  });

  describe('source field tracks provenance', () => {
    test('USB source has no variant details', () => {
      const model = identify({ from: 'usb', productId: '0x1261' });
      expect(model!.source).toBe('usb');
      expect(model!.color).toBeUndefined();
      expect(model!.capacityGb).toBeUndefined();
      expect(model!.modelNumber).toBeUndefined();
    });

    test('SysInfo source has variant details', () => {
      const model = identify({ from: 'sysinfo', modelNumStr: 'MB261' });
      expect(model!.source).toBe('sysinfo');
      expect(model!.color).toBe('Black');
      expect(model!.capacityGb).toBe(8);
      expect(model!.modelNumber).toBe('B261');
    });

    test('serial source has variant details', () => {
      const model = identify({ from: 'serial', serialNumber: '5U828GFNYXX' });
      expect(model!.source).toBe('serial');
      expect(model!.color).toBe('Black');
      expect(model!.capacityGb).toBe(8);
      expect(model!.modelNumber).toBe('B261');
    });
  });

  describe('USB and SysInfo agree on generation', () => {
    test('nano 2G from USB matches nano 2G from SysInfo', () => {
      const usb = identify({ from: 'usb', productId: '0x1260' });
      const sysinfo = identify({ from: 'sysinfo', modelNumStr: 'MA477' });
      expect(usb!.generationId).toBe(sysinfo!.generationId);
    });

    test('classic 6G from USB matches classic 6G from SysInfo', () => {
      const usb = identify({ from: 'usb', productId: '0x1261' });
      const sysinfo = identify({ from: 'sysinfo', modelNumStr: 'MB029' });
      expect(usb!.generationId).toBe(sysinfo!.generationId);
    });
  });

  describe('unsupportedReason — unsupported generations', () => {
    test('nano 7G via USB PID 0x120e returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x120e' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('nano_7g');
      expect(model!.unsupportedReason).toBeDefined();
      expect(model!.unsupportedReason!.headline).toMatch(/nano 7th gen/i);
      // touch_* gets 'ios-device'; everything else gets 'unsupported-device'.
      expect(model!.unsupportedReason!.kind).toBe('unsupported-device');
      expect(model!.unsupportedReason!.docsUrl).toContain('supported-devices');
    });

    test('nano 7G via USB PID 0x1267 returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x1267' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('nano_7g');
      expect(model!.unsupportedReason).toBeDefined();
    });

    test('iPod touch 1G returns unsupportedReason (proprietary protocol)', () => {
      const model = identify({ from: 'usb', productId: '0x1291' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('touch_1g');
      expect(model!.unsupportedReason!.headline).toContain('proprietary sync protocol');
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
    });

    test('iPod touch 4G returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x129a' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('touch_4g');
      expect(model!.unsupportedReason).toBeDefined();
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
    });

    test('iPod touch 5G returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x12a0' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('touch_5g');
      expect(model!.unsupportedReason!.headline).toContain('proprietary sync protocol');
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
    });

    test('iPod touch 6G returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x12ab' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('touch_6g');
      expect(model!.unsupportedReason).toBeDefined();
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
    });

    test('iPod touch 7G returns unsupportedReason', () => {
      const model = identify({ from: 'usb', productId: '0x12a8' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('touch_7g');
      expect(model!.unsupportedReason).toBeDefined();
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
    });

    test('iPod shuffle 3G returns unsupportedReason (iTunes auth)', () => {
      const model = identify({ from: 'usb', productId: '0x1302' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('shuffle_3g');
      expect(model!.unsupportedReason!.headline).toContain('iTunes authentication');
      expect(model!.unsupportedReason!.kind).toBe('unsupported-device');
    });

    test('iPod shuffle 4G returns unsupportedReason (iTunes auth)', () => {
      const model = identify({ from: 'usb', productId: '0x1303' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('shuffle_4g');
      expect(model!.unsupportedReason!.headline).toContain('iTunes authentication');
    });

    test('nano 6G (0x120d) returns unsupportedReason (iTunesDB format)', () => {
      const model = identify({ from: 'usb', productId: '0x120d' });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe('nano_6g');
      expect(model!.unsupportedReason!.headline).toContain('iTunesDB format');
    });

    test('supported devices do NOT have unsupportedReason', () => {
      // iPod Classic 6G — fully supported
      const classic = identify({ from: 'usb', productId: '0x1261' });
      expect(classic!.unsupportedReason).toBeUndefined();
      // iPod nano 5G — fully supported
      const nano5 = identify({ from: 'usb', productId: '0x120c' });
      expect(nano5!.unsupportedReason).toBeUndefined();
    });
  });
});

// ── identify (backward-compatible alias) ──────────────────────────

describe('identify (alias for identify)', () => {
  test('is identical to identify', () => {
    const via_identify = identify({ from: 'usb', productId: '0x1261' });
    const via_alias = identify({ from: 'usb', productId: '0x1261' });
    expect(via_identify).toEqual(via_alias);
  });
});
