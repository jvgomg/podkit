/**
 * USB device discovery for iPods
 *
 * Discovers iPods connected via USB even when they have no disk representation
 * (unpartitioned/uninitialized devices). This supplements disk-based discovery
 * from diskutil/lsblk.
 *
 * Platform support:
 * - macOS: Queries system_profiler SPUSBDataType
 * - Linux: Reads /sys/bus/usb/devices/
 * - Others: Returns empty array (graceful degradation)
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lookupIpodModel } from './ipod-models.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UsbDiscoveredDevice {
  /** USB vendor ID (e.g., '0x05ac') */
  vendorId: string;
  /** USB product ID (e.g., '0x1209') */
  productId: string;
  /** Resolved model name from lookup table (e.g., 'iPod Classic 6th generation') */
  modelName?: string;
  /** Disk identifier if this USB device has a disk representation */
  diskIdentifier?: string;
  /** Whether this device model is supported by podkit */
  supported: boolean;
  /** Human-readable not-supported message for unsupported models */
  notSupportedReason?: string;
  /** USB serial number (= FirewireGuid for iPods, 16 hex chars) */
  serialNumber?: string;
  /** USB bus number (for libusb device addressing) */
  busNumber?: number;
  /** USB device address (for libusb device addressing) */
  deviceAddress?: number;
}

// ── Unsupported device definitions ───────────────────────────────────────────

const UNSUPPORTED_IPODS: Record<string, string> = {
  '0x1302':
    'iPod Shuffle 3rd/4th generation requires iTunes authentication and cannot be used with podkit.',
  '0x1303':
    'iPod Shuffle 3rd/4th generation requires iTunes authentication and cannot be used with podkit.',
  '0x120d': 'iPod Nano 6th generation uses a different database format not supported by libgpod.',
  '0x1266': 'iPod Nano 6th generation uses a different database format not supported by libgpod.',
};

/** Product ID ranges for iPod Touch / iOS devices */
const IPOD_TOUCH_IDS = ['0x1291', '0x1292', '0x1293', '0x129a', '0x12a0', '0x12ab', '0x12a8'];

const IPOD_TOUCH_REASON = "iPod Touch / iOS devices use Apple's proprietary sync protocol.";

function getUnsupportedReason(productId: string): string | undefined {
  const normalised = productId.toLowerCase();
  if (UNSUPPORTED_IPODS[normalised]) {
    return UNSUPPORTED_IPODS[normalised];
  }
  if (IPOD_TOUCH_IDS.includes(normalised)) {
    return IPOD_TOUCH_REASON;
  }
  return undefined;
}

// ── Apple vendor ID matching ─────────────────────────────────────────────────

const APPLE_VENDOR_ID = '0x05ac';

function isAppleVendorId(vendorId: string): boolean {
  const lower = vendorId.toLowerCase();
  return lower === APPLE_VENDOR_ID || lower.startsWith('0x05ac ') || lower === 'apple_vendor_id';
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
 * Parse system_profiler SPUSBDataType JSON output into discovered USB devices.
 * Exported for testing.
 */
export function parseSystemProfilerUsbData(data: unknown): UsbDiscoveredDevice[] {
  const results: UsbDiscoveredDevice[] = [];

  if (!data || typeof data !== 'object') return results;

  const spData = data as SystemProfilerData;
  const buses = spData.SPUSBDataType;
  if (!Array.isArray(buses)) return results;

  function walkItems(items: SystemProfilerItem[]): void {
    for (const item of items) {
      // Check if this is an Apple device
      if (item.vendor_id && isAppleVendorId(item.vendor_id)) {
        const productId = extractProductId(item.product_id);
        if (productId) {
          const modelName = lookupIpodModel(productId);
          if (modelName) {
            // It's a known iPod — check if supported
            const unsupportedReason = getUnsupportedReason(productId);
            const diskIdentifier = extractBsdName(item);
            const serialNumber = extractSerialNumber(item);
            const { busNumber, deviceAddress } = parseLocationId(item.location_id);

            results.push({
              vendorId: APPLE_VENDOR_ID,
              productId,
              modelName,
              ...(diskIdentifier ? { diskIdentifier } : {}),
              supported: !unsupportedReason,
              ...(unsupportedReason ? { notSupportedReason: unsupportedReason } : {}),
              ...(serialNumber ? { serialNumber } : {}),
              ...(busNumber !== undefined ? { busNumber } : {}),
              ...(deviceAddress !== undefined ? { deviceAddress } : {}),
            });
          }
          // Non-iPod Apple devices (iPhones, iPads, AirPods) are silently ignored
        }
      }

      // Recurse into nested items (USB hubs)
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

/** Extract a normalised product ID like "0x1209" from system_profiler strings */
function extractProductId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // system_profiler may return "0x1209" or "0x1209 (some text)"
  const match = raw.match(/0x[\da-fA-F]+/);
  return match ? match[0].toLowerCase() : undefined;
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
 */
export function parseLocationId(locationId: string | undefined): {
  busNumber?: number;
  deviceAddress?: number;
} {
  if (!locationId || typeof locationId !== 'string') return {};

  const match = locationId.match(/^0x([\da-fA-F]+)\s*\/\s*(\d+)$/);
  if (!match) {
    // Try format without device address: "0x03100000"
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

async function discoverMacOS(): Promise<UsbDiscoveredDevice[]> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'system_profiler',
        ['SPUSBDataType', '-json'],
        { timeout: 10_000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    const data: unknown = JSON.parse(stdout);
    return parseSystemProfilerUsbData(data);
  } catch {
    // system_profiler not available or failed — graceful degradation
    return [];
  }
}

// ── Linux implementation ─────────────────────────────────────────────────────

export interface SysfsUsbDevice {
  idVendor: string;
  idProduct: string;
  busnum?: string;
  devnum?: string;
  serial?: string;
}

/**
 * Parse sysfs USB device entries into discovered USB devices.
 * Exported for testing.
 */
export function parseSysfsUsbDevices(deviceDirs: SysfsUsbDevice[]): UsbDiscoveredDevice[] {
  const results: UsbDiscoveredDevice[] = [];

  for (const device of deviceDirs) {
    const vendorId = `0x${device.idVendor.toLowerCase()}`;
    if (vendorId !== APPLE_VENDOR_ID) continue;

    const productId = `0x${device.idProduct.toLowerCase()}`;
    const modelName = lookupIpodModel(productId);
    if (!modelName) continue;

    const unsupportedReason = getUnsupportedReason(productId);
    const busNumber = device.busnum ? parseInt(device.busnum, 10) : undefined;
    const deviceAddress = device.devnum ? parseInt(device.devnum, 10) : undefined;
    const serialNumber = device.serial && device.serial.length > 0 ? device.serial : undefined;

    results.push({
      vendorId: APPLE_VENDOR_ID,
      productId,
      modelName,
      // No disk identifier available from sysfs easily
      supported: !unsupportedReason,
      ...(unsupportedReason ? { notSupportedReason: unsupportedReason } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      ...(Number.isFinite(busNumber) ? { busNumber } : {}),
      ...(Number.isFinite(deviceAddress) ? { deviceAddress } : {}),
    });
  }

  return results;
}

async function discoverLinux(): Promise<UsbDiscoveredDevice[]> {
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

        // Read optional sysfs fields for bus/device/serial
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
    // /sys/bus/usb/devices doesn't exist or permission denied — graceful degradation
    return [];
  }
}

// ── Path-to-USB correlation ─────────────────────────────────────────────────

/**
 * Resolve USB device info (bus number, device address, serial) from a mount path.
 *
 * macOS: Runs diskutil + system_profiler to correlate mount path → bsd_name → USB device.
 * Linux: Parses /proc/mounts → sysfs block device → walks up to USB ancestor for bus/address/serial.
 *
 * Never throws — returns null on any failure.
 */
export async function resolveUsbDeviceFromPath(
  mountPath: string,
  options?: { platform?: string }
): Promise<Pick<UsbDiscoveredDevice, 'busNumber' | 'deviceAddress' | 'serialNumber'> | null> {
  const platform = options?.platform ?? process.platform;

  try {
    switch (platform) {
      case 'darwin':
        return await resolveUsbDeviceFromPathMacOS(mountPath);
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
  // Normalise trailing slash for comparison
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

  // Walk up from the resolved device path looking for busnum + devnum
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

async function resolveUsbDeviceFromPathLinux(
  mountPath: string
): Promise<Pick<UsbDiscoveredDevice, 'busNumber' | 'deviceAddress' | 'serialNumber'> | null> {
  // Step 1: Find block device from /proc/mounts
  let procMounts: string;
  try {
    procMounts = fs.readFileSync('/proc/mounts', 'utf-8');
  } catch {
    return null;
  }

  const blockDev = findBlockDeviceForMount(mountPath, procMounts);
  if (!blockDev) return null;

  // Strip partition suffix (sda1 → sda) for sysfs lookup
  const baseDev = blockDev.replace(/\d+$/, '');

  // Step 2: Follow /sys/block/{dev}/device symlink up to USB device
  const sysBlockDevice = `/sys/block/${baseDev}/device`;
  const usbDevicePath = findUsbAncestor(sysBlockDevice);
  if (!usbDevicePath) return null;

  // Step 3: Read USB device attributes
  const result: Pick<UsbDiscoveredDevice, 'busNumber' | 'deviceAddress' | 'serialNumber'> = {};

  try {
    const busnum = parseInt(
      fs.readFileSync(path.join(usbDevicePath, 'busnum'), 'utf-8').trim(),
      10
    );
    if (Number.isFinite(busnum)) result.busNumber = busnum;
  } catch {
    /* not available */
  }

  try {
    const devnum = parseInt(
      fs.readFileSync(path.join(usbDevicePath, 'devnum'), 'utf-8').trim(),
      10
    );
    if (Number.isFinite(devnum)) result.deviceAddress = devnum;
  } catch {
    /* not available */
  }

  try {
    const serial = fs.readFileSync(path.join(usbDevicePath, 'serial'), 'utf-8').trim();
    if (serial.length > 0) result.serialNumber = serial;
  } catch {
    /* not available */
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function resolveUsbDeviceFromPathMacOS(
  mountPath: string
): Promise<Pick<UsbDiscoveredDevice, 'busNumber' | 'deviceAddress' | 'serialNumber'> | null> {
  // Step 1: Get BSD name from diskutil info
  const diskutilOutput = await new Promise<string>((resolve, reject) => {
    execFile('diskutil', ['info', mountPath], { timeout: 10_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

  // Extract "Device Node: /dev/disk5s2" → "disk5s2", then strip partition suffix → "disk5"
  const deviceNodeMatch = diskutilOutput.match(/Device Node:\s*\/dev\/(disk\d+)/);
  if (!deviceNodeMatch) return null;
  const bsdNamePrefix = deviceNodeMatch[1]!;

  // Step 2: Get system_profiler USB data
  const spOutput = await new Promise<string>((resolve, reject) => {
    execFile(
      'system_profiler',
      ['SPUSBDataType', '-json'],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });

  const spData = JSON.parse(spOutput) as SystemProfilerData;
  if (!spData.SPUSBDataType) return null;

  // Step 3: Walk USB tree to find device with matching bsd_name
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

  const serialNumber = extractSerialNumber(matchedItem);
  const { busNumber, deviceAddress } = parseLocationId(matchedItem.location_id);

  const result: Pick<UsbDiscoveredDevice, 'busNumber' | 'deviceAddress' | 'serialNumber'> = {};
  if (serialNumber) result.serialNumber = serialNumber;
  if (busNumber !== undefined) result.busNumber = busNumber;
  if (deviceAddress !== undefined) result.deviceAddress = deviceAddress;

  return Object.keys(result).length > 0 ? result : null;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Discover iPods connected via USB subsystem.
 *
 * Finds iPods even when they have no disk representation (unpartitioned
 * or uninitialized devices). Results include both supported and unsupported
 * iPod models.
 *
 * Never throws — returns an empty array on any failure.
 *
 * @param options.platform - Override platform detection (for testing)
 */
export async function discoverUsbIpods(options?: {
  platform?: string;
}): Promise<UsbDiscoveredDevice[]> {
  const platform = options?.platform ?? process.platform;

  try {
    switch (platform) {
      case 'darwin':
        return await discoverMacOS();
      case 'linux':
        return await discoverLinux();
      default:
        return [];
    }
  } catch {
    // Never throw from discovery
    return [];
  }
}
