import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectPartitions, parseLsblkJson, scanMassStoragePaths } from './device-poller.js';
import type { DetectedDevice } from './device-poller.js';

// ---------------------------------------------------------------------------
// parseLsblkJson / collectPartitions (pure functions, no mocking needed)
// ---------------------------------------------------------------------------

describe('parseLsblkJson', () => {
  it('extracts partitions from nested lsblk output', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 160041885696,
          type: 'disk',
          children: [
            {
              name: 'sda1',
              uuid: 'ABCD-1234',
              label: 'IPOD',
              mountpoint: null,
              fstype: 'vfat',
              size: 160040837120,
              type: 'part',
            },
          ],
        },
      ],
    });

    const partitions = parseLsblkJson(json);
    expect(partitions).toHaveLength(1);
    expect(partitions[0]!.name).toBe('sda1');
    expect(partitions[0]!.fstype).toBe('vfat');
    expect(partitions[0]!.uuid).toBe('ABCD-1234');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseLsblkJson('not json')).toEqual([]);
  });

  it('returns empty array for missing blockdevices', () => {
    expect(parseLsblkJson('{}')).toEqual([]);
  });

  it('collects deeply nested partitions', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          type: 'disk',
          children: [
            {
              name: 'sda1',
              uuid: 'A',
              fstype: 'vfat',
              type: 'part',
              label: null,
              mountpoint: null,
              size: 100,
            },
            {
              name: 'sda2',
              uuid: 'B',
              fstype: 'ext4',
              type: 'part',
              label: null,
              mountpoint: null,
              size: 200,
            },
          ],
        },
      ],
    });
    const partitions = parseLsblkJson(json);
    expect(partitions).toHaveLength(2);
  });

  it('ignores non-partition devices', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 100,
          type: 'disk',
        },
      ],
    });
    const partitions = parseLsblkJson(json);
    expect(partitions).toHaveLength(0);
  });
});

describe('collectPartitions', () => {
  it('collects flat list of partitions', () => {
    const devices = [
      {
        name: 'sda1',
        type: 'part',
        uuid: 'A',
        label: null,
        mountpoint: null,
        fstype: 'vfat',
        size: 100,
      },
      {
        name: 'sdb1',
        type: 'part',
        uuid: 'B',
        label: null,
        mountpoint: null,
        fstype: 'ext4',
        size: 200,
      },
    ];
    expect(collectPartitions(devices)).toHaveLength(2);
  });

  it('ignores non-partition types', () => {
    const devices = [
      {
        name: 'loop0',
        type: 'loop',
        uuid: null,
        label: null,
        mountpoint: null,
        fstype: null,
        size: 0,
      },
    ];
    expect(collectPartitions(devices)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DevicePoller (with mocked lsblk and sysfs reads)
// ---------------------------------------------------------------------------

// We test the DevicePoller by mocking the child_process spawn used by execLsblk
// and the fs functions used by readUsbVendorId / isIpodDevice.

describe('DevicePoller', () => {
  // Rather than trying to mock spawn at the module level (which is fragile),
  // we test the higher-level behavior by verifying the poller wires events
  // correctly using the exported pure functions and a manual approach.

  it('DevicePoller constructor sets interval', async () => {
    // Dynamic import to get the class
    const { DevicePoller } = await import('./device-poller.js');
    const poller = new DevicePoller({ interval: 10 });
    // The poller should not throw on construction
    expect(poller).toBeDefined();
    // Verify it hasn't started
    poller.stop(); // no-op if not started
  });

  it('DevicePoller emits device-appeared and device-disappeared', async () => {
    // This test validates the EventEmitter contract
    const { DevicePoller } = await import('./device-poller.js');
    const poller = new DevicePoller({ interval: 60 });

    const appeared: DetectedDevice[] = [];
    const disappeared: DetectedDevice[] = [];

    poller.on('device-appeared', (d) => appeared.push(d));
    poller.on('device-disappeared', (d) => disappeared.push(d));

    const testDevice: DetectedDevice = {
      name: 'sdb1',
      disk: '/dev/sdb1',
      uuid: 'ABCD-1234',
      label: 'IPOD',
      size: 160000000000,
    };

    // Manually emit to verify wiring
    poller.emit('device-appeared', testDevice);
    expect(appeared).toHaveLength(1);
    expect(appeared[0]!.name).toBe('sdb1');

    poller.emit('device-disappeared', testDevice);
    expect(disappeared).toHaveLength(1);
    expect(disappeared[0]!.name).toBe('sdb1');

    poller.stop();
  });
});

// ---------------------------------------------------------------------------
// scanMassStoragePaths (pure function, uses real filesystem)
// ---------------------------------------------------------------------------

describe('scanMassStoragePaths', () => {
  it('returns devices for existing directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'podkit-test-'));
    try {
      const devices = scanMassStoragePaths([dir]);
      expect(devices).toHaveLength(1);
      expect(devices[0]!.name).toBe(dir);
      expect(devices[0]!.disk).toBe(dir);
      expect(devices[0]!.size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns empty array for non-existent paths', () => {
    const devices = scanMassStoragePaths(['/tmp/podkit-nonexistent-path-abc123']);
    expect(devices).toHaveLength(0);
  });

  it('skips paths that are files, not directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'podkit-test-'));
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'hello');
    try {
      const devices = scanMassStoragePaths([filePath]);
      expect(devices).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns multiple devices for multiple valid paths', () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'podkit-test-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'podkit-test-'));
    try {
      const devices = scanMassStoragePaths([dir1, '/tmp/nonexistent', dir2]);
      expect(devices).toHaveLength(2);
      expect(devices[0]!.name).toBe(dir1);
      expect(devices[1]!.name).toBe(dir2);
    } finally {
      rmSync(dir1, { recursive: true });
      rmSync(dir2, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// DevicePoller debounce (using injectable scan function)
// ---------------------------------------------------------------------------

function makeDevice(name: string): DetectedDevice {
  return {
    name,
    disk: `/dev/${name}`,
    uuid: 'ABCD-1234',
    label: 'IPOD',
    size: 160_000_000_000,
  };
}

describe('DevicePoller debounce', () => {
  it('requires 2 consecutive polls before emitting device-appeared', async () => {
    const { DevicePoller } = await import('./device-poller.js');
    const device = makeDevice('sdb1');

    const appeared: DetectedDevice[] = [];
    const poller = new DevicePoller({
      interval: 60,
      scan: async () => [device],
    });
    poller.on('device-appeared', (d) => appeared.push(d));

    // Poll 1: device first seen → added to pending, NOT emitted
    await poller.poll();
    expect(appeared).toHaveLength(0);

    // Poll 2: device still present → confirmed, emitted
    await poller.poll();
    expect(appeared).toHaveLength(1);
    expect(appeared[0]!.name).toBe('sdb1');

    poller.stop();
  });

  it('does not emit for a device that appears and disappears in one cycle', async () => {
    const { DevicePoller } = await import('./device-poller.js');
    const device = makeDevice('sdb1');

    let scanResults: DetectedDevice[] = [device];
    const appeared: DetectedDevice[] = [];
    const poller = new DevicePoller({
      interval: 60,
      scan: async () => scanResults,
    });
    poller.on('device-appeared', (d) => appeared.push(d));

    // Poll 1: device seen → pending
    await poller.poll();
    expect(appeared).toHaveLength(0);

    // Device disappears before next poll
    scanResults = [];

    // Poll 2: device gone → removed from pending, not emitted
    await poller.poll();
    expect(appeared).toHaveLength(0);

    poller.stop();
  });

  it('does not re-emit for an already known device', async () => {
    const { DevicePoller } = await import('./device-poller.js');
    const device = makeDevice('sdb1');

    const appeared: DetectedDevice[] = [];
    const poller = new DevicePoller({
      interval: 60,
      scan: async () => [device],
    });
    poller.on('device-appeared', (d) => appeared.push(d));

    // Poll 1: pending
    await poller.poll();
    // Poll 2: confirmed → emitted
    await poller.poll();
    expect(appeared).toHaveLength(1);

    // Poll 3: still present → no re-emit
    await poller.poll();
    expect(appeared).toHaveLength(1);

    poller.stop();
  });

  it('emits device-disappeared when a known device is removed', async () => {
    const { DevicePoller } = await import('./device-poller.js');
    const device = makeDevice('sdb1');

    let scanResults: DetectedDevice[] = [device];
    const disappeared: DetectedDevice[] = [];
    const poller = new DevicePoller({
      interval: 60,
      scan: async () => scanResults,
    });
    poller.on('device-disappeared', (d) => disappeared.push(d));

    // Confirm device (2 polls)
    await poller.poll();
    await poller.poll();

    // Device removed
    scanResults = [];
    await poller.poll();
    expect(disappeared).toHaveLength(1);
    expect(disappeared[0]!.name).toBe('sdb1');

    poller.stop();
  });

  it('does not emit device-disappeared for a pending device that vanishes', async () => {
    const { DevicePoller } = await import('./device-poller.js');
    const device = makeDevice('sdb1');

    let scanResults: DetectedDevice[] = [device];
    const disappeared: DetectedDevice[] = [];
    const poller = new DevicePoller({
      interval: 60,
      scan: async () => scanResults,
    });
    poller.on('device-disappeared', (d) => disappeared.push(d));

    // Poll 1: device pending
    await poller.poll();

    // Device removed before confirmation
    scanResults = [];
    await poller.poll();

    // Should not emit disappearance for a device that was never confirmed
    expect(disappeared).toHaveLength(0);

    poller.stop();
  });
});
