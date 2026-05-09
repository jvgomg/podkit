import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseSystemProfilerUsbData,
  parseSysfsUsbDevices,
  parseLocationId,
  enumerateUsb,
  extractProductId,
  extractVendorId,
} from './usb-enumeration.js';

// ── parseSystemProfilerUsbData ───────────────────────────────────────────────

describe('parseSystemProfilerUsbData', () => {
  it('extracts a single Apple device with bare-hex VID/PID', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1261',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      vendorId: '05ac',
      productId: '1261',
    });
  });

  it('returns no iPod-domain fields (model/supported/notSupportedReason absent)', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1261',
            },
            {
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x12a0', // iPhone 4S — would be "unsupported" in old API
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(2);
    for (const r of result) {
      // Pure enumeration shape — no iPod-domain leakage.
      expect(r).not.toHaveProperty('model');
      expect(r).not.toHaveProperty('supported');
      expect(r).not.toHaveProperty('notSupportedReason');
      // Only USB-shape fields are present.
      const keys = Object.keys(r);
      for (const k of keys) {
        expect([
          'vendorId',
          'productId',
          'serialNumber',
          'bus',
          'devnum',
          'diskIdentifier',
        ]).toContain(k);
      }
    }
  });

  it('returns all USB devices regardless of vendor (no vendor filter)', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            { vendor_id: 'apple_vendor_id', product_id: '0x1209' }, // iPod Classic
            { vendor_id: '0x046d', product_id: '0x0893' }, // Logitech mouse
            { vendor_id: '0x2188', product_id: '0x0fa0' }, // CalDigit dock
            { vendor_id: '0x0bda', product_id: '0x8153' }, // Realtek Ethernet
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(4);
    expect(result.map((d) => d.vendorId).sort()).toEqual(['046d', '05ac', '0bda', '2188']);
  });

  it('finds devices through nested USB hubs', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.1 Bus',
          _items: [
            {
              _name: 'USB Hub',
              vendor_id: '0x2109',
              product_id: '0x5678',
              _items: [
                {
                  _name: 'iPod',
                  vendor_id: 'apple_vendor_id',
                  product_id: '0x120a',
                },
              ],
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.productId === '5678')).toBeDefined();
    expect(result.find((r) => r.productId === '120a')).toBeDefined();
  });

  it('extracts disk identifier from Media subtree', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
              Media: [{ bsd_name: 'disk5' }],
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.diskIdentifier).toBe('disk5');
  });

  it('returns empty array for invalid/null data', () => {
    expect(parseSystemProfilerUsbData(null)).toHaveLength(0);
    expect(parseSystemProfilerUsbData(undefined)).toHaveLength(0);
    expect(parseSystemProfilerUsbData({})).toHaveLength(0);
    expect(parseSystemProfilerUsbData({ SPUSBDataType: 'not-array' })).toHaveLength(0);
  });

  it('extracts serial number, bus number, and device address', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
              serial_num: '000A27001BC8EED6',
              location_id: '0x03100000 / 14',
              Media: [{ bsd_name: 'disk5s2' }],
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.serialNumber).toBe('000A27001BC8EED6');
    expect(result[0]!.bus).toBe(3);
    expect(result[0]!.devnum).toBe(14);
    expect(result[0]!.diskIdentifier).toBe('disk5s2');
  });

  it('omits serial/bus/address fields when not present in system_profiler data', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.serialNumber).toBeUndefined();
    expect(result[0]!.bus).toBeUndefined();
    expect(result[0]!.devnum).toBeUndefined();
  });

  it('handles vendor_id in "0x05ac (Apple Inc.)" format', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x1209',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result[0]!.vendorId).toBe('05ac');
  });

  it('handles Apple Silicon topology with multiple bus entries', () => {
    const data = {
      SPUSBDataType: [
        { _name: 'USB 3.1 Bus', _items: [] },
        {
          _name: 'USB 3.1 Bus',
          _items: [{ vendor_id: 'apple_vendor_id', product_id: '0x1207' }],
        },
        {
          _name: 'USB 2.0 Bus',
          _items: [{ vendor_id: '0x05ac (Apple Inc.)', product_id: '0x0260' }],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.productId).sort()).toEqual(['0260', '1207']);
  });
});

// ── extractProductId ─────────────────────────────────────────────────────────

describe('extractProductId', () => {
  it('extracts bare hex from prefixed form "0x1261"', () => {
    expect(extractProductId('0x1261')).toBe('1261');
  });

  it('extracts bare hex from prefixed-with-trailing-text form', () => {
    expect(extractProductId('0x1209 (some text)')).toBe('1209');
  });

  it('lowercases mixed-case hex', () => {
    expect(extractProductId('0x1AbC')).toBe('1abc');
  });

  it('returns undefined for undefined / empty / non-hex input', () => {
    expect(extractProductId(undefined)).toBeUndefined();
    expect(extractProductId('')).toBeUndefined();
    expect(extractProductId('not-hex')).toBeUndefined();
  });
});

// ── extractVendorId ─────────────────────────────────────────────────────────

describe('extractVendorId', () => {
  it('returns bare-hex Apple vendor ID for the "apple_vendor_id" sentinel', () => {
    expect(extractVendorId('apple_vendor_id')).toBe('05ac');
  });

  it('extracts bare hex from prefixed-with-trailing-text form', () => {
    expect(extractVendorId('0x05ac (Apple Inc.)')).toBe('05ac');
  });

  it('extracts bare hex from bare prefixed form', () => {
    expect(extractVendorId('0x05ac')).toBe('05ac');
  });

  it('returns the input lowercased when it is already bare-hex', () => {
    expect(extractVendorId('05ac')).toBe('05ac');
  });

  it('lowercases mixed-case prefixed input', () => {
    expect(extractVendorId('0x05AC')).toBe('05ac');
  });
});

// ── parseLocationId ─────────────────────────────────────────────────────────

describe('parseLocationId', () => {
  it('parses standard format "0x03100000 / 14"', () => {
    expect(parseLocationId('0x03100000 / 14')).toEqual({ busNumber: 3, deviceAddress: 14 });
  });

  it('parses bus 1 with device address 1', () => {
    expect(parseLocationId('0x01100000 / 1')).toEqual({ busNumber: 1, deviceAddress: 1 });
  });

  it('parses high bus number', () => {
    expect(parseLocationId('0xff100000 / 42')).toEqual({ busNumber: 255, deviceAddress: 42 });
  });

  it('parses hex-only format without device address', () => {
    expect(parseLocationId('0x03100000')).toEqual({ busNumber: 3 });
  });

  it('returns empty for undefined / empty / malformed input', () => {
    expect(parseLocationId(undefined)).toEqual({});
    expect(parseLocationId('')).toEqual({});
    expect(parseLocationId('not-a-location-id')).toEqual({});
  });

  it('handles no spaces around slash', () => {
    expect(parseLocationId('0x02100000/7')).toEqual({ busNumber: 2, deviceAddress: 7 });
  });
});

// ── parseSysfsUsbDevices ────────────────────────────────────────────────────

describe('parseSysfsUsbDevices', () => {
  it('returns pure enumeration shape (no iPod-domain fields)', () => {
    const result = parseSysfsUsbDevices([{ idVendor: '05ac', idProduct: '1261' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vendorId: '05ac', productId: '1261' });
    expect(result[0]).not.toHaveProperty('model');
    expect(result[0]).not.toHaveProperty('supported');
  });

  it('returns all devices regardless of vendor', () => {
    const devices = [
      { idVendor: '1234', idProduct: '5678' },
      { idVendor: '05ac', idProduct: '120a' },
      { idVendor: 'abcd', idProduct: 'ef01' },
    ];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(parseSysfsUsbDevices([])).toHaveLength(0);
  });

  it('does not include diskIdentifier (Linux sysfs does not expose it here)', () => {
    const result = parseSysfsUsbDevices([{ idVendor: '05ac', idProduct: '1209' }]);
    expect(result[0]!.diskIdentifier).toBeUndefined();
  });

  it('extracts busnum, devnum, and serial from sysfs', () => {
    const result = parseSysfsUsbDevices([
      {
        idVendor: '05ac',
        idProduct: '1209',
        busnum: '3',
        devnum: '14',
        serial: '000A27001BC8EED6',
      },
    ]);
    expect(result[0]!.bus).toBe(3);
    expect(result[0]!.devnum).toBe(14);
    expect(result[0]!.serialNumber).toBe('000A27001BC8EED6');
  });

  it('omits bus/address/serial when not present in sysfs', () => {
    const result = parseSysfsUsbDevices([{ idVendor: '05ac', idProduct: '1209' }]);
    expect(result[0]!.bus).toBeUndefined();
    expect(result[0]!.devnum).toBeUndefined();
    expect(result[0]!.serialNumber).toBeUndefined();
  });
});

// ── enumerateUsb ─────────────────────────────────────────────────────────────

describe('enumerateUsb', () => {
  it('returns empty array for unsupported platform', async () => {
    expect(await enumerateUsb({ platform: 'win32' })).toEqual([]);
  });

  it('returns empty array for unknown platform', async () => {
    expect(await enumerateUsb({ platform: 'freebsd' })).toEqual([]);
  });
});

// ── usb-path-resolution helpers (kept here as they share fixtures) ──────────

import {
  resolveUsbDeviceFromPath,
  findBlockDeviceForMount,
  findUsbAncestor,
} from './usb-path-resolution.js';

describe('resolveUsbDeviceFromPath', () => {
  it('returns null for unsupported platform', async () => {
    expect(await resolveUsbDeviceFromPath('/mnt/ipod', { platform: 'win32' })).toBeNull();
  });

  it('returns null for unknown platform', async () => {
    expect(await resolveUsbDeviceFromPath('/mnt/ipod', { platform: 'freebsd' })).toBeNull();
  });
});

describe('findBlockDeviceForMount', () => {
  const PROC_MOUNTS = [
    '/dev/sda1 /mnt/ipod ext4 rw,relatime 0 0',
    '/dev/sdb1 /mnt/usb vfat rw,relatime 0 0',
    'tmpfs /tmp tmpfs rw 0 0',
    'proc /proc proc rw 0 0',
  ].join('\n');

  it('finds block device for matching mount path', () => {
    expect(findBlockDeviceForMount('/mnt/ipod', PROC_MOUNTS)).toBe('sda1');
  });

  it('finds second device', () => {
    expect(findBlockDeviceForMount('/mnt/usb', PROC_MOUNTS)).toBe('sdb1');
  });

  it('returns null for unmatched mount path', () => {
    expect(findBlockDeviceForMount('/mnt/other', PROC_MOUNTS)).toBeNull();
  });

  it('ignores non-device mounts (tmpfs, proc)', () => {
    expect(findBlockDeviceForMount('/tmp', PROC_MOUNTS)).toBeNull();
    expect(findBlockDeviceForMount('/proc', PROC_MOUNTS)).toBeNull();
  });

  it('handles trailing slash on mount path', () => {
    expect(findBlockDeviceForMount('/mnt/ipod/', PROC_MOUNTS)).toBe('sda1');
  });

  it('returns null for empty content', () => {
    expect(findBlockDeviceForMount('/mnt/ipod', '')).toBeNull();
  });
});

describe('findUsbAncestor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-ancestor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds USB ancestor with busnum and devnum', () => {
    const usbDevice = path.join(tmpDir, 'usb1', '1-1');
    const blockDevice = path.join(usbDevice, '1-1:1.0', 'host0', 'target0', '0:0:0:0');

    fs.mkdirSync(blockDevice, { recursive: true });
    fs.writeFileSync(path.join(usbDevice, 'busnum'), '1\n');
    fs.writeFileSync(path.join(usbDevice, 'devnum'), '14\n');

    const result = findUsbAncestor(blockDevice, {
      realpathSync: (p: string) => p,
      existsSync: (p: string) => fs.existsSync(p),
    });

    expect(result).toBe(usbDevice);
  });

  it('returns null when no USB ancestor exists', () => {
    const noUsbPath = path.join(tmpDir, 'some', 'deep', 'path');
    fs.mkdirSync(noUsbPath, { recursive: true });

    const result = findUsbAncestor(noUsbPath, {
      realpathSync: (p: string) => p,
      existsSync: (p: string) => fs.existsSync(p),
    });

    expect(result).toBeNull();
  });

  it('returns null when realpath fails (broken symlink)', () => {
    const result = findUsbAncestor('/sys/block/nonexistent/device', {
      realpathSync: () => {
        throw new Error('ENOENT');
      },
      existsSync: () => false,
    });

    expect(result).toBeNull();
  });

  it('finds nearest USB ancestor (not a higher one)', () => {
    const outerUsb = path.join(tmpDir, 'usb1');
    const innerUsb = path.join(outerUsb, '1-1');
    const device = path.join(innerUsb, '1-1:1.0', 'host0');

    fs.mkdirSync(device, { recursive: true });
    fs.writeFileSync(path.join(outerUsb, 'busnum'), '1\n');
    fs.writeFileSync(path.join(outerUsb, 'devnum'), '1\n');
    fs.writeFileSync(path.join(innerUsb, 'busnum'), '1\n');
    fs.writeFileSync(path.join(innerUsb, 'devnum'), '14\n');

    const result = findUsbAncestor(device, {
      realpathSync: (p: string) => p,
      existsSync: (p: string) => fs.existsSync(p),
    });

    expect(result).toBe(innerUsb);
  });
});
