/**
 * USB device enumeration
 *
 * Pure USB enumeration. Knows only USB. Returns platform-agnostic descriptors
 * carrying vendor/product/serial/bus/devnum (and `diskIdentifier` when the
 * device exposes a mass-storage volume) — nothing else. Classification of
 * devices into iPods, mass-storage DAPs, etc. is the responsibility of
 * separate classifier modules in the `@podkit/devices-*` packages, composed
 * via `classifyUsbDevices` in `./classify.ts`.
 *
 * Platform support:
 * - macOS: Queries system_profiler SPUSBDataType
 * - Linux: Reads /sys/bus/usb/devices/
 * - Others: Returns empty array (graceful degradation)
 *
 * Never throws — returns an empty array on any failure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SubprocessRunner } from '@podkit/device-types';
import { defaultSubprocessRunner } from '../subprocess-runner.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A single USB device found by enumerating the OS USB tree.
 *
 * `vendorId` / `productId` are bare-hex strings (no `0x` prefix), lowercased
 * — the canonical form used by `UsbFingerprint` in `@podkit/device-types`.
 *
 * Platform-agnostic: produced by both the macOS (system_profiler) and Linux
 * (sysfs) walks. No iPod-domain or mass-storage-domain fields.
 */
export interface EnumeratedUsbDevice {
  /** USB vendor ID — bare lower-case hex, e.g. `"05ac"` */
  vendorId: string;
  /** USB product ID — bare lower-case hex, e.g. `"1261"` */
  productId: string;
  /** USB serial number string, when reported by the device */
  serialNumber?: string;
  /** USB bus number — optional; absent in some discovery contexts */
  bus?: number;
  /** Device number on the bus — optional; absent in some discovery contexts */
  devnum?: number;
  /** BSD/block-device name when the device exposes a mass-storage volume */
  diskIdentifier?: string;
}

// ── macOS implementation ─────────────────────────────────────────────────────

interface SystemProfilerItem {
  _name?: string;
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
 * Parse system_profiler SPUSBDataType JSON output into enumerated USB devices.
 * Exported for testing.
 */
export function parseSystemProfilerUsbData(data: unknown): EnumeratedUsbDevice[] {
  const results: EnumeratedUsbDevice[] = [];

  if (!data || typeof data !== 'object') return results;

  const spData = data as SystemProfilerData;
  const buses = spData.SPUSBDataType;
  if (!Array.isArray(buses)) return results;

  function walkItems(items: SystemProfilerItem[]): void {
    for (const item of items) {
      if (item.vendor_id) {
        const productId = extractProductId(item.product_id);
        if (productId) {
          const vendorId = extractVendorId(item.vendor_id);

          const diskIdentifier = extractBsdName(item);
          const serialNumber = extractSerialNumber(item);
          const { busNumber, deviceAddress } = parseLocationId(item.location_id);

          const entry: EnumeratedUsbDevice = {
            vendorId,
            productId,
            ...(serialNumber ? { serialNumber } : {}),
            ...(busNumber !== undefined ? { bus: busNumber } : {}),
            ...(deviceAddress !== undefined ? { devnum: deviceAddress } : {}),
            ...(diskIdentifier ? { diskIdentifier } : {}),
          };
          results.push(entry);
        }
      }

      if (Array.isArray(item._items)) {
        walkItems(item._items);
      }
    }
  }

  for (const bus of buses) {
    if (Array.isArray(bus._items)) {
      walkItems(bus._items);
    }
  }

  return results;
}

/** Bare-hex Apple vendor ID (canonical form used by `extractVendorId`). */
const APPLE_VENDOR_ID = '05ac';

function isAppleVendorId(vendorId: string): boolean {
  const lower = vendorId.toLowerCase();
  return (
    lower === APPLE_VENDOR_ID ||
    lower === '0x05ac' ||
    lower.startsWith('0x05ac ') ||
    lower === 'apple_vendor_id'
  );
}

/**
 * Extract a bare-hex product ID (e.g. `"1209"`) from a system_profiler
 * `product_id` string. Returns the hex digits only — no `0x` prefix.
 *
 * system_profiler may return `"0x1209"` or `"0x1209 (some text)"`.
 *
 * Exported for testing.
 */
export function extractProductId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/0x([\da-fA-F]+)/);
  if (!match) return undefined;
  return match[1]!.toLowerCase();
}

/**
 * Extract a bare-hex vendor ID from a system_profiler `vendor_id` string,
 * which may be prefixed (`"0x05ac"`), suffixed with text (`"0x05ac (Apple)"`),
 * or the literal sentinel `"apple_vendor_id"`. Returns the bare-hex digits;
 * falls back to {@link APPLE_VENDOR_ID} for the Apple sentinel and to a
 * lowercased copy of the raw string when the input matches no known shape.
 *
 * Exported for testing.
 */
export function extractVendorId(raw: string): string {
  const match = raw.match(/0x([\da-fA-F]+)/);
  if (match) return match[1]!.toLowerCase();
  if (isAppleVendorId(raw)) return APPLE_VENDOR_ID;
  return raw.toLowerCase();
}

/** Extract bsd_name from the Media subtree of a system_profiler item */
function extractBsdName(item: SystemProfilerItem): string | undefined {
  if (!Array.isArray(item.Media)) return undefined;
  for (const media of item.Media) {
    if (media.bsd_name && typeof media.bsd_name === 'string') {
      return media.bsd_name;
    }
  }
  return undefined;
}

/** Extract serial_num from a system_profiler item (16 hex chars for iPods) */
function extractSerialNumber(item: SystemProfilerItem): string | undefined {
  if (typeof item.serial_num === 'string' && item.serial_num.length > 0) {
    return item.serial_num;
  }
  return undefined;
}

/**
 * Parse location_id from system_profiler into bus number and device address.
 * Format: "0x03100000 / 14" → { busNumber: 3, deviceAddress: 14 }
 * The top byte of the hex value is the bus number; the number after " / " is the device address.
 *
 * Exported for testing.
 */
export function parseLocationId(locationId: string | undefined): {
  busNumber?: number;
  deviceAddress?: number;
} {
  if (!locationId || typeof locationId !== 'string') return {};

  const match = locationId.match(/^0x([\da-fA-F]+)\s*\/\s*(\d+)$/);
  if (!match) {
    const hexOnly = locationId.match(/^0x([\da-fA-F]+)$/);
    if (hexOnly) {
      const hexValue = parseInt(hexOnly[1]!, 16);
      const busNumber = (hexValue >> 24) & 0xff;
      return busNumber > 0 ? { busNumber } : {};
    }
    return {};
  }

  const hexValue = parseInt(match[1]!, 16);
  const busNumber = (hexValue >> 24) & 0xff;
  const deviceAddress = parseInt(match[2]!, 10);

  return {
    ...(busNumber > 0 ? { busNumber } : {}),
    ...(Number.isFinite(deviceAddress) ? { deviceAddress } : {}),
  };
}

async function enumerateMacOS(subprocess: SubprocessRunner): Promise<EnumeratedUsbDevice[]> {
  try {
    const { stdout, exitCode } = await subprocess.run(
      'system_profiler',
      ['SPUSBDataType', '-json'],
      { timeoutMs: 10_000 }
    );
    if (exitCode !== 0) return [];

    const data: unknown = JSON.parse(stdout);
    const parsed = parseSystemProfilerUsbData(data);
    return dropStaleDiskReferences(parsed);
  } catch {
    return [];
  }
}

/**
 * Drop entries whose `diskIdentifier` references a `/dev/<name>` that does not
 * exist on the system. macOS (via system_profiler / IOKit) can hold ghost USB
 * references after a device is unplugged, sometimes splitting one ghost device
 * into multiple entries pointing at stale `bsd_name`s like `disk6` / `disk7`.
 * Real plugged-in devices that expose a volume always have a corresponding
 * `/dev/<name>`; entries that don't are stale and would surface as phantoms in
 * downstream classification.
 *
 * Entries with no `diskIdentifier` are not affected — they're USB-only (e.g.,
 * iOS devices or iPods that aren't in disk mode) and disk-presence isn't a
 * meaningful check for them.
 *
 * Exported for testing.
 */
export function dropStaleDiskReferences(
  devices: EnumeratedUsbDevice[],
  existsSync: (path: string) => boolean = fs.existsSync
): EnumeratedUsbDevice[] {
  return devices.filter((d) => {
    if (!d.diskIdentifier) return true;
    return existsSync(`/dev/${d.diskIdentifier}`);
  });
}

// ── Linux implementation ─────────────────────────────────────────────────────

/** Raw sysfs USB device fields, as read from /sys/bus/usb/devices/. */
export interface SysfsUsbDevice {
  idVendor: string;
  idProduct: string;
  busnum?: string;
  devnum?: string;
  serial?: string;
}

/**
 * Parse sysfs USB device entries into enumerated USB devices.
 * Exported for testing.
 */
export function parseSysfsUsbDevices(deviceDirs: SysfsUsbDevice[]): EnumeratedUsbDevice[] {
  const results: EnumeratedUsbDevice[] = [];

  for (const device of deviceDirs) {
    const vendorId = device.idVendor.toLowerCase();
    const productId = device.idProduct.toLowerCase();

    const busNumber = device.busnum ? parseInt(device.busnum, 10) : undefined;
    const deviceAddress = device.devnum ? parseInt(device.devnum, 10) : undefined;
    const serialNumber = device.serial && device.serial.length > 0 ? device.serial : undefined;

    results.push({
      vendorId,
      productId,
      ...(serialNumber ? { serialNumber } : {}),
      ...(Number.isFinite(busNumber) ? { bus: busNumber } : {}),
      ...(Number.isFinite(deviceAddress) ? { devnum: deviceAddress } : {}),
    });
  }

  return results;
}

async function enumerateLinux(): Promise<EnumeratedUsbDevice[]> {
  const sysfsPath = '/sys/bus/usb/devices';

  try {
    const entries = fs.readdirSync(sysfsPath);
    const devices: SysfsUsbDevice[] = [];

    for (const entry of entries) {
      const deviceDir = path.join(sysfsPath, entry);
      const vendorPath = path.join(deviceDir, 'idVendor');
      const productPath = path.join(deviceDir, 'idProduct');

      try {
        const idVendor = fs.readFileSync(vendorPath, 'utf-8').trim();
        const idProduct = fs.readFileSync(productPath, 'utf-8').trim();

        let busnum: string | undefined;
        let devnum: string | undefined;
        let serial: string | undefined;
        try {
          busnum = fs.readFileSync(path.join(deviceDir, 'busnum'), 'utf-8').trim();
        } catch {
          /* not always present */
        }
        try {
          devnum = fs.readFileSync(path.join(deviceDir, 'devnum'), 'utf-8').trim();
        } catch {
          /* not always present */
        }
        try {
          serial = fs.readFileSync(path.join(deviceDir, 'serial'), 'utf-8').trim();
        } catch {
          /* not always present */
        }

        devices.push({ idVendor, idProduct, busnum, devnum, serial });
      } catch {
        // Not all entries have idVendor/idProduct (e.g., hub ports) — skip
        continue;
      }
    }

    return parseSysfsUsbDevices(devices);
  } catch {
    return [];
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Enumerate every USB device visible to the OS.
 *
 * Pure enumeration: returns vendor/product/serial/bus/devnum/diskIdentifier
 * for every device on the bus, without any iPod- or mass-storage-domain
 * classification. Pass the result through `classifyUsbDevices` (in
 * `./classify.ts`) to identify recognised device types.
 *
 * Never throws — returns an empty array on any failure.
 *
 * @param options.platform - Override platform detection (for testing)
 */
export async function enumerateUsb(options?: {
  platform?: string;
  /**
   * Injectable subprocess runner used by the macOS path (`system_profiler`).
   * Defaults to the real `execFile`-backed runner; tests inject a fake
   * `SubprocessRunner` (e.g. a hand-rolled stub returning canned stdout).
   */
  subprocess?: SubprocessRunner;
}): Promise<EnumeratedUsbDevice[]> {
  const platform = options?.platform ?? process.platform;
  const subprocess = options?.subprocess ?? defaultSubprocessRunner;

  try {
    switch (platform) {
      case 'darwin':
        return await enumerateMacOS(subprocess);
      case 'linux':
        return await enumerateLinux();
      default:
        return [];
    }
  } catch {
    return [];
  }
}
