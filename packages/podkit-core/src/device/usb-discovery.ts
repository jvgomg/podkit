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
}

// ── Unsupported device definitions ───────────────────────────────────────────

const UNSUPPORTED_IPODS: Record<string, string> = {
  '0x1302':
    'iPod Shuffle 3rd/4th generation requires iTunes authentication and cannot be used with podkit.',
  '0x1303':
    'iPod Shuffle 3rd/4th generation requires iTunes authentication and cannot be used with podkit.',
  '0x120d': 'iPod Nano 6th generation uses a different database format not supported by libgpod.',
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

            results.push({
              vendorId: APPLE_VENDOR_ID,
              productId,
              modelName,
              ...(diskIdentifier ? { diskIdentifier } : {}),
              supported: !unsupportedReason,
              ...(unsupportedReason ? { notSupportedReason: unsupportedReason } : {}),
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

interface SysfsUsbDevice {
  idVendor: string;
  idProduct: string;
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

    results.push({
      vendorId: APPLE_VENDOR_ID,
      productId,
      modelName,
      // No disk identifier available from sysfs easily
      supported: !unsupportedReason,
      ...(unsupportedReason ? { notSupportedReason: unsupportedReason } : {}),
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
        devices.push({ idVendor, idProduct });
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
