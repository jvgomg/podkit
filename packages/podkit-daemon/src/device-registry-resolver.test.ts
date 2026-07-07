import { describe, it, expect } from 'bun:test';
import {
  resolveRegisteredDeviceName,
  createDeviceNameResolver,
  type RegistryDevice,
} from './device-registry-resolver.js';
import type { CliResult, DeviceListOutput } from './cli-runner.js';
import type { DetectedDevice } from './device-poller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDevice(overrides?: Partial<DetectedDevice>): DetectedDevice {
  return {
    name: 'sdb1',
    disk: '/dev/sdb1',
    uuid: 'ABCD-1234',
    label: 'IPOD',
    size: 160_000_000_000,
    ...overrides,
  };
}

function listResult(
  devices: DeviceListOutput['devices'],
  overrides?: Partial<CliResult<DeviceListOutput>>
): CliResult<DeviceListOutput> {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    json: { success: true, devices },
    duration: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveRegisteredDeviceName (pure)
// ---------------------------------------------------------------------------

describe('resolveRegisteredDeviceName', () => {
  const registry: RegistryDevice[] = [
    { name: 'terapod', volumeUuid: 'ABCD-1234' },
    { name: 'nano', volumeUuid: 'EF01-5678' },
    { name: 'walkman' }, // mass-storage entry without a UUID
  ];

  const cases: Array<{
    title: string;
    uuid: string | undefined;
    devices: RegistryDevice[];
    expected: string | null;
  }> = [
    {
      title: 'matches a registered device by exact UUID',
      uuid: 'ABCD-1234',
      devices: registry,
      expected: 'terapod',
    },
    {
      title: 'matches case-insensitively (lsblk lowercase vs config uppercase)',
      uuid: 'abcd-1234',
      devices: registry,
      expected: 'terapod',
    },
    {
      title: 'picks the right entry among several',
      uuid: 'EF01-5678',
      devices: registry,
      expected: 'nano',
    },
    {
      title: 'returns null when no entry matches',
      uuid: '9999-0000',
      devices: registry,
      expected: null,
    },
    {
      title: 'returns null when the detected device has no UUID',
      uuid: undefined,
      devices: registry,
      expected: null,
    },
    {
      title: 'returns null for an empty registry',
      uuid: 'ABCD-1234',
      devices: [],
      expected: null,
    },
    {
      title: 'ignores registry entries without a volumeUuid',
      uuid: 'ABCD-1234',
      devices: [{ name: 'walkman' }],
      expected: null,
    },
    {
      title: 'returns null for an empty-string UUID',
      uuid: '',
      devices: registry,
      expected: null,
    },
  ];

  for (const c of cases) {
    it(c.title, () => {
      expect(resolveRegisteredDeviceName(c.uuid, c.devices)).toBe(c.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// createDeviceNameResolver (registry fetch + resolve, failure-tolerant)
// ---------------------------------------------------------------------------

describe('createDeviceNameResolver', () => {
  it('resolves a detected UUID to its registered name via device list', async () => {
    const resolve = createDeviceNameResolver(async () =>
      listResult([{ name: 'terapod', volumeUuid: 'ABCD-1234' }])
    );
    expect(await resolve(makeDevice())).toBe('terapod');
  });

  it('returns null without invoking the CLI when the device has no UUID', async () => {
    let called = false;
    const resolve = createDeviceNameResolver(async () => {
      called = true;
      return listResult([]);
    });
    expect(await resolve(makeDevice({ uuid: undefined }))).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the device is not in the registry', async () => {
    const resolve = createDeviceNameResolver(async () =>
      listResult([{ name: 'nano', volumeUuid: 'EF01-5678' }])
    );
    expect(await resolve(makeDevice())).toBeNull();
  });

  it('returns null when device list exits non-zero', async () => {
    const resolve = createDeviceNameResolver(async () =>
      listResult([{ name: 'terapod', volumeUuid: 'ABCD-1234' }], { exitCode: 1 })
    );
    expect(await resolve(makeDevice())).toBeNull();
  });

  it('returns null when device list output is missing or unsuccessful', async () => {
    const noJson = createDeviceNameResolver(async () => listResult([], { json: undefined }));
    expect(await noJson(makeDevice())).toBeNull();

    const unsuccessful = createDeviceNameResolver(async () =>
      listResult([], { json: { success: false, devices: [] } })
    );
    expect(await unsuccessful(makeDevice())).toBeNull();
  });

  it('returns null when device list throws (CLI missing, timeout)', async () => {
    const resolve = createDeviceNameResolver(async () => {
      throw new Error('spawn podkit ENOENT');
    });
    expect(await resolve(makeDevice())).toBeNull();
  });
});
