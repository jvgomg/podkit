import { describe, expect, it } from 'bun:test';
import {
  parseSystemProfilerUsbData,
  parseSysfsUsbDevices,
  discoverUsbIpods,
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
