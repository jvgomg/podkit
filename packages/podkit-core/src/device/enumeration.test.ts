import { describe, expect, it } from 'bun:test';
import type {
  DeviceProvider,
  IpodIdentity,
  MassStorageIdentity,
  UsbFingerprint,
} from '@podkit/device-types';
import { enumerateConnectedDevices } from './enumeration.js';
import type { UsbDiscoveredDevice } from './usb-discovery.js';

// =============================================================================
// Test fixtures
// =============================================================================

function makeDiscovered(
  vendorId: string,
  productId: string,
  overrides: Partial<UsbDiscoveredDevice> = {}
): UsbDiscoveredDevice {
  return {
    usb: { vendorId, productId },
    supported: true,
    ...overrides,
  };
}

const iPodDiscovered = makeDiscovered('05ac', '1263', {
  model: {
    displayName: 'iPod Classic 6th generation',
    generationId: 'classic_6g',
    checksumType: 'hash58',
    source: 'usb',
  },
});

const echoMiniDiscovered = makeDiscovered('071b', '3203');

const unknownDiscovered = makeDiscovered('1234', 'abcd');

// =============================================================================
// Provider stubs
// =============================================================================

const iPodIdentity: IpodIdentity = {
  kind: 'ipod',
  firewireGuid: 'AABBCCDD00112233',
  serialNumber: '000A27001BC8EED6',
  familyId: 27,
};

const echoMiniIdentity: MassStorageIdentity = {
  kind: 'mass-storage',
  presetId: 'echo-mini',
  serialNumber: 'EM-SERIAL-001',
};

const fakeIpodProvider: DeviceProvider = {
  id: 'fake-ipod',
  async detect(fp: UsbFingerprint) {
    const vid = fp.vendorId.replace(/^0x/, '').toLowerCase();
    const pid = fp.productId.replace(/^0x/, '').toLowerCase();
    if (vid === '05ac' && pid === '1263') return iPodIdentity;
    return null;
  },
};

const fakeEchoMiniProvider: DeviceProvider = {
  id: 'fake-echo-mini',
  async detect(fp: UsbFingerprint) {
    const vid = fp.vendorId.replace(/^0x/, '').toLowerCase();
    const pid = fp.productId.replace(/^0x/, '').toLowerCase();
    if (vid === '071b' && pid === '3203') return echoMiniIdentity;
    return null;
  },
};

/** Provider that matches everything — for testing priority */
const greedyProvider: DeviceProvider = {
  id: 'greedy',
  async detect(_fp: UsbFingerprint) {
    return { kind: 'mass-storage' } satisfies MassStorageIdentity;
  },
};

/** Provider that always throws */
const throwingProvider: DeviceProvider = {
  id: 'throwing',
  async detect(_fp: UsbFingerprint): Promise<never> {
    throw new Error('provider crashed');
  },
};

// =============================================================================
// Helpers
// =============================================================================

function walk(devices: UsbDiscoveredDevice[]) {
  return () => Promise.resolve(devices);
}

// =============================================================================
// Tests
// =============================================================================

describe('enumerateConnectedDevices', () => {
  it('returns empty array when the USB walk finds no devices', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider],
      walk: walk([]),
    });
    expect(result).toHaveLength(0);
  });

  it('returns device without identity when no provider matches', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider],
      walk: walk([unknownDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.identity).toBeUndefined();
    expect(result[0]!.matchedProviderId).toBeUndefined();
  });

  it('matches a single iPod device to the iPod provider', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('fake-ipod');
    expect(result[0]!.identity).toEqual(iPodIdentity);
  });

  it('matches an Echo Mini device to the mass-storage provider', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider, fakeEchoMiniProvider],
      walk: walk([echoMiniDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('fake-echo-mini');
    expect(result[0]!.identity).toEqual(echoMiniIdentity);
  });

  it('handles mixed devices — iPod, Echo Mini, and unknown in one walk', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider, fakeEchoMiniProvider],
      walk: walk([iPodDiscovered, echoMiniDiscovered, unknownDiscovered]),
    });
    expect(result).toHaveLength(3);

    const ipodResult = result.find((r) => r.matchedProviderId === 'fake-ipod');
    expect(ipodResult).toBeDefined();
    expect(ipodResult!.identity?.kind).toBe('ipod');

    const echoResult = result.find((r) => r.matchedProviderId === 'fake-echo-mini');
    expect(echoResult).toBeDefined();
    expect(echoResult!.identity?.kind).toBe('mass-storage');

    const unknownResult = result.find((r) => r.matchedProviderId === undefined);
    expect(unknownResult).toBeDefined();
    expect(unknownResult!.identity).toBeUndefined();
  });

  it('respects provider priority order — first non-null match wins', async () => {
    // Put greedy provider first: it should win over fakeIpodProvider.
    const result = await enumerateConnectedDevices({
      providers: [greedyProvider, fakeIpodProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('greedy');
  });

  it('skips to the next provider when the first does not match', async () => {
    // echoMiniProvider first, then iPod — iPod should be matched by the second.
    const result = await enumerateConnectedDevices({
      providers: [fakeEchoMiniProvider, fakeIpodProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('fake-ipod');
  });

  it('treats a throwing provider as non-matching and continues to the next', async () => {
    const result = await enumerateConnectedDevices({
      providers: [throwingProvider, fakeIpodProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result).toHaveLength(1);
    // throwingProvider threw — should fall through to fakeIpodProvider.
    expect(result[0]!.matchedProviderId).toBe('fake-ipod');
    expect(result[0]!.identity).toEqual(iPodIdentity);
  });

  it('returns unmatched device when only the throwing provider is supplied', async () => {
    const result = await enumerateConnectedDevices({
      providers: [throwingProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.identity).toBeUndefined();
    expect(result[0]!.matchedProviderId).toBeUndefined();
  });

  it('returns all devices even with no providers', async () => {
    const result = await enumerateConnectedDevices({
      providers: [],
      walk: walk([iPodDiscovered, echoMiniDiscovered]),
    });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.identity).toBeUndefined();
      expect(r.matchedProviderId).toBeUndefined();
    }
  });

  it('exposes the original discovered device on each result', async () => {
    const result = await enumerateConnectedDevices({
      providers: [fakeIpodProvider],
      walk: walk([iPodDiscovered]),
    });
    expect(result[0]!.discovered).toBe(iPodDiscovered);
  });

  it('passes bare-hex VIDs/PIDs through to providers', async () => {
    // Capture the fingerprint the provider receives.
    const seen: UsbFingerprint[] = [];
    const recordingProvider: DeviceProvider = {
      id: 'recording',
      async detect(fp) {
        seen.push(fp);
        return null;
      },
    };

    await enumerateConnectedDevices({
      providers: [recordingProvider],
      walk: walk([makeDiscovered('05ac', '1261')]),
    });

    expect(seen).toHaveLength(1);
    // Providers receive bare hex (UsbFingerprint canonical form).
    expect(seen[0]!.vendorId).toBe('05ac');
    expect(seen[0]!.productId).toBe('1261');
  });
});
