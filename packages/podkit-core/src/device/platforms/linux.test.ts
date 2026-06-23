/**
 * Unit tests for Linux device manager
 *
 * Parser tests are pure functions — they run on any platform.
 * Tool detection tests mock exec to avoid requiring Linux tools.
 */

import { describe, it, expect } from 'bun:test';
import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';
import {
  parseLsblkJson,
  collectPartitions,
  stripPartitionSuffix,
  parseFindmntPairs,
  LinuxDeviceManager,
} from './linux.js';

/**
 * Record every `run(command, args)` invocation and serve canned results keyed
 * by the command name. Unknown commands resolve `which <x>` to success so tool
 * detection (`requireLsblk`) passes without ceremony; everything else returns
 * exit code 1 (degrade-to-null) unless a handler is supplied.
 */
function recordingRunner(handlers: Record<string, (args: string[]) => SubprocessRunResult>): {
  runner: SubprocessRunner;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: SubprocessRunner = {
    async run(command, args) {
      calls.push({ command, args });
      const handler = handlers[command];
      if (handler) return handler(args);
      if (command === 'which') return { stdout: `/usr/bin/${args[0]}`, stderr: '', exitCode: 0 };
      return { stdout: '', stderr: 'not found', exitCode: 1 };
    },
  };
  return { runner, calls };
}

// ---------------------------------------------------------------------------
// parseLsblkJson
// ---------------------------------------------------------------------------

describe('parseLsblkJson', () => {
  it('parses a single partition with all fields', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 500107862016,
          'phy-sec': 512,
          type: 'disk',
          children: [
            {
              name: 'sda1',
              uuid: '1234-5678',
              label: 'TERAPOD',
              mountpoint: '/media/user/TERAPOD',
              fstype: 'vfat',
              size: 500106813440,
              'phy-sec': 512,
              type: 'part',
            },
          ],
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      identifier: 'sda1',
      volumeName: 'TERAPOD',
      volumeUuid: '1234-5678',
      isMounted: true,
      mountPoint: '/media/user/TERAPOD',
      mediaType: '',
      storage: {
        sizeBytes: 500106813440,
        blockSizeBytes: 512,
        filesystem: 'vfat',
        partitionLayout: {
          partitionCount: 1,
          partitions: [
            {
              index: 1,
              filesystem: 'vfat',
              sizeBytes: 500106813440,
              identifier: 'sda1',
              volumeUuid: '1234-5678',
            },
          ],
        },
      },
    });
  });

  it('handles unmounted partitions', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sdb',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 120034123776,
          'phy-sec': 512,
          type: 'disk',
          children: [
            {
              name: 'sdb1',
              uuid: 'ABCD-EF01',
              label: 'IPOD',
              mountpoint: null,
              fstype: 'vfat',
              size: 120034123776,
              'phy-sec': 2048,
              type: 'part',
            },
          ],
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.isMounted).toBe(false);
    expect(devices[0]!.mountPoint).toBeUndefined();
    expect(devices[0]!.storage.blockSizeBytes).toBe(2048);
  });

  it('skips partitions without UUID', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 500107862016,
          'phy-sec': 512,
          type: 'disk',
          children: [
            {
              name: 'sda1',
              uuid: null,
              label: null,
              mountpoint: null,
              fstype: null,
              size: 1048576,
              'phy-sec': 512,
              type: 'part',
            },
            {
              name: 'sda2',
              uuid: 'AAAA-BBBB',
              label: 'DATA',
              mountpoint: '/data',
              fstype: 'vfat',
              size: 500106813440,
              'phy-sec': 512,
              type: 'part',
            },
          ],
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.identifier).toBe('sda2');
  });

  it('skips whole disks (type !== "part")', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: 'disk-uuid',
          label: 'WHOLEDISK',
          mountpoint: null,
          fstype: null,
          size: 500107862016,
          'phy-sec': 512,
          type: 'disk',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(0);
  });

  it('handles missing label gracefully', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: null,
          mountpoint: '/mnt/test',
          fstype: 'vfat',
          size: 1073741824,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.volumeName).toBe('');
  });

  it('handles multiple disks with multiple partitions', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 500107862016,
          'phy-sec': 512,
          type: 'disk',
          children: [
            {
              name: 'sda1',
              uuid: 'AAAA-1111',
              label: 'BOOT',
              mountpoint: '/boot',
              fstype: 'vfat',
              size: 536870912,
              'phy-sec': 512,
              type: 'part',
            },
            {
              name: 'sda2',
              uuid: 'bbbb-2222',
              label: 'ROOT',
              mountpoint: '/',
              fstype: 'ext4',
              size: 499570941952,
              'phy-sec': 512,
              type: 'part',
            },
          ],
        },
        {
          name: 'sdb',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 120034123776,
          'phy-sec': 512,
          type: 'disk',
          children: [
            {
              name: 'sdb1',
              uuid: 'CCCC-3333',
              label: 'IPOD',
              mountpoint: '/media/user/IPOD',
              fstype: 'vfat',
              size: 120034123776,
              'phy-sec': 2048,
              type: 'part',
            },
          ],
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(3);
    expect(devices.map((d) => d.identifier)).toEqual(['sda1', 'sda2', 'sdb1']);
  });

  it('handles flat partition list (no nesting)', () => {
    // Some lsblk invocations return partitions at the top level
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TEST',
          mountpoint: '/mnt/test',
          fstype: 'vfat',
          size: 1073741824,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.identifier).toBe('sda1');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseLsblkJson('not json')).toEqual([]);
  });

  it('returns empty array for empty blockdevices', () => {
    expect(parseLsblkJson(JSON.stringify({ blockdevices: [] }))).toEqual([]);
  });

  it('handles null size gracefully', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TEST',
          mountpoint: null,
          fstype: 'vfat',
          size: null,
          'phy-sec': null,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.storage.sizeBytes).toBe(0);
    expect(devices[0]!.storage.blockSizeBytes).toBeUndefined();
  });

  it('handles mountpoints array format (Linux 5.14+ / util-linux 2.38+)', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TERAPOD',
          mountpoint: null,
          mountpoints: ['/media/user/TERAPOD'],
          fstype: 'vfat',
          size: 500106813440,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.isMounted).toBe(true);
    expect(devices[0]!.mountPoint).toBe('/media/user/TERAPOD');
  });

  it('handles mountpoints array with null entries', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TEST',
          mountpoint: null,
          mountpoints: [null],
          fstype: 'vfat',
          size: 1073741824,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.isMounted).toBe(false);
    expect(devices[0]!.mountPoint).toBeUndefined();
  });

  it('prefers mountpoint string over mountpoints array', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TEST',
          mountpoint: '/mnt/primary',
          mountpoints: ['/mnt/primary', '/mnt/secondary'],
          fstype: 'vfat',
          size: 1073741824,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.mountPoint).toBe('/mnt/primary');
  });

  it('handles empty mountpoint string as unmounted', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          name: 'sda1',
          uuid: '1234-5678',
          label: 'TEST',
          mountpoint: '',
          fstype: 'vfat',
          size: 1073741824,
          'phy-sec': 512,
          type: 'part',
        },
      ],
    });

    const devices = parseLsblkJson(json);

    expect(devices).toHaveLength(1);
    expect(devices[0]!.isMounted).toBe(false);
    expect(devices[0]!.mountPoint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectPartitions
// ---------------------------------------------------------------------------

describe('collectPartitions', () => {
  it('collects partitions from nested structure', () => {
    const devices = [
      {
        name: 'sda',
        uuid: null,
        label: null,
        mountpoint: null,
        fstype: null,
        size: 500107862016,
        'phy-sec': 512,
        type: 'disk',
        children: [
          {
            name: 'sda1',
            uuid: '1111',
            label: 'A',
            mountpoint: null,
            fstype: 'vfat',
            size: 100,
            'phy-sec': 512,
            type: 'part',
          },
          {
            name: 'sda2',
            uuid: '2222',
            label: 'B',
            mountpoint: null,
            fstype: 'ext4',
            size: 200,
            'phy-sec': 512,
            type: 'part',
          },
        ],
      },
    ];

    const parts = collectPartitions(devices);

    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.name)).toEqual(['sda1', 'sda2']);
  });

  it('handles empty input', () => {
    expect(collectPartitions([])).toEqual([]);
  });

  it('skips non-part types', () => {
    const devices = [
      {
        name: 'loop0',
        uuid: null,
        label: null,
        mountpoint: null,
        fstype: null,
        size: 100,
        'phy-sec': 512,
        type: 'loop',
      },
    ];

    expect(collectPartitions(devices)).toEqual([]);
  });

  it('skips partitions inside loop devices', () => {
    const devices = [
      {
        name: 'loop0',
        uuid: null,
        label: null,
        mountpoint: null,
        fstype: null,
        size: 2147483648,
        'phy-sec': 512,
        type: 'loop',
        children: [
          {
            name: 'loop0p1',
            uuid: 'AAAA-BBBB',
            label: 'IPOD',
            mountpoint: '/srv/ipod-storage/default',
            fstype: 'vfat',
            size: 2147483648,
            'phy-sec': 512,
            type: 'part',
          },
        ],
      },
    ];

    expect(collectPartitions(devices)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stripPartitionSuffix
// ---------------------------------------------------------------------------

describe('stripPartitionSuffix', () => {
  it('strips digit suffix from standard device names (sdb1 → sdb)', () => {
    expect(stripPartitionSuffix('sdb1')).toBe('sdb');
  });

  it('strips digit suffix from standard device names (sda2 → sda)', () => {
    expect(stripPartitionSuffix('sda2')).toBe('sda');
  });

  it('strips pN suffix from Synology USB devices (usb1p2 → usb1)', () => {
    expect(stripPartitionSuffix('usb1p2')).toBe('usb1');
  });

  it('strips pN suffix from NVMe devices (nvme0n1p2 → nvme0n1)', () => {
    expect(stripPartitionSuffix('nvme0n1p2')).toBe('nvme0n1');
  });

  it('strips pN suffix from eMMC devices (mmcblk0p1 → mmcblk0)', () => {
    expect(stripPartitionSuffix('mmcblk0p1')).toBe('mmcblk0');
  });

  it('passes through bare disk name without partition suffix (sdb → sdb)', () => {
    expect(stripPartitionSuffix('sdb')).toBe('sdb');
  });

  it('passes through bare NVMe disk name without partition suffix (nvme0n1 → nvme0n1)', () => {
    expect(stripPartitionSuffix('nvme0n1')).toBe('nvme0n1');
  });

  it('passes through bare eMMC disk name without partition suffix (mmcblk0 → mmcblk0)', () => {
    expect(stripPartitionSuffix('mmcblk0')).toBe('mmcblk0');
  });
});

// ---------------------------------------------------------------------------
// LinuxDeviceManager
// ---------------------------------------------------------------------------

describe('LinuxDeviceManager', () => {
  it('has correct platform and isSupported', () => {
    const manager = new LinuxDeviceManager();
    expect(manager.platform).toBe('linux');
    expect(manager.isSupported).toBe(true);
  });

  it('requiresPrivileges returns false', () => {
    const manager = new LinuxDeviceManager();
    expect(manager.requiresPrivileges('mount')).toBe(false);
    expect(manager.requiresPrivileges('eject')).toBe(false);
  });

  it('getManualInstructions returns Linux mount instructions', () => {
    const manager = new LinuxDeviceManager();
    const instructions = manager.getManualInstructions('mount');
    expect(instructions).toContain('lsblk');
    expect(instructions).toContain('udisksctl');
    expect(instructions).toContain('mount');
  });

  it('getManualInstructions returns Linux eject instructions', () => {
    const manager = new LinuxDeviceManager();
    const instructions = manager.getManualInstructions('eject');
    expect(instructions).toContain('udisksctl unmount');
    expect(instructions).toContain('umount');
  });
});

// ---------------------------------------------------------------------------
// scan / locate (direct-query contract)
// ---------------------------------------------------------------------------

const SINGLE_PART_LSBLK = JSON.stringify({
  blockdevices: [
    {
      name: 'sdb',
      type: 'disk',
      uuid: null,
      label: null,
      mountpoint: null,
      fstype: null,
      size: 1000,
      'phy-sec': 512,
      children: [
        {
          name: 'sdb1',
          type: 'part',
          uuid: 'AAAA-BBBB',
          label: 'TERAPOD',
          mountpoint: '/media/ipod',
          fstype: 'vfat',
          size: 1000,
          'phy-sec': 512,
        },
      ],
    },
  ],
});

describe('parseFindmntPairs', () => {
  it('parses KEY="value" pairs, preserving empty values', () => {
    const out = parseFindmntPairs(
      'SOURCE="/dev/sdb1" UUID="" LABEL="My Disk" FSTYPE="vfat" TARGET="/media/x"'
    );
    expect(out).toEqual({
      SOURCE: '/dev/sdb1',
      UUID: '',
      LABEL: 'My Disk',
      FSTYPE: 'vfat',
      TARGET: '/media/x',
    });
  });

  it('returns an empty record for an empty line', () => {
    expect(parseFindmntPairs('')).toEqual({});
  });
});

describe('LinuxDeviceManager.locate', () => {
  it('locate({ path }) issues exactly one findmnt query, never a full lsblk enumerate', async () => {
    const { runner, calls } = recordingRunner({
      findmnt: () => ({
        stdout:
          'SOURCE="/dev/sdb1" UUID="AAAA-BBBB" LABEL="TERAPOD" FSTYPE="vfat" TARGET="/media/ipod"\n',
        stderr: '',
        exitCode: 0,
      }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    const device = await manager.locate({ path: '/media/ipod' });

    expect(device).not.toBeNull();
    expect(device?.volumeUuid).toBe('AAAA-BBBB');
    expect(device?.volumeName).toBe('TERAPOD');
    expect(device?.identifier).toBe('sdb1');
    expect(device?.isMounted).toBe(true);
    expect(device?.mountPoint).toBe('/media/ipod');
    // No full enumerate: lsblk JSON listing must not be invoked for a path locate.
    expect(calls.some((c) => c.command === 'lsblk' && c.args.includes('--json'))).toBe(false);
    // Exactly one direct OS query.
    expect(calls.filter((c) => c.command === 'findmnt')).toHaveLength(1);
  });

  it('locate({ path }) preserves UUID-less but mounted volumes with empty volumeUuid', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({
        stdout: 'SOURCE="functionfs" UUID="" LABEL="" FSTYPE="functionfs" TARGET="/mnt/gadget"\n',
        stderr: '',
        exitCode: 0,
      }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    const device = await manager.locate({ path: '/mnt/gadget' });

    expect(device).not.toBeNull();
    expect(device?.volumeUuid).toBe('');
    expect(device?.mountPoint).toBe('/mnt/gadget');
  });

  it('locate({ volumeUuid }) resolves via blkid + a single targeted lsblk, no enumerate', async () => {
    const { runner, calls } = recordingRunner({
      blkid: () => ({ stdout: '/dev/sdb1\n', stderr: '', exitCode: 0 }),
      lsblk: () => ({ stdout: SINGLE_PART_LSBLK, stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    const device = await manager.locate({ volumeUuid: 'AAAA-BBBB' });

    expect(device?.volumeUuid).toBe('AAAA-BBBB');
    // The single lsblk must be node-scoped (carries the resolved device path).
    const lsblkCalls = calls.filter((c) => c.command === 'lsblk' && c.args.includes('--json'));
    expect(lsblkCalls).toHaveLength(1);
    expect(lsblkCalls[0]!.args).toContain('/dev/sdb1');
  });

  it('locate returns null (does not throw) when findmnt cannot resolve the path', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({ stdout: '', stderr: 'not a mountpoint', exitCode: 1 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });
    expect(await manager.locate({ path: '/nope' })).toBeNull();
  });

  it('locate({ path }) returns null for a non-mountpoint sub-path (findmnt resolves the enclosing mount)', async () => {
    // `findmnt --target /tmp/scratch` resolves to the ENCLOSING mount (`/`)
    // with the root filesystem's UUID. Exact-mountpoint matching must reject
    // this so `device add --path /tmp/scratch` doesn't silently adopt the
    // root filesystem — it returns null and the caller's no-UUID gate fires.
    const { runner } = recordingRunner({
      findmnt: () => ({
        stdout: 'SOURCE="/dev/sda1" UUID="ROOT-UUID" LABEL="" FSTYPE="ext4" TARGET="/"\n',
        stderr: '',
        exitCode: 0,
      }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });
    expect(await manager.locate({ path: '/tmp/scratch' })).toBeNull();
  });

  it('locate returns null (does not throw) when the blkid binary is missing', async () => {
    const { runner } = recordingRunner({
      // Reject transport-level — the manager collapses this to exit code 1.
      blkid: () => {
        throw new Error('spawn blkid ENOENT');
      },
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });
    expect(await manager.locate({ volumeUuid: 'ZZZZ-9999' })).toBeNull();
  });
});

describe('LinuxDeviceManager.scan', () => {
  it('scan() returns every enumerated partition; scan({ kinds: ["ipod"] }) narrows to iPods', async () => {
    const lsblk = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          type: 'disk',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 1,
          'phy-sec': 512,
          children: [
            {
              name: 'sda1',
              type: 'part',
              uuid: 'PLAIN-1',
              label: 'BACKUP',
              mountpoint: '/media/backup',
              fstype: 'vfat',
              size: 1,
              'phy-sec': 512,
            },
          ],
        },
        {
          name: 'sdb',
          type: 'disk',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 1,
          'phy-sec': 512,
          children: [
            {
              name: 'sdb1',
              type: 'part',
              uuid: 'IPOD-1',
              label: 'TERAPOD',
              mountpoint: '/media/ipod',
              fstype: 'vfat',
              size: 1,
              'phy-sec': 512,
            },
          ],
        },
      ],
    });
    const { runner } = recordingRunner({
      lsblk: () => ({ stdout: lsblk, stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    const all = await manager.scan();
    expect(all.map((d) => d.identifier).sort()).toEqual(['sda1', 'sdb1']);

    // /sys USB walk finds nothing in CI, so classification falls to the volume
    // name heuristic — only TERAPOD survives.
    const ipods = await manager.scan({ kinds: ['ipod'] });
    expect(ipods.map((d) => d.identifier)).toEqual(['sdb1']);
  });

  it('scan({ kinds: ["ipod"] }) attaches the /sys USB fingerprint to each iPod', async () => {
    // The reconciler folds block + USB-inquiry records by `usb.serialNumber`,
    // so the iPod scan MUST carry the fingerprint forward. The `/sys` walk is
    // injected here so the test does not depend on a real sysfs tree.
    const lsblk = JSON.stringify({
      blockdevices: [
        {
          name: 'sdb',
          type: 'disk',
          uuid: null,
          label: null,
          mountpoint: null,
          fstype: null,
          size: 1,
          'phy-sec': 512,
          children: [
            {
              name: 'sdb1',
              type: 'part',
              uuid: 'IPOD-1',
              // No iPod hint in the label — classification must rely purely on
              // the injected Apple-vendor USB fingerprint.
              label: 'no-hint',
              mountpoint: null,
              fstype: 'vfat',
              size: 1,
              'phy-sec': 512,
            },
          ],
        },
      ],
    });
    const fingerprint = {
      productId: '1262',
      vendorId: '05ac',
      serialNumber: 'IPOD-SERIAL-XYZ',
      bus: 1,
      devnum: 7,
    };
    const { runner } = recordingRunner({
      lsblk: () => ({ stdout: lsblk, stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({
      subprocess: runner,
      usbIdentityResolver: () => fingerprint,
    });

    const ipods = await manager.scan({ kinds: ['ipod'] });
    expect(ipods).toHaveLength(1);
    expect(ipods[0]!.usb).toEqual(fingerprint);

    // The unfiltered scan() must NOT attach a USB fingerprint.
    const all = await manager.scan();
    expect(all[0]!.usb).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectFilesystem / setVolumeLabel
// ---------------------------------------------------------------------------

describe('LinuxDeviceManager.detectFilesystem', () => {
  it('reads FSTYPE from findmnt --target', async () => {
    const { runner, calls } = recordingRunner({
      findmnt: () => ({ stdout: 'SOURCE="/dev/sdb1" FSTYPE="vfat"', stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    expect(await manager.detectFilesystem('/mnt/ipod')).toBe('vfat');
    const findmntCall = calls.find((c) => c.command === 'findmnt');
    expect(findmntCall!.args).toContain('--target');
    expect(findmntCall!.args).toContain('/mnt/ipod');
  });

  it('returns null when findmnt exits non-zero', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({ stdout: '', stderr: 'not mounted', exitCode: 1 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });
    expect(await manager.detectFilesystem('/mnt/x')).toBeNull();
  });
});

describe('LinuxDeviceManager.setVolumeLabel', () => {
  it('relabels a FAT volume via `fatlabel <device> <label>`', async () => {
    const { runner, calls } = recordingRunner({
      findmnt: () => ({ stdout: 'SOURCE="/dev/sdb1" FSTYPE="vfat"', stderr: '', exitCode: 0 }),
      fatlabel: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    await manager.setVolumeLabel('/mnt/ipod', 'PARTY IPOD');

    const fatlabelCall = calls.find((c) => c.command === 'fatlabel');
    expect(fatlabelCall).toBeDefined();
    expect(fatlabelCall!.args).toEqual(['/dev/sdb1', 'PARTY IPOD']);
  });

  it('relabels an HFS+ volume via `hfslabel <device> <label>`', async () => {
    const { runner, calls } = recordingRunner({
      findmnt: () => ({ stdout: 'SOURCE="/dev/sdb1" FSTYPE="hfsplus"', stderr: '', exitCode: 0 }),
      hfslabel: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    await manager.setVolumeLabel('/mnt/ipod', 'Party iPod');

    const hfsCall = calls.find((c) => c.command === 'hfslabel');
    expect(hfsCall).toBeDefined();
    expect(hfsCall!.args).toEqual(['/dev/sdb1', 'Party iPod']);
  });

  it('throws VolumeLabelError on an unsupported filesystem', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({ stdout: 'SOURCE="/dev/sdb1" FSTYPE="ntfs"', stderr: '', exitCode: 0 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    await expect(manager.setVolumeLabel('/mnt/ipod', 'X')).rejects.toThrow(
      /unsupported filesystem/i
    );
  });

  it('throws VolumeLabelError when fatlabel fails', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({ stdout: 'SOURCE="/dev/sdb1" FSTYPE="vfat"', stderr: '', exitCode: 0 }),
      fatlabel: () => ({ stdout: '', stderr: 'permission denied', exitCode: 1 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    await expect(manager.setVolumeLabel('/mnt/ipod', 'X')).rejects.toThrow(/permission denied/);
  });

  it('throws VolumeLabelError when the device node cannot be resolved', async () => {
    const { runner } = recordingRunner({
      findmnt: () => ({ stdout: '', stderr: '', exitCode: 1 }),
    });
    const manager = new LinuxDeviceManager({ subprocess: runner });

    await expect(manager.setVolumeLabel('/mnt/x', 'X')).rejects.toThrow(/resolve a block device/i);
  });
});
