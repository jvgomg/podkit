/**
 * Reconcile USB-inquiry and block-device discovery into a single record per
 * physical iPod.
 *
 * `podkit device scan` runs two parallel discovery pipelines:
 *
 *  1. **Block-device pipeline** — produces {@link PlatformDeviceInfo} records
 *     by walking lsblk (Linux) or diskutil (macOS).
 *  2. **USB-inquiry pipeline** — produces {@link IpodClassification} records
 *     by enumerating libusb / system_profiler and classifying Apple-vendor
 *     devices.
 *
 * When both pipelines successfully identify the same physical iPod, the
 * renderer must show one entry, not two. When only one pipeline produces a
 * record (USB-only iOS device, block-only iPod whose USB identity could not
 * be read), that record is the device.
 *
 * `reconcileIpodDiscovery` is the single decision point that folds the two
 * input streams into one. It is a pure function: no I/O, no platform
 * branches. All the platform-specific data already lives in the input shapes
 * — block-side `usb` (TASK-340; renamed from `usbFingerprint`) is populated
 * by Linux's `findIpodDevices`, USB-side `diskIdentifier` is populated by
 * both macOS (system_profiler `bsd_name`) and Linux (sysfs walk).
 *
 * Matching priority:
 *  1. **Serial number** — the most reliable correlator. iPods report a
 *     16-hex-char serial in their USB descriptor. When both records carry a
 *     non-empty serial and they match, it's the same physical device.
 *  2. **Disk identifier** — the macOS BSD name (`disk2`) or Linux block-device
 *     name (`sdc`). The block-side `identifier` always carries a partition
 *     (`disk2s1` / `sdc1` / `mmcblk0p1`); the USB-side `diskIdentifier`
 *     usually carries the whole disk but `system_profiler` can emit a
 *     partition-level value too. Normalise both sides via
 *     `stripPartitionSuffix` before comparing.
 *  3. **No match** — emit two separate records, tagged `block-only` /
 *     `usb-only` for diagnostics.
 *
 * @module
 */

import type { IpodClassification } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import { stripPartitionSuffix } from './platforms/linux.js';
import type { PlatformDeviceInfo } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * One reconciled device record. Either `block` or `usb` (or both) is
 * populated; `matchedBy` records which key paired them when both are
 * present, or which side was the sole source when only one is present.
 */
export interface ReconciledIpodRecord {
  /** Block-device side data (when present). */
  block?: PlatformDeviceInfo;
  /** USB-inquiry side data (when present). */
  usb?: IpodClassification<EnumeratedUsbDevice>;
  /** The matching key used (for diagnostics). */
  matchedBy: 'serial' | 'disk-identifier' | 'block-only' | 'usb-only';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === 'string' && s.length > 0;
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Reconcile block-device records and USB-inquiry records into one record per
 * physical iPod.
 *
 * Pure: no I/O, no platform branches. Stable: calling twice with the same
 * inputs returns equal records in the same order (block-matched records
 * preserve block order; unmatched USB records preserve USB order).
 *
 * Matching rules — applied in priority order:
 *  1. **Serial-number match** — when both
 *     `block.usb?.serialNumber` and `usb.device.serialNumber` are
 *     non-empty and equal, fold into one record (`matchedBy: 'serial'`).
 *  2. **Disk-identifier match** — when `usb.device.diskIdentifier` matches
 *     the block device's `identifier` after stripping any trailing
 *     partition suffix from both sides (`disk2s1` → `disk2`; `sdc1` → `sdc`;
 *     `mmcblk0p1` → `mmcblk0`), fold into one record
 *     (`matchedBy: 'disk-identifier'`).
 *  3. **Otherwise** — emit separate records (`matchedBy: 'block-only'` /
 *     `'usb-only'`).
 *
 * Each USB record matches at most one block record (the first by input
 * order); each block record matches at most one USB record.
 */
export function reconcileIpodDiscovery(
  blockDevices: PlatformDeviceInfo[],
  usbClassified: IpodClassification<EnumeratedUsbDevice>[]
): ReconciledIpodRecord[] {
  const records: ReconciledIpodRecord[] = [];
  const claimedUsbIndices = new Set<number>();

  for (const block of blockDevices) {
    const matched = findMatchingUsb(block, usbClassified, claimedUsbIndices);
    if (matched) {
      claimedUsbIndices.add(matched.index);
      records.push({ block, usb: matched.usb, matchedBy: matched.matchedBy });
    } else {
      records.push({ block, matchedBy: 'block-only' });
    }
  }

  for (let i = 0; i < usbClassified.length; i++) {
    if (claimedUsbIndices.has(i)) continue;
    records.push({ usb: usbClassified[i]!, matchedBy: 'usb-only' });
  }

  return records;
}

/**
 * Find the first USB record that matches the given block-device record,
 * skipping USB records already claimed by an earlier block record.
 *
 * Returns the matched USB record, its index in the input array (so the
 * caller can mark it claimed), and the rule that produced the match.
 */
function findMatchingUsb(
  block: PlatformDeviceInfo,
  usbClassified: IpodClassification<EnumeratedUsbDevice>[],
  claimed: ReadonlySet<number>
):
  | {
      usb: IpodClassification<EnumeratedUsbDevice>;
      index: number;
      matchedBy: 'serial' | 'disk-identifier';
    }
  | undefined {
  // Priority 1: serial-number match.
  const blockSerial = block.usb?.serialNumber;
  if (nonEmpty(blockSerial)) {
    for (let i = 0; i < usbClassified.length; i++) {
      if (claimed.has(i)) continue;
      const usb = usbClassified[i]!;
      const usbSerial = usb.device.serialNumber;
      if (nonEmpty(usbSerial) && usbSerial === blockSerial) {
        return { usb, index: i, matchedBy: 'serial' };
      }
    }
  }

  // Priority 2: disk-identifier match. Strip the partition suffix from BOTH
  // sides — system_profiler (macOS) sometimes emits `bsd_name: disk5s2` for
  // the partition rather than the whole disk, and the block side always
  // names a partition (`disk2s1` / `sdc1` / `mmcblk0p1`).
  const blockWholeDisk = stripPartitionSuffix(block.identifier);
  for (let i = 0; i < usbClassified.length; i++) {
    if (claimed.has(i)) continue;
    const usb = usbClassified[i]!;
    const usbDisk = usb.device.diskIdentifier;
    if (!nonEmpty(usbDisk)) continue;
    if (stripPartitionSuffix(usbDisk) === blockWholeDisk) {
      return { usb, index: i, matchedBy: 'disk-identifier' };
    }
  }

  return undefined;
}
