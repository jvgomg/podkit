import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseSystemProfilerUsbData,
  parseSysfsUsbDevices,
  parseLocationId,
  discoverUsbIpods,
  resolveUsbDeviceFromPath,
  findBlockDeviceForMount,
  findUsbAncestor,
} from './usb-discovery.js';
import { createUsbOnlyReadinessResult } from './readiness.js';

// ── macOS fixtures ───────────────────────────────────────────────────────────

describe('parseSystemProfilerUsbData', () => {
  it('finds a single iPod Classic', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      vendorId: '0x05ac',
      productId: '0x1209',
      modelName: 'iPod Classic 6th generation',
      supported: true,
    });
  });

  it('returns only iPod when iPod and iPhone are both connected', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
            },
            {
              _name: 'iPhone',
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x12a0',
              // This is an iPod Touch 5th gen product ID, but let's also
              // test with a non-iPod product ID
            },
            {
              _name: 'AirPods',
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x2002', // Not in iPod table
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    // iPod Classic + iPod Touch 5th gen (unsupported)
    expect(result).toHaveLength(2);
    expect(result[0]!.productId).toBe('0x1209');
    expect(result[0]!.supported).toBe(true);
    expect(result[1]!.productId).toBe('0x12a0');
    expect(result[1]!.supported).toBe(false);
  });

  it('finds iPod connected through a USB hub (nested _items)', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.1 Bus',
          _items: [
            {
              _name: 'USB Hub',
              vendor_id: '0x1234',
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
    expect(result).toHaveLength(1);
    expect(result[0]!.productId).toBe('0x120a');
    expect(result[0]!.modelName).toBe('iPod Classic 7th generation');
  });

  it('extracts disk identifier from Media subtree', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1209',
              Media: [
                {
                  bsd_name: 'disk5',
                  volumes: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.diskIdentifier).toBe('disk5');
  });

  it('returns empty array when no Apple devices are connected', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'Generic USB Drive',
              vendor_id: '0x1234',
              product_id: '0x5678',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for invalid/null data', () => {
    expect(parseSystemProfilerUsbData(null)).toHaveLength(0);
    expect(parseSystemProfilerUsbData(undefined)).toHaveLength(0);
    expect(parseSystemProfilerUsbData({})).toHaveLength(0);
    expect(parseSystemProfilerUsbData({ SPUSBDataType: 'not-array' })).toHaveLength(0);
  });

  it('marks unsupported iPod Shuffle 3rd gen with reason', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 2.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1302',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.supported).toBe(false);
    expect(result[0]!.notSupportedReason).toContain('iTunes authentication');
    expect(result[0]!.modelName).toBe('iPod shuffle 3rd generation');
  });

  it('marks unsupported iPod Shuffle 4th gen with reason', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 2.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1303',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.supported).toBe(false);
    expect(result[0]!.notSupportedReason).toContain('iTunes authentication');
  });

  it('marks unsupported iPod Nano 6th gen with reason', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 2.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x120d',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.supported).toBe(false);
    expect(result[0]!.notSupportedReason).toContain('database format');
  });

  it('marks iPod Touch as unsupported', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 2.0 Bus',
          _items: [
            {
              _name: 'iPod touch',
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x12a8',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.supported).toBe(false);
    expect(result[0]!.notSupportedReason).toContain('proprietary sync protocol');
  });

  it('handles Apple Silicon topology with multiple bus entries', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.1 Bus',
          _items: [],
        },
        {
          _name: 'USB 3.1 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: 'apple_vendor_id',
              product_id: '0x1207',
            },
          ],
        },
        {
          _name: 'USB 2.0 Bus',
          _items: [
            {
              _name: 'Keyboard',
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x0260', // Not an iPod
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.productId).toBe('0x1207');
    expect(result[0]!.modelName).toBe('iPod 5th generation (Video)');
  });

  it('extracts serial number, bus number, and device address', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
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
    expect(result[0]!.busNumber).toBe(3);
    expect(result[0]!.deviceAddress).toBe(14);
    expect(result[0]!.diskIdentifier).toBe('disk5s2');
  });

  it('omits serial/bus/address fields when not present in system_profiler data', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
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
    expect(result[0]!.busNumber).toBeUndefined();
    expect(result[0]!.deviceAddress).toBeUndefined();
  });

  it('handles vendor_id in "0x05ac (Apple Inc.)" format', () => {
    const data = {
      SPUSBDataType: [
        {
          _name: 'USB 3.0 Bus',
          _items: [
            {
              _name: 'iPod',
              vendor_id: '0x05ac (Apple Inc.)',
              product_id: '0x1209',
            },
          ],
        },
      ],
    };

    const result = parseSystemProfilerUsbData(data);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendorId).toBe('0x05ac');
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

  it('returns empty for undefined input', () => {
    expect(parseLocationId(undefined)).toEqual({});
  });

  it('returns empty for empty string', () => {
    expect(parseLocationId('')).toEqual({});
  });

  it('returns empty for malformed input', () => {
    expect(parseLocationId('not-a-location-id')).toEqual({});
  });

  it('handles no spaces around slash', () => {
    expect(parseLocationId('0x02100000/7')).toEqual({ busNumber: 2, deviceAddress: 7 });
  });
});

// ── Linux fixtures ───────────────────────────────────────────────────────────

describe('parseSysfsUsbDevices', () => {
  it('finds a single iPod', () => {
    const devices = [{ idVendor: '05ac', idProduct: '1209' }];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      vendorId: '0x05ac',
      productId: '0x1209',
      modelName: 'iPod Classic 6th generation',
      supported: true,
    });
  });

  it('filters non-Apple devices', () => {
    const devices = [
      { idVendor: '1234', idProduct: '5678' },
      { idVendor: '05ac', idProduct: '120a' },
      { idVendor: 'abcd', idProduct: 'ef01' },
    ];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(1);
    expect(result[0]!.productId).toBe('0x120a');
  });

  it('ignores Apple devices that are not iPods', () => {
    const devices = [
      { idVendor: '05ac', idProduct: '0260' }, // Apple keyboard
      { idVendor: '05ac', idProduct: '1209' }, // iPod Classic
    ];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(1);
    expect(result[0]!.productId).toBe('0x1209');
  });

  it('returns empty array for empty input', () => {
    expect(parseSysfsUsbDevices([])).toHaveLength(0);
  });

  it('marks unsupported iPods', () => {
    const devices = [{ idVendor: '05ac', idProduct: '1302' }];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(1);
    expect(result[0]!.supported).toBe(false);
    expect(result[0]!.notSupportedReason).toContain('iTunes authentication');
  });

  it('does not include diskIdentifier for Linux devices', () => {
    const devices = [{ idVendor: '05ac', idProduct: '1209' }];

    const result = parseSysfsUsbDevices(devices);
    expect(result[0]!.diskIdentifier).toBeUndefined();
  });

  it('extracts busnum, devnum, and serial from sysfs', () => {
    const devices = [
      {
        idVendor: '05ac',
        idProduct: '1209',
        busnum: '3',
        devnum: '14',
        serial: '000A27001BC8EED6',
      },
    ];

    const result = parseSysfsUsbDevices(devices);
    expect(result).toHaveLength(1);
    expect(result[0]!.busNumber).toBe(3);
    expect(result[0]!.deviceAddress).toBe(14);
    expect(result[0]!.serialNumber).toBe('000A27001BC8EED6');
  });

  it('omits bus/address/serial when not present in sysfs', () => {
    const devices = [{ idVendor: '05ac', idProduct: '1209' }];

    const result = parseSysfsUsbDevices(devices);
    expect(result[0]!.busNumber).toBeUndefined();
    expect(result[0]!.deviceAddress).toBeUndefined();
    expect(result[0]!.serialNumber).toBeUndefined();
  });
});

// ── discoverUsbIpods ─────────────────────────────────────────────────────────

describe('discoverUsbIpods', () => {
  it('returns empty array for unsupported platform', async () => {
    const result = await discoverUsbIpods({ platform: 'win32' });
    expect(result).toEqual([]);
  });

  it('returns empty array for unknown platform', async () => {
    const result = await discoverUsbIpods({ platform: 'freebsd' });
    expect(result).toEqual([]);
  });
});

// ── resolveUsbDeviceFromPath ─────────────────────────────────────────────────

describe('resolveUsbDeviceFromPath', () => {
  it('returns null for unsupported platform', async () => {
    const result = await resolveUsbDeviceFromPath('/mnt/ipod', { platform: 'win32' });
    expect(result).toBeNull();
  });

  it('returns null for unknown platform', async () => {
    const result = await resolveUsbDeviceFromPath('/mnt/ipod', { platform: 'freebsd' });
    expect(result).toBeNull();
  });
});

// ── findBlockDeviceForMount ──────────────────────────────────────────────────

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

// ── findUsbAncestor ─────────────────────────────────────────────────────────

describe('findUsbAncestor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-ancestor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds USB ancestor with busnum and devnum', () => {
    // Simulate sysfs: /sys/devices/pci.../usb1/1-1/1-1:1.0/host0/target0/0:0:0:0/block/sda
    // The USB device is at 1-1 level where busnum + devnum live
    const usbDevice = path.join(tmpDir, 'usb1', '1-1');
    const blockDevice = path.join(usbDevice, '1-1:1.0', 'host0', 'target0', '0:0:0:0');

    fs.mkdirSync(blockDevice, { recursive: true });
    fs.writeFileSync(path.join(usbDevice, 'busnum'), '1\n');
    fs.writeFileSync(path.join(usbDevice, 'devnum'), '14\n');

    // The "sysBlockDevicePath" is what /sys/block/sda/device resolves to
    const result = findUsbAncestor(blockDevice, {
      realpathSync: (p: string) => p, // already resolved in test
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
    // Two levels with busnum/devnum — should find the deepest (nearest to device)
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

// ── createUsbOnlyReadinessResult ─────────────────────────────────────────────

describe('createUsbOnlyReadinessResult', () => {
  it('creates readiness result with USB pass and partition fail', () => {
    const result = createUsbOnlyReadinessResult({
      vendorId: '0x05ac',
      productId: '0x1209',
      modelName: 'iPod Classic 6th generation',
      supported: true,
    });

    expect(result.level).toBe('needs-partition');
    expect(result.stages).toHaveLength(6);

    // USB should pass
    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb!.status).toBe('pass');
    expect(usb!.summary).toContain('iPod Classic 6th generation');
    expect(usb!.summary).toContain('0x05ac');

    // Partition should fail
    const partition = result.stages.find((s) => s.stage === 'partition');
    expect(partition!.status).toBe('fail');
    expect(partition!.summary).toBe('No disk representation found');

    // Remaining stages should be skipped
    for (const stage of ['filesystem', 'mount', 'sysinfo', 'database'] as const) {
      const s = result.stages.find((r) => r.stage === stage);
      expect(s!.status).toBe('skip');
    }
  });

  it('handles device without model name', () => {
    const result = createUsbOnlyReadinessResult({
      vendorId: '0x05ac',
      productId: '0x9999',
      supported: true,
    });

    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb!.summary).toContain('Unknown iPod');
  });

  it('has no summary (not ready)', () => {
    const result = createUsbOnlyReadinessResult({
      vendorId: '0x05ac',
      productId: '0x1209',
      modelName: 'iPod Classic 6th generation',
      supported: true,
    });

    expect(result.summary).toBeUndefined();
  });
});
