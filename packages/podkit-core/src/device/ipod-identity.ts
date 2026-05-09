/**
 * iPod identity assessment.
 *
 * Single entry point used by the CLI's `device add` flow (and any other
 * caller that needs a unified view of "what is this iPod and can we read its
 * identity from firmware") to compute everything needed to render device
 * identity, prompt the user, and decide whether to write SysInfoExtended —
 * before opening the iTunesDB.
 *
 * Pure I/O for *reading* — never writes. The CLI calls this first, displays
 * the result, prompts the user, and on confirmation calls
 * `ensureSysInfoExtended` directly to perform the write.
 *
 * Cascade order (most specific to least):
 *   1. SysInfoExtended on disk (firewireGuid + serial + modelNumStr)
 *   2. classic SysInfo `ModelNumStr` on disk
 *   3. USB product ID (always present when the device is plugged in)
 *
 * The result includes `model` (cascade-resolved IpodModel), `capabilities`
 * (table-derived), and `firmwareInquiry` describing whether SysInfoExtended
 * is present, missing, or unwritable (no USB fingerprint).
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveIpodModel,
  getChecksumTypeByModelNumber,
  type IpodChecksumType,
  type IpodModel,
} from '@podkit/devices-ipod';
import {
  readSysInfoExtended,
  SYSINFO_PATH,
  type SysInfoExtendedResult,
} from '@podkit/ipod-firmware';
import type { DeviceCapabilities } from '@podkit/device-types';

import { existsSync } from 'node:fs';
import { resolveUsbDeviceFromPath, hasCompleteUsbFingerprint } from './usb-discovery.js';
import type { CompleteUsbDevice } from './usb-discovery.js';
import { identifyCapabilities } from './resolve-capabilities.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Whether SysInfoExtended is present, can be obtained from firmware, or is out
 * of reach for this device on this host. Drives the device-add prompt copy.
 *
 * - `present`     — SIE on disk and parseable. No write needed.
 * - `missing`     — SIE absent or empty/unparseable, USB fingerprint complete
 *   enough to call `ensureSysInfoExtended`. Caller can offer to write.
 * - `unwritable`  — SIE absent and USB fingerprint not resolvable (path mode
 *   without an attached USB device, or the platform can't correlate). Caller
 *   should proceed with cascade-derived identity only.
 */
export type IpodFirmwareInquiryState = 'present' | 'missing' | 'unwritable';

export interface IpodIdentityAssessment {
  /** Cascade-resolved iPod model. `null` if no identifier (USB or disk) yields a match. */
  readonly model: IpodModel | null;
  /** Table-derived capabilities. `null` iff `model` is null. */
  readonly capabilities: DeviceCapabilities | null;
  /** Whether the device's database checksum type strictly requires SysInfoExtended (hash58/72/AB). */
  readonly needsChecksum: boolean;
  /** Resolved checksum type, when known. */
  readonly checksumType: IpodChecksumType | undefined;
  /** Inquiry state — drives the prompt. */
  readonly firmwareInquiry: IpodFirmwareInquiryState;
  /** Existing SysInfoExtended parse result, if present on disk. */
  readonly existing: SysInfoExtendedResult | null;
  /** USB fingerprint of the connected device, when complete enough to drive `ensureSysInfoExtended`. */
  readonly usbFingerprint: CompleteUsbDevice | null;
  /** ModelNumStr extracted from classic SysInfo on disk (e.g. `MA147`), when available. */
  readonly sysInfoModelNumber: string | undefined;
}

// =============================================================================
// Internal helpers
// =============================================================================

function readSysInfoModelNumber(mountPoint: string): string | undefined {
  const sysInfoPath = join(mountPoint, SYSINFO_PATH);
  if (!existsSync(sysInfoPath)) return undefined;
  try {
    const content = readFileSync(sysInfoPath, 'utf-8');
    const match = content.match(/ModelNumStr:\s*(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Assess an iPod's identity from disk + USB without writing anything.
 *
 * Reads SysInfoExtended (if any), classic SysInfo ModelNumStr (if any),
 * resolves USB fingerprint via path correlation, and cascades the lot
 * through `resolveIpodModel`. Returns model, capabilities, and inquiry
 * state suitable for displaying identity, prompting the user, and
 * deciding whether to invoke `ensureSysInfoExtended`.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param opts.usbResolver - Optional override of the USB-from-path resolver,
 *   for tests. Defaults to the production `resolveUsbDeviceFromPath`.
 */
export async function assessIpodIdentity(
  mountPoint: string,
  opts?: {
    usbResolver?: (path: string) => Promise<CompleteUsbDevice | null>;
  }
): Promise<IpodIdentityAssessment> {
  const existing = readSysInfoExtended(mountPoint);
  const sysInfoModelNumber = readSysInfoModelNumber(mountPoint);

  // USB resolution — gives us productId for cascade and bus/devnum for the
  // firmware inquiry transports. Returns null if path → USB correlation fails.
  let usbFingerprint: CompleteUsbDevice | null = null;
  if (opts?.usbResolver) {
    usbFingerprint = await opts.usbResolver(mountPoint);
  } else {
    const resolved = await resolveUsbDeviceFromPath(mountPoint);
    if (hasCompleteUsbFingerprint(resolved)) usbFingerprint = resolved;
  }

  // Cascade — feed everything we got off disk + USB into resolveIpodModel.
  const model = resolveIpodModel({
    modelNumStr: existing?.identity.modelNumStr ?? sysInfoModelNumber,
    serialNumber: existing?.identity.serialNumber,
    familyId: existing?.identity.familyId ?? null,
    productId: usbFingerprint?.productId,
  });

  const capabilities = model ? identifyCapabilities(model) : null;

  // Determine checksum type from the resolved model — preferred — or from the
  // classic SysInfo ModelNumStr lookup table when no model resolved.
  let checksumType: IpodChecksumType | undefined = model?.checksumType ?? undefined;
  if (!checksumType && sysInfoModelNumber) {
    const lookup = getChecksumTypeByModelNumber(sysInfoModelNumber);
    if (lookup) checksumType = lookup;
  }
  const needsChecksum =
    checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';

  // SIE inquiry state — present, writable-when-asked, or unwritable.
  let firmwareInquiry: IpodFirmwareInquiryState;
  if (existing?.present && existing.firewireGuid) {
    firmwareInquiry = 'present';
  } else if (usbFingerprint) {
    firmwareInquiry = 'missing';
  } else {
    firmwareInquiry = 'unwritable';
  }

  return {
    model,
    capabilities,
    needsChecksum,
    checksumType,
    firmwareInquiry,
    existing: existing ?? null,
    usbFingerprint,
    sysInfoModelNumber,
  };
}
