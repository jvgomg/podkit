/**
 * USB path-mode resolution
 *
 * Resolves a mount path to USB device fingerprint fields (vendorId, productId,
 * serialNumber, bus, devnum). Used by path-mode flows where the user supplied
 * a mount path rather than a configured device name and we need to correlate
 * the path back to a USB device for downstream firmware inquiry.
 *
 * - macOS: diskutil + system_profiler to correlate mount path → bsd_name → USB device.
 * - Linux: /proc/mounts → sysfs block device → walk parents to USB ancestor.
 *
 * Sibling to {@link ./usb-enumeration.ts}: that file enumerates the bus,
 * this file resolves a single path to a single device.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SubprocessRunner, UsbFingerprint } from '@podkit/device-types';
import { defaultSubprocessRunner } from '@podkit/device-types';
import { extractProductId, extractVendorId, parseLocationId } from './usb-enumeration.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Subset of {@link UsbFingerprint} returned by `resolveUsbDeviceFromPath`. */
export type ResolvedUsbDevice = Pick<
  UsbFingerprint,
  'vendorId' | 'productId' | 'serialNumber' | 'bus' | 'devnum'
>;

/**
 * A {@link ResolvedUsbDevice} narrowed to the shape required by the firmware
 * inquiry orchestrator: vendorId, productId, bus, and devnum all present.
 * macOS SCSI matches on vendorId+productId+serialNumber and Linux SCSI matches
 * on bus+devnum, so a partial fingerprint blocks one platform's transport.
 * `serialNumber` remains optional — macOS SCSI dispatch tolerates its absence,
 * just less precisely.
 */
export type CompleteUsbDevice = ResolvedUsbDevice & {
  vendorId: string;
  productId: string;
  bus: number;
  devnum: number;
};

/**
 * Type guard: does this {@link ResolvedUsbDevice} have a complete enough
 * fingerprint to drive the firmware inquiry orchestrator? Both platforms'
 * SCSI dispatch require the union of their match fields to be present —
 * see {@link CompleteUsbDevice}.
 */
export function hasCompleteUsbFingerprint(
  info: ResolvedUsbDevice | null
): info is CompleteUsbDevice {
  return (
    info !== null &&
    typeof info.vendorId === 'string' &&
    info.vendorId.length > 0 &&
    typeof info.productId === 'string' &&
    info.productId.length > 0 &&
    typeof info.bus === 'number' &&
    typeof info.devnum === 'number'
  );
}

// ── system_profiler types ────────────────────────────────────────────────────

interface SystemProfilerItem {
  vendor_id?: string;
  product_id?: string;
  serial_num?: string;
  location_id?: string;
  _items?: SystemProfilerItem[];
  Media?: Array<{ bsd_name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface SystemProfilerData {
  SPUSBDataType?: SystemProfilerItem[];
}

/**
 * Resolve USB device info (vendorId, productId, serial, bus, devnum) from a mount path.
 *
 * macOS: Runs diskutil + system_profiler to correlate mount path → bsd_name → USB device.
 * Linux: Parses /proc/mounts → sysfs block device → walks up to USB ancestor for VID/PID/serial/bus/devnum.
 *
 * vendorId and productId are returned as bare lowercase hex (UsbFingerprint
 * canonical form) when discovery succeeds. Bus/devnum/serialNumber may still
 * be absent when the platform layer cannot extract them. Never throws —
 * returns null on any failure.
 */
export async function resolveUsbDeviceFromPath(
  mountPath: string,
  options?: {
    platform?: string;
    /**
     * Injectable subprocess runner used by the macOS path (`diskutil` +
     * `system_profiler`). Defaults to the real `execFile`-backed runner.
     */
    subprocess?: SubprocessRunner;
  }
): Promise<ResolvedUsbDevice | null> {
  const platform = options?.platform ?? process.platform;
  const subprocess = options?.subprocess ?? defaultSubprocessRunner;

  try {
    switch (platform) {
      case 'darwin':
        return await resolveUsbDeviceFromPathMacOS(mountPath, subprocess);
      case 'linux':
        return await resolveUsbDeviceFromPathLinux(mountPath);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Find the block device for a mount path by parsing /proc/mounts.
 * Exported for testing.
 *
 * @returns Block device basename (e.g., "sda1") or null
 */
export function findBlockDeviceForMount(
  mountPath: string,
  procMountsContent: string
): string | null {
  const normalised =
    mountPath.endsWith('/') && mountPath !== '/' ? mountPath.slice(0, -1) : mountPath;

  for (const line of procMountsContent.split('\n')) {
    const parts = line.split(' ');
    if (parts.length < 2) continue;
    const device = parts[0]!;
    const mount = parts[1]!;
    if (mount === normalised && device.startsWith('/dev/')) {
      return path.basename(device);
    }
  }
  return null;
}

/**
 * Walk from a sysfs block device path up to the USB device ancestor.
 * Exported for testing.
 *
 * Starting from /sys/block/{dev}/device, follows the symlink and walks
 * parent directories until finding one that contains busnum+devnum files
 * (indicating a USB device node).
 *
 * @returns Absolute path to the USB device sysfs directory, or null
 */
export function findUsbAncestor(
  sysBlockDevicePath: string,
  fsAccess: {
    realpathSync: (p: string) => string;
    existsSync: (p: string) => boolean;
  } = fs
): string | null {
  let devicePath: string;
  try {
    devicePath = fsAccess.realpathSync(sysBlockDevicePath);
  } catch {
    return null;
  }

  let current = devicePath;
  const root = '/sys';
  while (current.length > root.length) {
    const busnumPath = path.join(current, 'busnum');
    const devnumPath = path.join(current, 'devnum');
    if (fsAccess.existsSync(busnumPath) && fsAccess.existsSync(devnumPath)) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

async function resolveUsbDeviceFromPathLinux(mountPath: string): Promise<ResolvedUsbDevice | null> {
  let procMounts: string;
  try {
    procMounts = fs.readFileSync('/proc/mounts', 'utf-8');
  } catch {
    return null;
  }

  const blockDev = findBlockDeviceForMount(mountPath, procMounts);
  if (!blockDev) return null;

  const baseDev = blockDev.replace(/\d+$/, '');

  const sysBlockDevice = `/sys/block/${baseDev}/device`;
  const usbDevicePath = findUsbAncestor(sysBlockDevice);
  if (!usbDevicePath) return null;

  const result: Partial<ResolvedUsbDevice> = {};

  try {
    const idVendor = fs.readFileSync(path.join(usbDevicePath, 'idVendor'), 'utf-8').trim();
    if (idVendor.length > 0) result.vendorId = idVendor.toLowerCase();
  } catch {
    /* not available */
  }

  try {
    const idProduct = fs.readFileSync(path.join(usbDevicePath, 'idProduct'), 'utf-8').trim();
    if (idProduct.length > 0) result.productId = idProduct.toLowerCase();
  } catch {
    /* not available */
  }

  try {
    const busnum = parseInt(
      fs.readFileSync(path.join(usbDevicePath, 'busnum'), 'utf-8').trim(),
      10
    );
    if (Number.isFinite(busnum)) result.bus = busnum;
  } catch {
    /* not available */
  }

  try {
    const devnum = parseInt(
      fs.readFileSync(path.join(usbDevicePath, 'devnum'), 'utf-8').trim(),
      10
    );
    if (Number.isFinite(devnum)) result.devnum = devnum;
  } catch {
    /* not available */
  }

  try {
    const serial = fs.readFileSync(path.join(usbDevicePath, 'serial'), 'utf-8').trim();
    if (serial.length > 0) result.serialNumber = serial;
  } catch {
    /* not available */
  }

  return Object.keys(result).length > 0 ? (result as ResolvedUsbDevice) : null;
}

async function resolveUsbDeviceFromPathMacOS(
  mountPath: string,
  subprocess: SubprocessRunner
): Promise<ResolvedUsbDevice | null> {
  const diskutilResult = await subprocess.run('diskutil', ['info', mountPath], {
    timeoutMs: 10_000,
  });
  if (diskutilResult.exitCode !== 0) return null;
  const diskutilOutput = diskutilResult.stdout;

  const deviceNodeMatch = diskutilOutput.match(/Device Node:\s*\/dev\/(disk\d+)/);
  if (!deviceNodeMatch) return null;
  const bsdNamePrefix = deviceNodeMatch[1]!;

  const spResult = await subprocess.run('system_profiler', ['SPUSBDataType', '-json'], {
    timeoutMs: 10_000,
  });
  if (spResult.exitCode !== 0) return null;
  const spOutput = spResult.stdout;

  const spData = JSON.parse(spOutput) as SystemProfilerData;
  if (!spData.SPUSBDataType) return null;

  function findDeviceByBsdName(items: SystemProfilerItem[]): SystemProfilerItem | undefined {
    for (const item of items) {
      if (Array.isArray(item.Media)) {
        for (const media of item.Media) {
          if (typeof media.bsd_name === 'string' && media.bsd_name === bsdNamePrefix) {
            return item;
          }
        }
      }
      if (Array.isArray(item._items)) {
        const found = findDeviceByBsdName(item._items);
        if (found) return found;
      }
    }
    return undefined;
  }

  let matchedItem: SystemProfilerItem | undefined;
  for (const bus of spData.SPUSBDataType) {
    if (Array.isArray(bus._items)) {
      matchedItem = findDeviceByBsdName(bus._items);
      if (matchedItem) break;
    }
  }

  if (!matchedItem) return null;

  const serialNumber =
    typeof matchedItem.serial_num === 'string' && matchedItem.serial_num.length > 0
      ? matchedItem.serial_num
      : undefined;
  const { busNumber, deviceAddress } = parseLocationId(matchedItem.location_id);

  const result: Partial<ResolvedUsbDevice> = {};

  if (typeof matchedItem.vendor_id === 'string') {
    result.vendorId = extractVendorId(matchedItem.vendor_id);
  }

  const productId = extractProductId(matchedItem.product_id);
  if (productId) result.productId = productId;

  if (serialNumber) result.serialNumber = serialNumber;
  if (busNumber !== undefined) result.bus = busNumber;
  if (deviceAddress !== undefined) result.devnum = deviceAddress;

  return Object.keys(result).length > 0 ? (result as ResolvedUsbDevice) : null;
}
