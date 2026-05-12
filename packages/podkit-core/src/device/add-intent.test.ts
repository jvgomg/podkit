import { describe, it, expect } from 'bun:test';
import type {
  DeviceProvider,
  DiscoveredContext,
  IpodIdentity,
  MassStorageIdentity,
} from '@podkit/device-types';
import { suggestAddIntents } from './add-intent.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';

const ECHO_MINI_DEVICE: EnumeratedUsbDevice = {
  vendorId: '071b',
  productId: '3203',
  bus: 1,
  devnum: 2,
  diskIdentifier: 'disk5',
};

const APPLE_IPOD_DEVICE: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1260',
  bus: 1,
  devnum: 3,
};

function makeMassStorageProvider(
  describeIntent: DeviceProvider<MassStorageIdentity>['describeAddIntent']
): DeviceProvider<MassStorageIdentity> {
  return {
    id: 'mass-storage',
    detect: async (fp) =>
      fp.vendorId === '071b'
        ? {
            kind: 'mass-storage',
            presetId: 'echo-mini',
            vendorId: fp.vendorId,
            productId: fp.productId,
          }
        : null,
    ...(describeIntent ? { describeAddIntent: describeIntent } : {}),
  };
}

function makeIpodProvider(
  describeIntent?: DeviceProvider<IpodIdentity>['describeAddIntent']
): DeviceProvider<IpodIdentity> {
  return {
    id: 'ipod',
    detect: async (fp) =>
      fp.vendorId === '05ac'
        ? { kind: 'ipod', firewireGuid: '', serialNumber: fp.serialNumber ?? '', familyId: null }
        : null,
    ...(describeIntent ? { describeAddIntent: describeIntent } : {}),
  };
}

describe('suggestAddIntents', () => {
  it('returns intents from providers that implement describeAddIntent', async () => {
    const msProvider = makeMassStorageProvider((identity, discovered) => ({
      providerId: 'mass-storage',
      kind: identity.presetId ?? 'unknown',
      addArgs: ['--type', identity.presetId ?? '', '--path', '<mount-point>'],
      ...(discovered.diskIdentifier ? { notes: [`(disk: ${discovered.diskIdentifier})`] } : {}),
    }));

    const intents = await suggestAddIntents({
      providers: [msProvider],
      walk: async () => [ECHO_MINI_DEVICE],
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      providerId: 'mass-storage',
      kind: 'echo-mini',
      addArgs: ['--type', 'echo-mini', '--path', '<mount-point>'],
      notes: ['(disk: disk5)'],
    });
  });

  it('skips providers without describeAddIntent', async () => {
    const ipod = makeIpodProvider(); // no describeAddIntent
    const intents = await suggestAddIntents({
      providers: [ipod],
      walk: async () => [APPLE_IPOD_DEVICE],
    });
    expect(intents).toEqual([]);
  });

  it('skips devices no provider recognised', async () => {
    const msProvider = makeMassStorageProvider(() => ({
      providerId: 'mass-storage',
      kind: 'echo-mini',
      addArgs: ['--type', 'echo-mini', '--path', '<mount-point>'],
    }));
    const unknownDevice: EnumeratedUsbDevice = {
      vendorId: 'dead',
      productId: 'beef',
      bus: 1,
      devnum: 4,
    };
    const intents = await suggestAddIntents({
      providers: [msProvider],
      walk: async () => [unknownDevice],
    });
    expect(intents).toEqual([]);
  });

  it('skips providers that return null from describeAddIntent', async () => {
    const msProvider = makeMassStorageProvider(() => null);
    const intents = await suggestAddIntents({
      providers: [msProvider],
      walk: async () => [ECHO_MINI_DEVICE],
    });
    expect(intents).toEqual([]);
  });

  it('omits diskIdentifier from DiscoveredContext when the device has none', async () => {
    let captured: DiscoveredContext | undefined;
    const msProvider: DeviceProvider<MassStorageIdentity> = {
      id: 'mass-storage',
      detect: async () => ({
        kind: 'mass-storage',
        presetId: 'generic',
        vendorId: '071b',
        productId: '0000',
      }),
      describeAddIntent: (_, discovered) => {
        captured = discovered;
        return {
          providerId: 'mass-storage',
          kind: 'generic',
          addArgs: [],
        };
      },
    };
    await suggestAddIntents({
      providers: [msProvider],
      walk: async () => [{ vendorId: '071b', productId: '0000', bus: 1, devnum: 5 }],
    });
    expect(captured).toEqual({});
  });

  it('preserves walk order across multiple devices', async () => {
    const observedDiskIds: (string | undefined)[] = [];
    const msProvider = makeMassStorageProvider((identity, discovered) => {
      observedDiskIds.push(discovered.diskIdentifier);
      return {
        providerId: 'mass-storage',
        kind: identity.presetId ?? 'unknown',
        addArgs: ['--type', identity.presetId ?? ''],
      };
    });

    const second: EnumeratedUsbDevice = { ...ECHO_MINI_DEVICE, devnum: 7, diskIdentifier: 'disk6' };
    const intents = await suggestAddIntents({
      providers: [msProvider],
      walk: async () => [ECHO_MINI_DEVICE, second],
    });
    expect(intents).toHaveLength(2);
    // describeAddIntent was invoked for ECHO_MINI_DEVICE first, second second
    expect(observedDiskIds).toEqual(['disk5', 'disk6']);
  });
});
