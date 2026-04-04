/**
 * Unit tests for Linux device manager
 *
 * Parser tests are pure functions — they run on any platform.
 * Tool detection tests mock exec to avoid requiring Linux tools.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseLsblkJson,
  collectPartitions,
  stripPartitionSuffix,
  LinuxDeviceManager,
} from './linux.js';

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
      size: 500106813440,
      blockSizeBytes: 512,
      isMounted: true,
      mountPoint: '/media/user/TERAPOD',
      mediaType: '',
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
    expect(devices[0]!.blockSizeBytes).toBe(2048);
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
    expect(devices[0]!.size).toBe(0);
    expect(devices[0]!.blockSizeBytes).toBeUndefined();
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
