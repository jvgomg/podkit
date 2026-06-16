import { describe, it, expect } from 'bun:test';
import { suggestAddIntents } from './add-intent.js';
import { describeAddIntent } from './discovery.js';
import type {
  DiscoveredDeviceIpod,
  DiscoveredDeviceMassStorage,
  DiscoveredDeviceUnsupported,
} from './discovery.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import type { DeviceManager } from './types.js';

// =============================================================================
// describeAddIntent — per-kind dispatcher
// =============================================================================

describe('describeAddIntent', () => {
  it('iPod with unsupportedReason surfaces the headline + docs link', () => {
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      matchedBy: 'usb-only',
      usb: {
        kind: 'ipod',
        supported: false,
        unsupportedReason: {
          kind: 'ios-device',
          headline: 'iPod touch is not supported by podkit.',
          docsUrl: 'https://example.test/supported',
        },
        device: { vendorId: '05ac', productId: '12aa' },
      } as DiscoveredDeviceIpod['usb'],
    };
    expect(describeAddIntent(d)).toEqual({
      providerId: 'ipod',
      kind: 'ipod',
      addArgs: [],
      notes: ['iPod touch is not supported by podkit.', 'See: https://example.test/supported'],
    });
  });

  it('iPod with USB classification but no unsupportedReason hints "mount first"', () => {
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      matchedBy: 'usb-only',
      usb: {
        kind: 'ipod',
        supported: true,
        device: { vendorId: '05ac', productId: '1260' },
      } as DiscoveredDeviceIpod['usb'],
    };
    const intent = describeAddIntent(d);
    expect(intent).toMatchObject({
      providerId: 'ipod',
      kind: 'ipod',
      addArgs: [],
    });
    expect(intent?.notes?.[0]).toContain('mount');
  });

  it('iPod block-only (no USB classification) → null intent (use standard add flow)', () => {
    const d: DiscoveredDeviceIpod = {
      kind: 'ipod',
      matchedBy: 'block-only',
      block: {
        identifier: 'disk2s2',
        volumeName: 'IPOD',
        volumeUuid: 'AAAA-1111',
        isMounted: true,
        mountPoint: '/Volumes/IPOD',
        storage: { sizeBytes: 0 },
      },
    };
    expect(describeAddIntent(d)).toBeNull();
  });

  it('mass-storage with presetId emits a --type/--path command template', () => {
    const d: DiscoveredDeviceMassStorage = {
      kind: 'mass-storage',
      matchedBy: 'usb-only',
      usb: {
        kind: 'mass-storage',
        presetId: 'echo-mini',
        confidence: 'exact',
        preset: {} as DiscoveredDeviceMassStorage['usb'] extends { preset: infer P } ? P : never,
        device: {
          vendorId: '071b',
          productId: '3203',
          diskIdentifier: 'disk5',
        },
      } as DiscoveredDeviceMassStorage['usb'],
    };
    expect(describeAddIntent(d)).toEqual({
      providerId: 'mass-storage',
      kind: 'echo-mini',
      addArgs: ['--type', 'echo-mini', '--path', '<mount-point>'],
      notes: ['(disk: disk5 — mount it first if not already mounted)'],
    });
  });

  it('mass-storage without diskIdentifier omits the notes line', () => {
    const d: DiscoveredDeviceMassStorage = {
      kind: 'mass-storage',
      matchedBy: 'usb-only',
      usb: {
        kind: 'mass-storage',
        presetId: 'echo-mini',
        confidence: 'exact',
        preset: {} as DiscoveredDeviceMassStorage['usb'] extends { preset: infer P } ? P : never,
        device: { vendorId: '071b', productId: '3203' },
      } as DiscoveredDeviceMassStorage['usb'],
    };
    const intent = describeAddIntent(d);
    expect(intent).toEqual({
      providerId: 'mass-storage',
      kind: 'echo-mini',
      addArgs: ['--type', 'echo-mini', '--path', '<mount-point>'],
    });
    expect(intent?.notes).toBeUndefined();
  });

  it('mass-storage block-only (no USB classification) → null intent', () => {
    const d: DiscoveredDeviceMassStorage = {
      kind: 'mass-storage',
      matchedBy: 'block-only',
      block: {
        identifier: 'disk3s1',
        volumeName: 'GENERIC',
        volumeUuid: '',
        isMounted: true,
        mountPoint: '/Volumes/GENERIC',
        storage: { sizeBytes: 0 },
      },
    };
    expect(describeAddIntent(d)).toBeNull();
  });

  it('unsupported device surfaces the rejection reason in notes', () => {
    const d: DiscoveredDeviceUnsupported = {
      kind: 'unsupported',
      matchedBy: 'usb-only',
      usb: {
        kind: 'unsupported',
        reason: 'Sony Walkman is not yet supported by podkit.',
        family: 'Sony Walkman',
        device: { vendorId: '054c', productId: '0000' },
      } as DiscoveredDeviceUnsupported['usb'],
    };
    expect(describeAddIntent(d)).toEqual({
      providerId: 'unsupported',
      kind: 'unsupported',
      addArgs: [],
      notes: ['Sony Walkman is not yet supported by podkit.'],
    });
  });
});

// =============================================================================
// suggestAddIntents — composition (discoverConnectedDevices + dispatcher)
// =============================================================================

const ECHO_MINI_DEVICE: EnumeratedUsbDevice = {
  vendorId: '071b',
  productId: '3203',
  bus: 1,
  devnum: 2,
  diskIdentifier: 'disk5',
};

function emptyManager(): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    findIpodDevices: async () => [],
  } as unknown as DeviceManager;
}

describe('suggestAddIntents', () => {
  it('returns intents for every discovered device whose kind has a hint', async () => {
    const intents = await suggestAddIntents({
      deviceManager: emptyManager(),
      enumerate: async () => [ECHO_MINI_DEVICE],
    });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      providerId: 'mass-storage',
      kind: 'echo-mini',
      addArgs: ['--type', 'echo-mini', '--path', '<mount-point>'],
    });
  });

  it('skips devices the classifier dropped entirely', async () => {
    const unknown: EnumeratedUsbDevice = {
      vendorId: 'dead',
      productId: 'beef',
      bus: 1,
      devnum: 4,
    };
    const intents = await suggestAddIntents({
      deviceManager: emptyManager(),
      enumerate: async () => [unknown],
    });
    expect(intents).toEqual([]);
  });

  it('returns empty when the device manager is unsupported (Windows path)', async () => {
    const unsupportedManager = {
      platform: 'test',
      isSupported: false,
      findIpodDevices: async () => [],
    } as unknown as DeviceManager;
    const intents = await suggestAddIntents({
      deviceManager: unsupportedManager,
      enumerate: async () => [ECHO_MINI_DEVICE],
    });
    expect(intents).toEqual([]);
  });
});
