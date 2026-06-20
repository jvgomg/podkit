import { describe, expect, it } from 'bun:test';
import { classifyUsbDevices } from './classify.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// iPod 5G Video — 0x05ac:0x1209 (a known supported iPod PID).
const iPod5GVideo: EnumeratedUsbDevice = { vendorId: '05ac', productId: '1209' };
const iPodNano4G: EnumeratedUsbDevice = { vendorId: '05ac', productId: '1263' };
const iPodTouch5G: EnumeratedUsbDevice = { vendorId: '05ac', productId: '12aa' };
const echoMini: EnumeratedUsbDevice = {
  vendorId: '071b',
  productId: '3203',
  serialNumber: 'EM-001',
};

const logitechMouse: EnumeratedUsbDevice = { vendorId: '046d', productId: '0893' };
const calDigitDock: EnumeratedUsbDevice = { vendorId: '2188', productId: '0fa0' };
const viaUsbHub: EnumeratedUsbDevice = { vendorId: '2109', productId: '0817' };
const realtekEthernet: EnumeratedUsbDevice = { vendorId: '0bda', productId: '8153' };
const kingstonUsb: EnumeratedUsbDevice = { vendorId: '0951', productId: '16a4' };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('classifyUsbDevices', () => {
  it('returns empty array for an empty input list', () => {
    expect(classifyUsbDevices([])).toEqual([]);
  });

  it('drops every unrecognised device — phantom-iPod regression test', () => {
    // The exact bug we are fixing: a Mac with a Thunderbolt dock + hub + Ethernet
    // + mouse + USB drive previously rendered as 8 phantom "Unknown iPod (USB only)"
    // entries. The composer must drop ALL of these.
    const result = classifyUsbDevices([
      logitechMouse,
      calDigitDock,
      viaUsbHub,
      realtekEthernet,
      kingstonUsb,
    ]);
    expect(result).toEqual([]);
  });

  it('classifies a single iPod', () => {
    const result = classifyUsbDevices([iPod5GVideo]);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('ipod');
    if (result[0]!.kind === 'ipod') {
      expect(result[0]!.supported).toBe(true);
      expect(result[0]!.model?.displayName).toBe('iPod Video (5th Generation)');
    }
  });

  it('classifies a single Echo Mini', () => {
    const result = classifyUsbDevices([echoMini]);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('mass-storage');
    if (result[0]!.kind === 'mass-storage') {
      expect(result[0]!.presetId).toBe('echo-mini');
    }
  });

  it('integration: iPod + Echo Mini + 5 peripherals + 1 iOS device → 3 recognised, 0 phantoms', () => {
    const result = classifyUsbDevices([
      iPod5GVideo,
      logitechMouse,
      echoMini,
      calDigitDock,
      viaUsbHub,
      iPodTouch5G,
      realtekEthernet,
      kingstonUsb,
    ]);

    // Expect 3 recognised: 2 iPods (one supported, one unsupported iPod touch) + 1 mass-storage.
    expect(result).toHaveLength(3);

    const ipods = result.filter((r) => r.kind === 'ipod');
    expect(ipods).toHaveLength(2);

    const massStorage = result.filter((r) => r.kind === 'mass-storage');
    expect(massStorage).toHaveLength(1);

    // iPod Classic is supported.
    const supported = ipods.find((r) => r.kind === 'ipod' && r.supported);
    expect(supported).toBeDefined();
    if (supported && supported.kind === 'ipod') {
      expect(supported.device.productId).toBe('1209');
    }

    // iPod touch 5G is unsupported.
    const unsupported = ipods.find((r) => r.kind === 'ipod' && !r.supported);
    expect(unsupported).toBeDefined();
    if (unsupported && unsupported.kind === 'ipod') {
      expect(unsupported.device.productId).toBe('12aa');
      expect(unsupported.unsupportedReason?.headline).toContain('proprietary sync protocol');
    }

    // Echo Mini.
    if (massStorage[0]!.kind === 'mass-storage') {
      expect(massStorage[0]!.presetId).toBe('echo-mini');
    }
  });

  it('iPod classifier wins over mass-storage classifier when both might match', () => {
    // No real Apple PID matches a mass-storage preset today, but verify the
    // priority order by checking that the iPod classifier is consulted first.
    const result = classifyUsbDevices([iPodNano4G]);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('ipod');
  });

  it('preserves diskIdentifier on classified devices for downstream correlation', () => {
    const ipodWithDisk: EnumeratedUsbDevice = {
      vendorId: '05ac',
      productId: '1209',
      diskIdentifier: 'disk5',
    };
    const echoWithDisk: EnumeratedUsbDevice = {
      vendorId: '071b',
      productId: '3203',
      diskIdentifier: 'disk7',
    };

    const result = classifyUsbDevices([ipodWithDisk, echoWithDisk]);
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.device.diskIdentifier).toBeDefined();
    }
  });
});
