/**
 * SysInfoExtended orchestrator.
 *
 * Coordinates reading SysInfoExtended from iPod firmware via USB and writing
 * it to the device filesystem. Also parses existing SysInfoExtended files
 * to extract device identity information.
 *
 * SysInfoExtended is an Apple plist XML file stored at
 * `iPod_Control/Device/SysInfoExtended` on the iPod filesystem. It contains
 * device identity fields (FireWireGUID, SerialNumber, FamilyID, etc.) that
 * are needed for proper database initialization and checksum generation.
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import { lookupIpodModelBySerial, getChecksumType } from './ipod-models.js';
import type { IpodGenerationId } from './ipod-models.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Result of attempting to ensure SysInfoExtended is present */
export interface SysInfoExtendedResult {
  /** Whether SysInfoExtended is now present on the device */
  present: boolean;
  /** How the result was obtained */
  source: 'existing' | 'usb-read' | 'unavailable';
  /** Extracted device identity (when present) */
  deviceInfo?: {
    firewireGuid: string;
    serialNumber: string;
    modelName?: string;
    generationId?: IpodGenerationId;
    checksumType?: 'none' | 'hash58' | 'hash72' | 'hashAB';
  };
  /** Error message when source is 'unavailable' */
  error?: string;
}

/** USB device addressing for SysInfoExtended reads */
export interface UsbDeviceAddress {
  busNumber: number;
  deviceAddress: number;
}

/** Function signature for reading SysInfoExtended from USB (for dependency injection in tests) */
export type ReadFromUsbFn = (busNumber: number, deviceAddress: number) => string | null;

// ── Constants ───────────────────────────────────────────────────────────────

const SYSINFO_EXTENDED_PATH = join('iPod_Control', 'Device', 'SysInfoExtended');
const DEVICE_DIR = join('iPod_Control', 'Device');

// ── XML extraction ──────────────────────────────────────────────────────────

/**
 * Extract a string value from plist XML by key name.
 * Handles `<key>Name</key>\s*<string>Value</string>` patterns.
 */
function extractPlistString(xml: string, key: string): string | undefined {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, 'i');
  const match = xml.match(pattern);
  return match?.[1];
}

/**
 * Extract device identity fields from SysInfoExtended XML.
 */
function extractDeviceInfo(xml: string): SysInfoExtendedResult['deviceInfo'] | undefined {
  // Try both casing variants for FireWireGUID
  const firewireGuid =
    extractPlistString(xml, 'FireWireGUID') ?? extractPlistString(xml, 'FirewireGuid');

  const serialNumber = extractPlistString(xml, 'SerialNumber');

  if (!firewireGuid || !serialNumber) {
    return undefined;
  }

  const info: NonNullable<SysInfoExtendedResult['deviceInfo']> = {
    firewireGuid,
    serialNumber,
  };

  // Look up model from last 3 chars of serial number
  if (serialNumber.length >= 3) {
    const suffix = serialNumber.slice(-3);
    const model = lookupIpodModelBySerial(suffix);
    if (model) {
      info.modelName = model.displayName;
      info.generationId = model.generation;
      info.checksumType = getChecksumType(model.generation as IpodGenerationId);
    }
  }

  return info;
}

/**
 * Validate that SysInfoExtended XML contains the required identity keys.
 */
function validateXml(xml: string): { valid: boolean; error?: string } {
  const hasFirewireGuid =
    extractPlistString(xml, 'FireWireGUID') !== undefined ||
    extractPlistString(xml, 'FirewireGuid') !== undefined;
  const hasSerial = extractPlistString(xml, 'SerialNumber') !== undefined;

  if (!hasFirewireGuid || !hasSerial) {
    return {
      valid: false,
      error: 'Device returned incomplete identity data',
    };
  }

  return { valid: true };
}

// ── Default USB reader ──────────────────────────────────────────────────────

/**
 * Create the default USB reader function.
 * Returns null if native bindings are not available.
 */
function getDefaultUsbReader(): ReadFromUsbFn | null {
  try {
    // Dynamic import to avoid hard dependency on native bindings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const libgpod = require('@podkit/libgpod-node');
    if (typeof libgpod.isNativeAvailable === 'function' && !libgpod.isNativeAvailable()) {
      return null;
    }
    if (typeof libgpod.readSysInfoExtendedFromUsb === 'function') {
      return libgpod.readSysInfoExtendedFromUsb;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read and parse an existing SysInfoExtended file from an iPod.
 * Returns null if file doesn't exist or is empty.
 *
 * This is useful for the readiness pipeline to check without triggering a USB read.
 */
export function readSysInfoExtended(mountPoint: string): SysInfoExtendedResult | null {
  const filePath = join(mountPoint, SYSINFO_EXTENDED_PATH);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (!content.trim()) {
    return null;
  }

  const deviceInfo = extractDeviceInfo(content);
  return {
    present: true,
    source: 'existing',
    deviceInfo,
  };
}

/**
 * Ensure SysInfoExtended is present on an iPod's filesystem.
 *
 * If already present, reads and parses it. If missing, reads from USB
 * firmware and writes to disk. Returns extracted device identity info.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param usbAddress - USB bus number and device address
 * @param readFromUsb - Optional USB reader function (for testing). Defaults to libgpod-node binding.
 */
export async function ensureSysInfoExtended(
  mountPoint: string,
  usbAddress: UsbDeviceAddress,
  readFromUsb?: ReadFromUsbFn
): Promise<SysInfoExtendedResult> {
  // Step 1: Check if file already exists
  const existing = readSysInfoExtended(mountPoint);
  if (existing) {
    return existing;
  }

  // Step 2: Resolve USB reader
  const reader = readFromUsb ?? getDefaultUsbReader();
  if (!reader) {
    return {
      present: false,
      source: 'unavailable',
      error: 'Native bindings not available for USB device read',
    };
  }

  // Step 3: Read from USB
  const xml = reader(usbAddress.busNumber, usbAddress.deviceAddress);
  if (!xml) {
    return {
      present: false,
      source: 'unavailable',
      error: 'Could not read device identity from USB',
    };
  }

  // Step 4: Validate XML
  const validation = validateXml(xml);
  if (!validation.valid) {
    return {
      present: false,
      source: 'unavailable',
      error: validation.error,
    };
  }

  // Step 5: Write to disk
  const deviceDir = join(mountPoint, DEVICE_DIR);
  fs.mkdirSync(deviceDir, { recursive: true });
  fs.writeFileSync(join(mountPoint, SYSINFO_EXTENDED_PATH), xml, 'utf-8');

  // Step 6: Extract device info and return
  const deviceInfo = extractDeviceInfo(xml);
  return {
    present: true,
    source: 'usb-read',
    deviceInfo,
  };
}
