/**
 * Unit tests for the {@link DiscoveredDevice} union — covers the new
 * `reconcileDiscoveredDevices` primitive, the `displayFor` sidecar, and an
 * integration-shaped exercise of `discoverConnectedDevices` with fakes.
 *
 * The iPod-arm coverage here regression-pins the same behaviour the
 * legacy `reconcile.test.ts` pins for {@link reconcileIpodDiscovery}; once
 * T6 deletes that file these tests are the canonical regression set.
 */

import { describe, expect, it } from 'bun:test';
import { classifyAsIpod, type IpodClassification } from '@podkit/devices-ipod';
import {
  BUILT_IN_PRESETS,
  type MassStorageClassification,
  type UnsupportedDeviceClassification,
} from '@podkit/devices-mass-storage';
import type { ClassifiedUsbDevice } from './classify.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import type { DeviceManager, PlatformDeviceInfo } from './types.js';
import {
  discoverConnectedDevices,
  displayFor,
  reconcileDiscoveredDevices,
  type DiscoveredDevice,
  type DiscoveredDeviceIpod,
  type DiscoveredDeviceMassStorage,
  type DiscoveredDeviceUnsupported,
} from './discovery.js';

// ── Builders ────────────────────────────────────────────────────────────────

function block(overrides: Partial<PlatformDeviceInfo>): PlatformDeviceInfo {
  return {
    identifier: 'sdc1',
    volumeName: 'IPOD',
    volumeUuid: '0000-0000',
    storage: { sizeBytes: 8_000_000_000 },
    isMounted: true,
    mountPoint: '/media/ipod',
    ...overrides,
  } as PlatformDeviceInfo;
}

function ipodUsb(
  overrides: Partial<EnumeratedUsbDevice> = {},
  classificationOverrides: Partial<IpodClassification<EnumeratedUsbDevice>> = {}
): IpodClassification<EnumeratedUsbDevice> {
  const device: EnumeratedUsbDevice = {
    vendorId: '05ac',
    productId: '1262',
    ...overrides,
  };
  return {
    kind: 'ipod',
    device,
    supported: true,
    ...classificationOverrides,
  };
}

function massStorageUsb(
  overrides: Partial<EnumeratedUsbDevice> = {},
  classificationOverrides: Partial<MassStorageClassification<EnumeratedUsbDevice>> = {}
): MassStorageClassification<EnumeratedUsbDevice> {
  const echoMiniPreset = BUILT_IN_PRESETS['echo-mini']!;
  const device: EnumeratedUsbDevice = {
    vendorId: '2972',
    productId: '0047',
    ...overrides,
  };
  return {
    kind: 'mass-storage',
    device,
    presetId: 'echo-mini',
    preset: echoMiniPreset,
    confidence: 'exact',
    ...classificationOverrides,
  };
}

function unsupportedUsb(
  overrides: Partial<EnumeratedUsbDevice> = {},
  classificationOverrides: Partial<UnsupportedDeviceClassification<EnumeratedUsbDevice>> = {}
): UnsupportedDeviceClassification<EnumeratedUsbDevice> {
  const device: EnumeratedUsbDevice = {
    vendorId: '054c',
    productId: '0384',
    ...overrides,
  };
  return {
    kind: 'unsupported',
    device,
    family: 'Sony Walkman',
    reason:
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0384.',
    ...classificationOverrides,
  };
}

// ── Reconciler — iPod arm (regression of legacy reconcile.test.ts) ──────────

describe('reconcileDiscoveredDevices — iPod arm', () => {
  it('folds iPod records by serial-number match', () => {
    const b = block({
      identifier: 'sdc1',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: 'NANO3G-SERIAL' },
    });
    const u = ipodUsb({ serialNumber: 'NANO3G-SERIAL' });

    const result = reconcileDiscoveredDevices([b], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceIpod;
    expect(r.kind).toBe('ipod');
    expect(r.matchedBy).toBe('serial');
    expect(r.block).toBe(b);
    expect(r.usb).toBe(u);
  });

  it('folds iPod records by disk-identifier when serial is absent', () => {
    const b = block({ identifier: 'disk2s1' });
    const u = ipodUsb({ diskIdentifier: 'disk2' });

    const result = reconcileDiscoveredDevices([b], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceIpod;
    expect(r.kind).toBe('ipod');
    expect(r.matchedBy).toBe('disk-identifier');
  });

  it('emits a block-only iPod when the USB pipeline missed the device', () => {
    const b = block({ identifier: 'sdc1', volumeName: 'IPOD' });

    const result = reconcileDiscoveredDevices([b], []);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceIpod;
    expect(r.kind).toBe('ipod');
    expect(r.matchedBy).toBe('block-only');
    expect(r.block).toBe(b);
    expect(r.usb).toBeUndefined();
  });

  it('emits a usb-only iPod when the block pipeline missed the device', () => {
    const u = ipodUsb({ productId: '12aa' }, { supported: false });

    const result = reconcileDiscoveredDevices([], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceIpod;
    expect(r.kind).toBe('ipod');
    expect(r.matchedBy).toBe('usb-only');
    expect(r.usb).toBe(u);
    expect(r.block).toBeUndefined();
  });

  it('prefers serial over disk-identifier when both could pair', () => {
    const b = block({
      identifier: 'sdc1',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: 'SERIAL-A' },
    });
    const usbByDisk = ipodUsb({ diskIdentifier: 'sdc' });
    const usbBySerial = ipodUsb({ serialNumber: 'SERIAL-A' });

    const result = reconcileDiscoveredDevices([b], [usbByDisk, usbBySerial]);

    expect(result).toHaveLength(2);
    const matched = result.find((r) => r.kind === 'ipod' && r.matchedBy === 'serial');
    expect(matched).toBeDefined();
    expect((matched as DiscoveredDeviceIpod).usb).toBe(usbBySerial);
    const orphan = result.find((r) => r.kind === 'ipod' && r.matchedBy === 'usb-only');
    expect(orphan).toBeDefined();
    expect((orphan as DiscoveredDeviceIpod).usb).toBe(usbByDisk);
  });

  it('strips partition suffix on BOTH sides for macOS bsd_name disk-identifier match', () => {
    // Regression: an early implementation stripped only the block side.
    // If `diskIdentifier` itself carries a partition suffix (e.g. `disk5s2`
    // reported by system_profiler), the match must still fold to one entry.
    const b = block({ identifier: 'disk5s2' });
    const u = ipodUsb({ diskIdentifier: 'disk5s2' });

    const result = reconcileDiscoveredDevices([b], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceIpod;
    expect(r.kind).toBe('ipod');
    expect(r.matchedBy).toBe('disk-identifier');
    expect(r.block).toBe(b);
    expect(r.usb).toBe(u);
  });

  it('treats empty serials as no-match', () => {
    const b = block({
      identifier: 'sdc1',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: '' },
    });
    const u = ipodUsb({ serialNumber: '' });

    const result = reconcileDiscoveredDevices([b], [u]);

    // No usable serial, no disk identifier on USB → two records.
    expect(result).toHaveLength(2);
    expect(result[0]!.matchedBy).toBe('block-only');
    expect(result[1]!.matchedBy).toBe('usb-only');
  });
});

// ── Reconciler — mass-storage arm (new) ─────────────────────────────────────

describe('reconcileDiscoveredDevices — mass-storage arm', () => {
  it('folds mass-storage records by disk-identifier', () => {
    const b = block({ identifier: 'sdd1', volumeName: 'MUSIC' });
    const u = massStorageUsb({ diskIdentifier: 'sdd' });

    const result = reconcileDiscoveredDevices([b], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceMassStorage;
    expect(r.kind).toBe('mass-storage');
    expect(r.matchedBy).toBe('disk-identifier');
    expect(r.block).toBe(b);
    expect(r.usb).toBe(u);
  });

  it('emits a block-only mass-storage when the block side is non-iPod-shaped', () => {
    // A volume that isn't `IPOD`-labelled and has no `mediaType: iPod` falls
    // through to mass-storage when no USB classification claims it.
    const b = block({ identifier: 'sde1', volumeName: 'MUSIC', mediaType: undefined });

    const result = reconcileDiscoveredDevices([b], []);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceMassStorage;
    expect(r.kind).toBe('mass-storage');
    expect(r.matchedBy).toBe('block-only');
    expect(r.block).toBe(b);
    expect(r.usb).toBeUndefined();
  });

  it('emits a usb-only mass-storage for Echo Mini powered on with no mounted volume', () => {
    // Echo Mini plugged in but not in mass-storage mode: USB-classified, no
    // block-device entry. Renderer surfaces this as "no volume mounted".
    const u = massStorageUsb();

    const result = reconcileDiscoveredDevices([], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceMassStorage;
    expect(r.kind).toBe('mass-storage');
    expect(r.matchedBy).toBe('usb-only');
    expect(r.usb).toBe(u);
    expect(r.block).toBeUndefined();
  });
});

// ── Reconciler — unsupported arm ────────────────────────────────────────────

describe('reconcileDiscoveredDevices — unsupported arm', () => {
  it('always emits unsupported as usb-only', () => {
    const u = unsupportedUsb();

    const result = reconcileDiscoveredDevices([], [u]);

    expect(result).toHaveLength(1);
    const r = result[0] as DiscoveredDeviceUnsupported;
    expect(r.kind).toBe('unsupported');
    expect(r.matchedBy).toBe('usb-only');
    expect(r.usb).toBe(u);
  });

  it('never folds unsupported against a block device, even when disk-identifiers would coincide', () => {
    // Defensive: if the Sony Walkman happened to report the same disk-identifier
    // as an attached `sde1` partition, the reconciler must still emit two records.
    const b = block({ identifier: 'sde1' });
    const u = unsupportedUsb({ diskIdentifier: 'sde' });

    const result = reconcileDiscoveredDevices([b], [u]);

    expect(result).toHaveLength(2);
    // Block falls through to its kind heuristic (mass-storage here — volume `IPOD`
    // would trigger iPod, but we left it as the default `IPOD` volume label so
    // we use a more specific volumeName to disambiguate the test).
    const blockRecord = result.find((r) => r.matchedBy === 'block-only');
    expect(blockRecord).toBeDefined();
    expect(blockRecord!.kind).toBe('ipod'); // because volumeName === 'IPOD' is iPod-shaped
    const usbRecord = result.find((r) => r.kind === 'unsupported');
    expect(usbRecord).toBeDefined();
    expect(usbRecord!.matchedBy).toBe('usb-only');
  });
});

// ── Reconciler — mixed + stability ──────────────────────────────────────────

describe('reconcileDiscoveredDevices — mixed multi-device + stability', () => {
  it('handles iPod + mass-storage + unsupported simultaneously', () => {
    const ipodBlock = block({
      identifier: 'sdc1',
      volumeName: 'IPOD',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: 'SERIAL-NANO' },
    });
    const ipodUsbEntry = ipodUsb({ serialNumber: 'SERIAL-NANO' });
    const massStorageBlock = block({ identifier: 'sdd1', volumeName: 'ECHO' });
    const massStorageUsbEntry = massStorageUsb({ diskIdentifier: 'sdd' });
    const sonyUsbEntry = unsupportedUsb();

    const result = reconcileDiscoveredDevices(
      [ipodBlock, massStorageBlock],
      [ipodUsbEntry, massStorageUsbEntry, sonyUsbEntry]
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.kind).toBe('ipod');
    expect(result[0]!.matchedBy).toBe('serial');
    expect(result[1]!.kind).toBe('mass-storage');
    expect(result[1]!.matchedBy).toBe('disk-identifier');
    expect(result[2]!.kind).toBe('unsupported');
    expect(result[2]!.matchedBy).toBe('usb-only');
  });

  it('is replug-stable: same inputs → equal references in same order', () => {
    const b = block({
      identifier: 'sdc1',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: 'SERIAL-A' },
    });
    const u = ipodUsb({ serialNumber: 'SERIAL-A' });

    const first = reconcileDiscoveredDevices([b], [u]);
    const second = reconcileDiscoveredDevices([b], [u]);

    expect(second).toHaveLength(first.length);
    for (let i = 0; i < first.length; i++) {
      const a = first[i]!;
      const c = second[i]!;
      expect(c.kind).toBe(a.kind);
      expect(c.matchedBy).toBe(a.matchedBy);
      expect(c.block).toBe(a.block);
      // usb references must be equal — the primitive does no allocation.
      if ('usb' in a) expect((c as typeof a).usb).toBe(a.usb);
    }
  });

  it('handles empty inputs', () => {
    expect(reconcileDiscoveredDevices([], [])).toEqual([]);
  });
});

// ── displayFor ──────────────────────────────────────────────────────────────

describe('displayFor', () => {
  it('renders an Echo Mini mass-storage with preset metadata', () => {
    const u = massStorageUsb();
    const d: DiscoveredDeviceMassStorage = {
      kind: 'mass-storage',
      usb: u,
      matchedBy: 'usb-only',
    };

    const display = displayFor(d);

    expect(display.short).toBe('Echo Mini');
    expect(display.rich).toBe('FiiO Snowsky Echo Mini (echo-mini)');
    expect(display.source).toBe('preset');
  });

  it('renders an iPod nano 3G with generation cascade', () => {
    // Use the real `classifyAsIpod` to get a `model`-populated classification —
    // discovery's display layer reads `usb.model.displayName`, which is only
    // set by the classifier, not by the bare test builder.
    const u = classifyAsIpod<EnumeratedUsbDevice>({ vendorId: '05ac', productId: '1262' });
    expect(u).not.toBeNull();
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      usb: u!,
      matchedBy: 'usb-only',
    };

    const display = displayFor(d);

    expect(display.short).toBe('iPod nano 3G');
    // USB-source displayName from IPOD_USB_IDS uses the lowercase
    // `Nth generation` form rather than the parenthetical `(Nth Generation)`.
    expect(display.rich).toContain('iPod nano');
    expect(display.rich).toMatch(/3rd generation/i);
    expect(display.source).toBe('ipod-generation');
  });

  it.each([['iPod Photo'], ['iPod']])(
    'passes unrecognised displayName %p through the shortener unchanged',
    (displayName) => {
      const u = {
        kind: 'ipod' as const,
        device: { vendorId: '05ac', productId: '0000' } as EnumeratedUsbDevice,
        identity: {},
        model: { displayName },
      };
      const d: DiscoveredDeviceIpod = {
        kind: 'ipod',
        // biome-ignore lint/suspicious/noExplicitAny: synthetic classification shape — only `model.displayName` is read.
        usb: u as any,
        matchedBy: 'usb-only',
      };

      expect(displayFor(d).short).toBe(displayName);
    }
  );

  it('shortens the 5.5G iPod Video displayName via decimal-ordinal regex', () => {
    const u = {
      kind: 'ipod' as const,
      device: { vendorId: '05ac', productId: '0000' } as EnumeratedUsbDevice,
      identity: {},
      model: { displayName: 'iPod Video (5.5th Generation)' },
    };
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      // biome-ignore lint/suspicious/noExplicitAny: synthetic classification shape — only `model.displayName` is read.
      usb: u as any,
      matchedBy: 'usb-only',
    };

    expect(displayFor(d).short).toBe('iPod Video 5.5G');
  });

  it('renders an unsupported Sony Walkman with the canonical refusal reason', () => {
    const u = unsupportedUsb();
    const d: DiscoveredDeviceUnsupported = {
      kind: 'unsupported',
      usb: u,
      matchedBy: 'usb-only',
    };

    const display = displayFor(d);

    expect(display.short).toBe('Sony Walkman');
    expect(display.rich).toBe(u.reason);
    expect(display.source).toBe('unsupported-fallback');
  });

  it('renders a block-only iPod with the volume name fallback', () => {
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      block: block({ volumeName: 'TERAPOD' }),
      matchedBy: 'block-only',
    };

    const display = displayFor(d);

    expect(display.short).toBe('TERAPOD');
    expect(display.rich).toBe('TERAPOD');
    expect(display.source).toBe('usb-fingerprint');
  });

  it('renders a block-only iPod with empty volume name as just "iPod"', () => {
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      block: block({ volumeName: '' }),
      matchedBy: 'block-only',
    };

    expect(displayFor(d).short).toBe('iPod');
  });

  it('renders a block-only mass-storage with the volume name fallback', () => {
    const d: DiscoveredDeviceMassStorage = {
      kind: 'mass-storage',
      block: block({ volumeName: 'MUSIC' }),
      matchedBy: 'block-only',
    };

    const display = displayFor(d);
    expect(display.short).toBe('MUSIC');
    expect(display.source).toBe('usb-fingerprint');
  });
});

// ── discoverConnectedDevices ────────────────────────────────────────────────

describe('discoverConnectedDevices', () => {
  function fakeDeviceManager(ipods: PlatformDeviceInfo[], isSupported = true): DeviceManager {
    return {
      platform: 'test',
      isSupported,
      findIpodDevices: async () => ipods,
      // Unused by discoverConnectedDevices but required by the interface:
      eject: async () => ({ success: true, device: '' }),
      mount: async () => ({ success: true, device: '' }),
      listDevices: async () => ipods,
      findByVolumeUuid: async () => null,
      getManualInstructions: () => '',
      requiresPrivileges: () => false,
      getUuidForMountPoint: async () => null,
      assessDevice: async () => null,
    } as unknown as DeviceManager;
  }

  it('wires enumerate → classify → reconcile and returns a discriminated union', async () => {
    const ipodBlock = block({
      identifier: 'sdc1',
      usb: { vendorId: '05ac', productId: '1262', serialNumber: 'SERIAL-INT' },
    });
    const enumerated: EnumeratedUsbDevice[] = [
      { vendorId: '05ac', productId: '1262', serialNumber: 'SERIAL-INT' },
      { vendorId: '054c', productId: '0384' },
    ];
    const classified: ClassifiedUsbDevice[] = [
      ipodUsb({ serialNumber: 'SERIAL-INT' }),
      unsupportedUsb(),
    ];

    const result = await discoverConnectedDevices({
      deviceManager: fakeDeviceManager([ipodBlock]),
      enumerate: async () => enumerated,
      classify: () => classified,
    });

    expect(result).toHaveLength(2);
    const ipod = result.find((r): r is DiscoveredDeviceIpod => r.kind === 'ipod');
    expect(ipod).toBeDefined();
    expect(ipod!.matchedBy).toBe('serial');
    expect(ipod!.block).toBe(ipodBlock);
    const unsupported = result.find(
      (r): r is DiscoveredDeviceUnsupported => r.kind === 'unsupported'
    );
    expect(unsupported).toBeDefined();
    expect(unsupported!.matchedBy).toBe('usb-only');
  });

  it('returns an empty list on unsupported platforms', async () => {
    const result = await discoverConnectedDevices({
      deviceManager: fakeDeviceManager([], false),
      enumerate: async () => {
        throw new Error('should not enumerate on unsupported platforms');
      },
      classify: () => {
        throw new Error('should not classify on unsupported platforms');
      },
    });

    expect(result).toEqual([]);
  });

  it('returns the right shape even when there are no devices', async () => {
    const result = await discoverConnectedDevices({
      deviceManager: fakeDeviceManager([]),
      enumerate: async () => [],
      classify: () => [],
    });
    expect(result).toEqual([]);
  });
});

// Type-level smoke: the union must be exhaustive — each `kind` value
// narrows to exactly one arm.
describe('DiscoveredDevice — type-level narrowing', () => {
  it('narrows kind exhaustively', () => {
    const records: DiscoveredDevice[] = [
      { kind: 'ipod', matchedBy: 'usb-only', usb: ipodUsb() },
      { kind: 'mass-storage', matchedBy: 'usb-only', usb: massStorageUsb() },
      { kind: 'unsupported', matchedBy: 'usb-only', usb: unsupportedUsb() },
    ];
    const kinds = records.map((r) => {
      switch (r.kind) {
        case 'ipod':
          return 'i';
        case 'mass-storage':
          return 'm';
        case 'unsupported':
          return 'u';
      }
    });
    expect(kinds).toEqual(['i', 'm', 'u']);
  });
});
