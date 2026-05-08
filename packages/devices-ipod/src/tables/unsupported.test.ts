/**
 * Tests for unsupported.ts — per-PID attribution and range-catch fallback.
 *
 * PIDs verified against usb-ids.gowdy.us (linux-usb.org mirror), Apple vendor
 * 0x05ac, accessed 2026-05-06. Range 0x1290–0x12af confirmed by usbmuxd
 * src/usb.h (PID_RANGE_LOW / PID_RANGE_MAX).
 */

import { describe, expect, test } from 'bun:test';
import {
  lookupUnsupportedReason,
  lookupIosRangeFallbackReason,
  UNSUPPORTED_IPOD_PRODUCT_IDS,
} from './unsupported.js';

// ── lookupUnsupportedReason — explicitly listed PIDs ────────────────────────

describe('lookupUnsupportedReason — shuffle', () => {
  test('0x1302 iPod shuffle 3G returns shuffle reason', () => {
    const reason = lookupUnsupportedReason('1302');
    expect(reason).toContain('iPod shuffle 3rd/4th gen');
  });

  test('0x1303 iPod shuffle 4G returns shuffle reason', () => {
    const reason = lookupUnsupportedReason('1303');
    expect(reason).toContain('iPod shuffle 3rd/4th gen');
  });
});

describe('lookupUnsupportedReason — nano 6G / 7G', () => {
  test('0x120d iPod nano 6G (0x120x range)', () => {
    expect(lookupUnsupportedReason('120d')).toContain('nano 6th gen');
  });

  test('0x1266 iPod nano 6G (0x126x range)', () => {
    expect(lookupUnsupportedReason('1266')).toContain('nano 6th gen');
  });

  test('0x120e iPod nano 7G (0x120x range)', () => {
    expect(lookupUnsupportedReason('120e')).toContain('nano 7th gen');
  });

  test('0x1267 iPod nano 7G (0x126x range)', () => {
    expect(lookupUnsupportedReason('1267')).toContain('nano 7th gen');
  });
});

describe('lookupUnsupportedReason — iPod touch', () => {
  test('0x1291 iPod touch 1st generation', () => {
    const reason = lookupUnsupportedReason('1291');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('1st generation');
  });

  test('0x1293 iPod touch 2nd generation (usb.ids: "iPod Touch 2.Gen")', () => {
    const reason = lookupUnsupportedReason('1293');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('2nd generation');
  });

  test('0x1296 iPod touch 3rd generation 8GB (usb.ids: "iPod Touch 3.Gen (8GB)")', () => {
    const reason = lookupUnsupportedReason('1296');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('3rd generation');
  });

  test('0x1299 iPod touch 3rd generation (usb.ids: "iPod Touch 3.Gen")', () => {
    const reason = lookupUnsupportedReason('1299');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('3rd generation');
  });

  test('0x129e iPod touch 4th generation (usb.ids: "iPod Touch 4.Gen")', () => {
    const reason = lookupUnsupportedReason('129e');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('4th generation');
  });

  test('0x12aa iPod touch 5th generation (usb.ids: "iPod Touch 5.Gen [A1421]")', () => {
    const reason = lookupUnsupportedReason('12aa');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPod touch');
    expect(reason).toContain('5th generation');
  });
});

describe('lookupUnsupportedReason — iPhone', () => {
  test('0x1290 iPhone (1st generation)', () => {
    const reason = lookupUnsupportedReason('1290');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPhone');
  });

  test('0x1292 iPhone 3G (usb.ids: "iPhone 3G"; NOT shared with touch 2G)', () => {
    const reason = lookupUnsupportedReason('1292');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPhone 3G');
  });

  test('0x1294 iPhone 3GS', () => {
    expect(lookupUnsupportedReason('1294')).toContain('iPhone 3GS');
  });

  test('0x1297 iPhone 4', () => {
    expect(lookupUnsupportedReason('1297')).toContain('iPhone 4');
  });

  test('0x129c iPhone 4 (CDMA)', () => {
    expect(lookupUnsupportedReason('129c')).toContain('iPhone 4 (CDMA)');
  });

  test('0x129d iPhone (variant)', () => {
    expect(lookupUnsupportedReason('129d')).not.toBeNull();
    expect(lookupUnsupportedReason('129d')).toContain('iPhone');
  });

  test('0x12a0 iPhone 4S (usb.ids: "iPhone 4S"; NOT iPod touch 5G)', () => {
    const reason = lookupUnsupportedReason('12a0');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPhone 4S');
  });

  test('0x12a1 iPhone (variant)', () => {
    expect(lookupUnsupportedReason('12a1')).not.toBeNull();
    expect(lookupUnsupportedReason('12a1')).toContain('iPhone');
  });

  test('0x12a6 iPad 3 (3G, 16 GB) — usb.ids: "iPad 3 (3G, 16 GB)"; was "iPhone 5" — corrected', () => {
    // usb.ids authoritative source lists this as iPad. Prior table had "iPhone 5" — corrected.
    const reason = lookupUnsupportedReason('12a6');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPad');
  });

  test('0x12a8 iPhone 5 / 5c / 5s / 6 / SE / 7 / 8 / X / XR (shared PID)', () => {
    const reason = lookupUnsupportedReason('12a8');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPhone');
  });

  test('0x12ac iPhone (variant)', () => {
    expect(lookupUnsupportedReason('12ac')).not.toBeNull();
    expect(lookupUnsupportedReason('12ac')).toContain('iPhone');
  });
});

describe('lookupUnsupportedReason — iPad', () => {
  test('0x129a iPad (1st generation) (usb.ids: "iPad"; NOT shared with touch 4G)', () => {
    const reason = lookupUnsupportedReason('129a');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPad');
    expect(reason).toContain('1st generation');
  });

  test('0x129f iPad 2 (Wi-Fi)', () => {
    expect(lookupUnsupportedReason('129f')).toContain('iPad 2');
  });

  test('0x12a2 iPad 2 (3G, 64 GB) (usb.ids: "iPad 2 (3G; 64GB)"; NOT iPhone 4S)', () => {
    const reason = lookupUnsupportedReason('12a2');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPad 2');
  });

  test('0x12a3 iPad 2 (CDMA)', () => {
    expect(lookupUnsupportedReason('12a3')).toContain('iPad 2 (CDMA)');
  });

  test('0x12a4 iPad (3rd generation, Wi-Fi)', () => {
    expect(lookupUnsupportedReason('12a4')).toContain('iPad');
    expect(lookupUnsupportedReason('12a4')).toContain('3rd generation');
  });

  test('0x12a5 iPad (3rd generation, CDMA)', () => {
    expect(lookupUnsupportedReason('12a5')).toContain('iPad');
    expect(lookupUnsupportedReason('12a5')).toContain('3rd generation');
  });

  test('0x12a9 iPad 2 (late 2012) (usb.ids: "iPad 2"; was "iPhone 5c / iPad mini 1G" — corrected)', () => {
    const reason = lookupUnsupportedReason('12a9');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPad 2');
  });

  test('0x12ab iPad (4th generation or later) (usb.ids: "iPad"; was "iPod touch 6G" — corrected)', () => {
    const reason = lookupUnsupportedReason('12ab');
    expect(reason).not.toBeNull();
    expect(reason).toContain('iPad');
  });
});

describe('lookupUnsupportedReason — Apple Watch', () => {
  test('0x12af Apple Watch (at upper boundary of iOS range)', () => {
    const reason = lookupUnsupportedReason('12af');
    expect(reason).not.toBeNull();
    expect(reason).toContain('Apple Watch');
  });
});

describe('lookupUnsupportedReason — input normalisation', () => {
  test('accepts 0x prefix', () => {
    expect(lookupUnsupportedReason('0x1290')).toBe(lookupUnsupportedReason('1290'));
  });

  test('is case-insensitive', () => {
    expect(lookupUnsupportedReason('0X12A8')).toBe(lookupUnsupportedReason('12a8'));
    expect(lookupUnsupportedReason('12A8')).toBe(lookupUnsupportedReason('12a8'));
  });

  test('returns null for unknown PID', () => {
    expect(lookupUnsupportedReason('9999')).toBeNull();
  });

  test('returns null for supported iPod PID', () => {
    // 0x1262 = iPod nano 3G — supported device, not in unsupported table
    expect(lookupUnsupportedReason('1262')).toBeNull();
  });
});

// ── lookupIosRangeFallbackReason — range catch ───────────────────────────────

describe('lookupIosRangeFallbackReason — range catch (0x1290–0x12af)', () => {
  test('returns generic iOS reason for unlisted PID within range', () => {
    // 0x12ad is not in UNSUPPORTED_IPOD_PRODUCT_IDS (future/unknown device)
    const reason = lookupIosRangeFallbackReason('12ad');
    expect(reason).not.toBeNull();
    expect(reason).toContain("Apple's proprietary sync protocol");
  });

  test('returns generic iOS reason for 0x12ae (unlisted within range)', () => {
    expect(lookupIosRangeFallbackReason('12ae')).not.toBeNull();
  });

  test('returns reason for lower boundary 0x1290', () => {
    expect(lookupIosRangeFallbackReason('1290')).not.toBeNull();
  });

  test('returns reason for upper boundary 0x12af', () => {
    expect(lookupIosRangeFallbackReason('12af')).not.toBeNull();
  });

  test('returns null below range (0x128f)', () => {
    expect(lookupIosRangeFallbackReason('128f')).toBeNull();
  });

  test('returns null above range (0x12b0 = HomePod)', () => {
    // HomePod is above the iOS PID range — no sync protocol rejection needed
    expect(lookupIosRangeFallbackReason('12b0')).toBeNull();
  });

  test('returns null for supported iPod PID (0x1262 = nano 3G)', () => {
    expect(lookupIosRangeFallbackReason('1262')).toBeNull();
  });

  test('accepts 0x prefix', () => {
    expect(lookupIosRangeFallbackReason('0x12ad')).toBe(lookupIosRangeFallbackReason('12ad'));
  });

  test('is case-insensitive', () => {
    expect(lookupIosRangeFallbackReason('0X12AD')).toBe(lookupIosRangeFallbackReason('12ad'));
  });
});

// ── Structural consistency ──────────────────────────────────────────────────

describe('UNSUPPORTED_IPOD_PRODUCT_IDS structural checks', () => {
  test('all keys are lowercase hex without 0x prefix', () => {
    for (const key of Object.keys(UNSUPPORTED_IPOD_PRODUCT_IDS)) {
      expect(key).toMatch(/^[0-9a-f]+$/);
    }
  });

  test('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(UNSUPPORTED_IPOD_PRODUCT_IDS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      // Just verify each entry has a non-trivial message
      expect(value.length).toBeGreaterThan(20);
      void key;
    }
  });

  test('no PID is listed twice (no duplicate keys)', () => {
    const keys = Object.keys(UNSUPPORTED_IPOD_PRODUCT_IDS);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
