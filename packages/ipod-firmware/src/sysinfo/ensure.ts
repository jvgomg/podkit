/**
 * SysInfoExtended orchestrator.
 *
 * Coordinates reading SysInfoExtended from iPod firmware via USB and writing
 * it to the device filesystem.
 *
 * SysInfoExtended is an Apple plist XML file stored at
 * `iPod_Control/Device/SysInfoExtended` on the iPod filesystem. It contains
 * device identity fields (FireWireGUID, SerialNumber, FamilyID, etc.) that
 * are needed for proper database initialization and checksum generation.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';
import { inquireFirmware } from '../inquiry/orchestrator.js';
import { readSysInfoExtended, validateXml, extractIdentity } from './read.js';
import { writeSysInfoExtended } from './write.js';
import type { SysInfoExtendedResult, ModelResolver } from './read.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** USB device addressing for SysInfoExtended reads */
export interface UsbDeviceAddress {
  busNumber: number;
  deviceAddress: number;
}

/** Function signature for reading SysInfoExtended from USB (for dependency injection in tests) */
export type ReadFromUsbFn = (busNumber: number, deviceAddress: number) => string | null;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run the inquiry orchestrator against a USB device address.
 *
 * Only `bus` and `devnum` are populated on the {@link UsbFingerprint} here —
 * those are the fields the Linux SCSI path needs to derive `/dev/sgN`. macOS
 * SCSI also benefits from `vendorId`/`productId`, but the libgpod USB shim
 * does not require them, and `ensureSysInfoExtended`'s caller does not
 * currently provide them. TODO(P2): thread vendorId/productId/serialNumber
 * through the call sites to enable cross-platform SCSI fingerprinting.
 */
async function inquireViaOrchestrator(
  busNumber: number,
  deviceAddress: number
): Promise<string | null> {
  const fp: UsbFingerprint = {
    vendorId: '',
    productId: '',
    bus: busNumber,
    devnum: deviceAddress,
  };
  const result = await inquireFirmware(fp);
  return result?.rawXml ?? null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure SysInfoExtended is present on an iPod's filesystem.
 *
 * If already present, reads and parses it. If missing, reads from USB
 * firmware and writes to disk. Returns extracted device identity info.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param usbAddress - USB bus number and device address
 * @param readFromUsb - Optional USB reader function (for testing). Defaults to
 *   the @podkit/ipod-firmware inquiry orchestrator.
 * @param resolveModel - Optional callback to resolve an IpodModel from a serial
 *   number. Callers with access to `@podkit/devices-ipod` should pass
 *   `(sn) => identify({ from: 'serial', serialNumber: sn })`.
 *   When omitted, `result.model` is always undefined.
 */
export async function ensureSysInfoExtended(
  mountPoint: string,
  usbAddress: UsbDeviceAddress,
  readFromUsb?: ReadFromUsbFn,
  resolveModel?: ModelResolver
): Promise<SysInfoExtendedResult> {
  // Step 1: Check if file already exists
  const existing = readSysInfoExtended(mountPoint, resolveModel);
  if (existing) {
    return existing;
  }

  // Step 2: Read SysInfoExtended XML.
  //
  // When `readFromUsb` is supplied, use it directly — this preserves the
  // existing test injection point (tests pass a mock that returns/throws
  // synthetic XML and assert on the surfaced error path).
  //
  // When `readFromUsb` is omitted (production), delegate to the
  // @podkit/ipod-firmware orchestrator, which probes USB and SCSI transports
  // and falls back transparently. The orchestrator never throws — it returns
  // null on any transport or parse failure.
  let xml: string | null;
  try {
    if (readFromUsb) {
      xml = readFromUsb(usbAddress.busNumber, usbAddress.deviceAddress);
    } else {
      xml = await inquireViaOrchestrator(usbAddress.busNumber, usbAddress.deviceAddress);
    }
  } catch (err) {
    return {
      present: false,
      source: 'unavailable',
      error: err instanceof Error ? err.message : 'Could not read device identity from USB',
    };
  }
  if (!xml) {
    return {
      present: false,
      source: 'unavailable',
      error: 'Could not read device identity from USB',
    };
  }

  // Step 3: Validate XML
  const validation = validateXml(xml);
  if (!validation.valid) {
    return {
      present: false,
      source: 'unavailable',
      error: validation.error,
    };
  }

  // Step 4: Write to disk
  writeSysInfoExtended(mountPoint, xml);

  // Step 5: Extract device info and return
  const identity = extractIdentity(xml);
  const model = identity && resolveModel ? resolveModel(identity.serialNumber) : undefined;

  return {
    present: true,
    source: 'usb-read',
    model,
    firewireGuid: identity?.firewireGuid,
    serialNumber: identity?.serialNumber,
  };
}

export type { SysInfoExtendedResult, ModelResolver } from './read.js';
