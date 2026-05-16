/**
 * Unit tests for `reconcileIpodDiscovery` — the pure primitive that folds
 * USB-inquiry and block-device discovery streams into one record per
 * physical iPod for `podkit device scan`.
 *
 * Coverage matches TASK-317.11 §1: each match path (serial / disk-identifier
 * / block-only / usb-only) is exercised, both macOS and Linux disk-identifier
 * shapes are tested, and replug stability is asserted (calling reconcile
 * twice with the same inputs returns equal records).
 */

import { describe, expect, it } from 'bun:test';
import type { IpodClassification } from '@podkit/devices-ipod';
import { reconcileIpodDiscovery, type ReconciledIpodRecord } from './reconcile.js';
import { stripPartitionSuffix } from './platforms/linux.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import type { PlatformDeviceInfo } from './types.js';

// ── Builders ────────────────────────────────────────────────────────────────

function block(overrides: Partial<PlatformDeviceInfo>): PlatformDeviceInfo {
  return {
    identifier: 'sdc1',
    volumeName: 'IPOD',
    volumeUuid: '0000-0000',
    size: 8_000_000_000,
    isMounted: true,
    mountPoint: '/media/ipod',
    ...overrides,
  };
}

function usb(
  overrides: Partial<EnumeratedUsbDevice>,
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('stripPartitionSuffix (shared with reconcile)', () => {
  it('strips macOS partition suffixes: disk2s1 → disk2', () => {
    expect(stripPartitionSuffix('disk2s1')).toBe('disk2');
    expect(stripPartitionSuffix('disk5s2')).toBe('disk5');
  });

  it('passes macOS bare disk names through unchanged', () => {
    expect(stripPartitionSuffix('disk2')).toBe('disk2');
    expect(stripPartitionSuffix('disk10')).toBe('disk10');
  });

  it('strips Linux SCSI/IDE/virtio partition suffixes: sdc1 → sdc', () => {
    expect(stripPartitionSuffix('sdc1')).toBe('sdc');
    expect(stripPartitionSuffix('sda2')).toBe('sda');
    expect(stripPartitionSuffix('vdb1')).toBe('vdb');
  });

  it('strips Linux NVMe / eMMC partition suffixes: mmcblk0p1 → mmcblk0', () => {
    expect(stripPartitionSuffix('mmcblk0p1')).toBe('mmcblk0');
    expect(stripPartitionSuffix('nvme0n1p2')).toBe('nvme0n1');
  });

  it('passes Linux bare disk names through unchanged', () => {
    expect(stripPartitionSuffix('sdc')).toBe('sdc');
    expect(stripPartitionSuffix('mmcblk0')).toBe('mmcblk0');
    expect(stripPartitionSuffix('nvme0n1')).toBe('nvme0n1');
  });

  it('does not mistake non-disk identifiers for partitions', () => {
    expect(stripPartitionSuffix('loop0')).toBe('loop0');
    // `unknown1` has neither a `disk` prefix nor a known SCSI prefix; pass through.
    expect(stripPartitionSuffix('unknown1')).toBe('unknown1');
  });
});

describe('reconcileIpodDiscovery', () => {
  describe('match by serial number', () => {
    it('folds same-iPod records from both pipelines into one entry', () => {
      const blockDevice = block({
        identifier: 'sdc1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: '000A1B2C3D4E5F60',
        },
      });
      const usbDevice = usb({ serialNumber: '000A1B2C3D4E5F60' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('serial');
      expect(result[0]!.block).toBe(blockDevice);
      expect(result[0]!.usb).toBe(usbDevice);
    });

    it('treats empty serials as no-match (does not fold)', () => {
      const blockDevice = block({
        identifier: 'sdc1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: '',
        },
      });
      const usbDevice = usb({ serialNumber: '' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      // Without a usable serial, no disk identifier on USB either, so two records.
      expect(result).toHaveLength(2);
      expect(result[0]!.matchedBy).toBe('block-only');
      expect(result[1]!.matchedBy).toBe('usb-only');
    });
  });

  describe('match by disk identifier', () => {
    it('folds when usb diskIdentifier matches the block whole-disk (macOS shape)', () => {
      // macOS: block identifier is partition (`disk2s1`); USB diskIdentifier
      // is the whole disk (`disk2`). Strip the partition suffix and compare.
      const blockDevice = block({
        identifier: 'disk2s1',
        // No usbFingerprint on macOS path — disk-identifier carries the match.
      });
      const usbDevice = usb({ diskIdentifier: 'disk2' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('disk-identifier');
      expect(result[0]!.block).toBe(blockDevice);
      expect(result[0]!.usb).toBe(usbDevice);
    });

    it('folds when usb diskIdentifier matches the block whole-disk (Linux SCSI)', () => {
      const blockDevice = block({ identifier: 'sdc1' });
      const usbDevice = usb({ diskIdentifier: 'sdc' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('disk-identifier');
    });

    it('folds when usb diskIdentifier matches the block whole-disk (Linux eMMC)', () => {
      const blockDevice = block({ identifier: 'mmcblk0p1' });
      const usbDevice = usb({ diskIdentifier: 'mmcblk0' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('disk-identifier');
    });

    it('folds when both sides report the partition identifier (system_profiler bsd_name=disk5s2)', () => {
      // Regression: macOS system_profiler can emit `bsd_name: disk5s2` for the
      // partition rather than the whole disk. Both sides must be normalised.
      const blockDevice = block({ identifier: 'disk5s2' });
      const usbDevice = usb({ diskIdentifier: 'disk5s2' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('disk-identifier');
    });

    it('folds when usb side has the partition and block side has a different partition of the same disk', () => {
      const blockDevice = block({ identifier: 'disk5s1' });
      const usbDevice = usb({ diskIdentifier: 'disk5s2' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('disk-identifier');
    });

    it('does not fold when no serial is available and disk identifiers differ', () => {
      const blockDevice = block({ identifier: 'sdc1' });
      const usbDevice = usb({ diskIdentifier: 'sdd' });

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(2);
      expect(result[0]!.matchedBy).toBe('block-only');
      expect(result[1]!.matchedBy).toBe('usb-only');
    });
  });

  describe('serial takes priority over disk identifier when both are present', () => {
    it('prefers serial match when both rules would produce different pairings', () => {
      const blockDevice = block({
        identifier: 'sdc1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'SERIAL-A',
        },
      });
      // Two USB candidates: one matches by disk-identifier, the other by serial.
      const usbByDisk = usb({ diskIdentifier: 'sdc' });
      const usbBySerial = usb({ serialNumber: 'SERIAL-A' });

      const result = reconcileIpodDiscovery([blockDevice], [usbByDisk, usbBySerial]);

      // Block matches the serial candidate; the disk-identifier candidate is
      // an unrelated USB-only entry.
      expect(result).toHaveLength(2);
      const matched = result.find((r) => r.matchedBy === 'serial');
      expect(matched).toBeDefined();
      expect(matched!.usb).toBe(usbBySerial);
      const orphan = result.find((r) => r.matchedBy === 'usb-only');
      expect(orphan).toBeDefined();
      expect(orphan!.usb).toBe(usbByDisk);
    });
  });

  describe('block-only and usb-only', () => {
    it('emits a block-only record when the USB pipeline missed the device', () => {
      const blockDevice = block({ identifier: 'sdc1' });

      const result = reconcileIpodDiscovery([blockDevice], []);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('block-only');
      expect(result[0]!.block).toBe(blockDevice);
      expect(result[0]!.usb).toBeUndefined();
    });

    it('emits a usb-only record when the block pipeline missed the device', () => {
      // Realistic: an iOS device or restore-mode iPod with no mass-storage volume.
      const usbDevice = usb({ productId: '12aa' }, { supported: false });

      const result = reconcileIpodDiscovery([], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('usb-only');
      expect(result[0]!.usb).toBe(usbDevice);
      expect(result[0]!.block).toBeUndefined();
    });
  });

  describe('mixed multi-device scan', () => {
    it('produces 2 merged records for 2 iPods both seen on both pipelines, no double-counts', () => {
      const blockA = block({
        identifier: 'sdc1',
        volumeName: 'IPOD-A',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'SERIAL-A',
        },
      });
      const blockB = block({
        identifier: 'sdd1',
        volumeName: 'IPOD-B',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1263',
          serialNumber: 'SERIAL-B',
        },
      });
      const usbA = usb({ productId: '1262', serialNumber: 'SERIAL-A' });
      const usbB = usb({ productId: '1263', serialNumber: 'SERIAL-B' });

      const result = reconcileIpodDiscovery([blockA, blockB], [usbA, usbB]);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.matchedBy)).toEqual(['serial', 'serial']);
      expect(result[0]!.block).toBe(blockA);
      expect(result[0]!.usb).toBe(usbA);
      expect(result[1]!.block).toBe(blockB);
      expect(result[1]!.usb).toBe(usbB);
    });

    it('claims each USB record at most once even when multiple block records share a serial', () => {
      // Defensive: if two block records claim to have the same serial (e.g.
      // multi-LUN device), only the first matches. The second falls through
      // to disk-identifier or block-only.
      const blockA = block({
        identifier: 'sdc1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'DUPLICATE',
        },
      });
      const blockB = block({
        identifier: 'sdd1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'DUPLICATE',
        },
      });
      const usbDevice = usb({ serialNumber: 'DUPLICATE' });

      const result = reconcileIpodDiscovery([blockA, blockB], [usbDevice]);

      expect(result).toHaveLength(2);
      expect(result[0]!.matchedBy).toBe('serial');
      expect(result[0]!.usb).toBe(usbDevice);
      expect(result[1]!.matchedBy).toBe('block-only');
      expect(result[1]!.usb).toBeUndefined();
    });
  });

  describe('replug / repeat stability', () => {
    it('returns equal records when called twice with the same inputs', () => {
      const blockDevice = block({
        identifier: 'sdc1',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'SERIAL-A',
        },
      });
      const usbDevice = usb({ serialNumber: 'SERIAL-A' });

      const first = reconcileIpodDiscovery([blockDevice], [usbDevice]);
      const second = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      // Must be equal in shape, length, and record-by-record references —
      // the primitive does no allocation or copy of the input objects.
      expect(second).toHaveLength(first.length);
      for (let i = 0; i < first.length; i++) {
        const a = first[i] as ReconciledIpodRecord;
        const b = second[i] as ReconciledIpodRecord;
        expect(b.matchedBy).toBe(a.matchedBy);
        expect(b.block).toBe(a.block);
        expect(b.usb).toBe(a.usb);
      }
    });
  });

  describe('linka regression — block + usb for one iPod renders as one record', () => {
    it('reproduces the linka shape (FAT32 nano 3G) and folds to one record', () => {
      // The exact shape from TASK-317.11's linka repro: the block-device
      // pipeline finds /dev/sdc1 with a USB fingerprint surfaced via sysfs,
      // and the USB-inquiry pipeline finds the same iPod by Apple-vendor
      // matching. Pre-fix: rendered as two entries. Post-fix: one record.
      const blockDevice: PlatformDeviceInfo = {
        identifier: 'sdc1',
        volumeName: 'IPOD',
        volumeUuid: '1234-5678',
        size: 7_950_000_000,
        isMounted: true,
        mountPoint: '/media/james/IPOD',
        usbFingerprint: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'NANO3G-LINKA-SERIAL',
          bus: 1,
          devnum: 4,
        },
      };
      const usbDevice: IpodClassification<EnumeratedUsbDevice> = {
        kind: 'ipod',
        device: {
          vendorId: '05ac',
          productId: '1262',
          serialNumber: 'NANO3G-LINKA-SERIAL',
          bus: 1,
          devnum: 4,
        },
        supported: true,
      };

      const result = reconcileIpodDiscovery([blockDevice], [usbDevice]);

      expect(result).toHaveLength(1);
      expect(result[0]!.matchedBy).toBe('serial');
      expect(result[0]!.block).toBe(blockDevice);
      expect(result[0]!.usb).toBe(usbDevice);
    });
  });
});
