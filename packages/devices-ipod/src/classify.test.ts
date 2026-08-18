import { describe, expect, it } from 'bun:test';
import { classifyAsIpod } from './classify.js';

// ── Apple-vendor + known iPod PIDs ──────────────────────────────────────────

describe('classifyAsIpod — known iPods', () => {
  it('classifies an iPod Classic 6G (0x05ac:0x1261)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '1261' });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('ipod');
    expect(result!.supported).toBe(true);
    expect(result!.unsupportedReason?.headline).toBeUndefined();
    expect(result!.model?.displayName).toBe('iPod Classic (6th Generation)');
  });

  it('classifies an iPod nano 1G (0x05ac:0x120a)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '120a' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(true);
    expect(result!.model?.displayName).toBe('iPod nano (1st Generation)');
  });

  it('preserves passed-in device fields on the classification', () => {
    const device = {
      vendorId: '05ac',
      productId: '1261',
      serialNumber: '000A27001BC8EED6',
      bus: 3,
      devnum: 14,
      diskIdentifier: 'disk5',
    };
    const result = classifyAsIpod(device);
    expect(result!.device).toEqual(device);
  });

  it('accepts vendorId with 0x prefix', () => {
    const result = classifyAsIpod({ vendorId: '0x05ac', productId: '1261' });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('ipod');
  });
});

// ── Public-API contract: defensive vendor/product ID normalisation ──────────
//
// `classifyAsIpod` is a public generic — callers may pass raw system_profiler
// strings without going through `enumerateUsb`. These tests pin the contract
// that all three observed system_profiler vendor-id forms (and the matching
// product-id forms) classify a real iPod.

describe('classifyAsIpod — system_profiler raw input forms', () => {
  it('matches an iPod Classic 6G from a bare-hex vendor + product id', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '1261' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(true);
    expect(result!.model?.displayName).toBe('iPod Classic (6th Generation)');
  });

  it('matches an iPod Classic 6G from the `apple_vendor_id` literal sentinel', () => {
    const result = classifyAsIpod({ vendorId: 'apple_vendor_id', productId: '1261' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(true);
    expect(result!.model?.displayName).toBe('iPod Classic (6th Generation)');
  });

  it('matches an iPod Classic 6G from prefixed and suffixed `0x05ac (Apple Inc.)` form', () => {
    const result = classifyAsIpod({
      vendorId: '0x05ac (Apple Inc.)',
      productId: '0x1261 (Apple Inc.)',
    });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(true);
    expect(result!.model?.displayName).toBe('iPod Classic (6th Generation)');
  });
});

// ── Apple-vendor unsupported PIDs ───────────────────────────────────────────

describe('classifyAsIpod — unsupported iPod-family devices', () => {
  it('classifies iPod shuffle 3G as unsupported with reason (0x05ac:0x1302)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '1302' });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('ipod');
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline).toContain('unverified on hardware');
  });

  it('classifies iPod nano 6G as unsupported (0x05ac:0x120d)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '120d' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline).toContain('iTunesDB format');
  });

  it('classifies iPod nano 7G as unsupported (0x05ac:0x1267)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '1267' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline).toMatch(/nano 7th gen/i);
  });

  it('classifies iPod touch 5G as unsupported via known table (0x05ac:0x12aa)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '12aa' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline).toContain('proprietary sync protocol');
  });

  it('classifies iPhone 5/5c/5s/6/SE/7/8/X/XR as unsupported (0x05ac:0x12a8)', () => {
    const result = classifyAsIpod({ vendorId: '05ac', productId: '12a8' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline).toContain('proprietary sync protocol');
  });

  it('classifies an unknown PID in the iOS range as unsupported (0x05ac:0x12ad)', () => {
    // Not in IPOD_USB_IDS, not in UNSUPPORTED_IPOD_PRODUCT_IDS, but in the iOS PID range
    // — should fail closed via the iOS-range fallback.
    const result = classifyAsIpod({ vendorId: '05ac', productId: '12ad' });
    expect(result).not.toBeNull();
    expect(result!.supported).toBe(false);
    expect(result!.unsupportedReason?.headline?.toLowerCase()).toContain('ios device');
  });
});

// ── Non-iPod Apple-vendor PIDs ──────────────────────────────────────────────

describe('classifyAsIpod — Apple-vendor non-iPod devices', () => {
  it('returns null for an Apple keyboard (0x05ac:0x0260)', () => {
    expect(classifyAsIpod({ vendorId: '05ac', productId: '0260' })).toBeNull();
  });

  it('returns null for AirPods (0x05ac:0x2002)', () => {
    expect(classifyAsIpod({ vendorId: '05ac', productId: '2002' })).toBeNull();
  });

  it('returns null for HomePod (0x05ac:0x12b0 — outside iOS range)', () => {
    expect(classifyAsIpod({ vendorId: '05ac', productId: '12b0' })).toBeNull();
  });
});

// ── Non-Apple vendors ───────────────────────────────────────────────────────

describe('classifyAsIpod — non-Apple vendors', () => {
  it('returns null for Logitech mouse (0x046d:0x0893)', () => {
    expect(classifyAsIpod({ vendorId: '046d', productId: '0893' })).toBeNull();
  });

  it('returns null for CalDigit Thunderbolt dock (0x2188:*)', () => {
    expect(classifyAsIpod({ vendorId: '2188', productId: '0fa0' })).toBeNull();
  });

  it('returns null for VIA Labs USB hub (0x2109:*)', () => {
    expect(classifyAsIpod({ vendorId: '2109', productId: '0817' })).toBeNull();
  });

  it('returns null for Realtek Ethernet adapter (0x0bda:0x8153)', () => {
    expect(classifyAsIpod({ vendorId: '0bda', productId: '8153' })).toBeNull();
  });

  it('returns null for Kingston USB drive (0x0951:0x16a4)', () => {
    expect(classifyAsIpod({ vendorId: '0951', productId: '16a4' })).toBeNull();
  });

  it('returns null for Pioneer/Echo Mini (0x071b:0x3203 — claimed by mass-storage classifier)', () => {
    // Even though this is a music player, it is NOT an iPod; the iPod classifier
    // must return null and let the mass-storage classifier handle it.
    expect(classifyAsIpod({ vendorId: '071b', productId: '3203' })).toBeNull();
  });
});
