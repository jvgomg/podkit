/**
 * Firmware-derived identity for diagnostic checks.
 *
 * Several checks need to know what the *hardware* says it is, independently of
 * whatever the on-disk database or classic SysInfo claims. That answer always
 * comes from the same two sources in the same order, so it lives here rather
 * than being re-derived per check:
 *
 *   1. `SysInfoExtended.SerialNumber` on disk — firmware-stamped at manufacture,
 *      survives clones, and resolves to a full variant (capacity + colour) via
 *      the serial-suffix table, which means it can yield a model number.
 *   2. `liveIdentity.model` — USB-descriptor derived. Generation only; carries
 *      no model number, so it can identify a device but never name it precisely
 *      enough to write an identity back.
 *
 * Note that the repair context does not carry `liveIdentity` (only the
 * diagnostic context does), so during `--repair` source 1 is the only one
 * available.
 *
 * @module
 */

import { readSysInfoExtended, type SysInfoExtendedResult } from '@podkit/ipod-firmware';
import { identify, type IpodModel } from '@podkit/devices-ipod';

/**
 * Where the firmware-derived model came from. Surfaced in `details` so JSON
 * consumers and downstream tooling know which axis fired.
 *
 * - `'sysinfo-extended'` — derived from `SysInfoExtended.SerialNumber` (richest
 *   source — gives variant info via serial-suffix lookup).
 * - `'live-usb'` — derived from the USB descriptor's product ID (generation-only).
 */
export type FirmwareTruthSource = 'sysinfo-extended' | 'live-usb';

export interface FirmwareTruth {
  model: IpodModel;
  source: FirmwareTruthSource;
  /** Serial used for resolution, when source === 'sysinfo-extended'. */
  serialNumber?: string;
  /** Serial-suffix used for the lookup (last 3 chars). */
  serialSuffix?: string;
}

/**
 * Injection seam for the SysInfoExtended reader. Tests pass an in-memory
 * stub so they can drive the firmware-truth resolver without touching disk
 * or installing a module-level mock that leaks across test files.
 *
 * Production callers leave this unset and get the real
 * `readSysInfoExtended` from `@podkit/ipod-firmware`.
 */
export type SieReader = (mountPoint: string) => SysInfoExtendedResult | null;

/** Default reader — the real on-disk `SysInfoExtended`. */
export const defaultSieReader: SieReader = readSysInfoExtended;

/**
 * Resolve the firmware-truth model from the richest available source.
 *
 * Returns `undefined` when no firmware truth can be obtained — callers then
 * skip, because there is nothing authoritative to compare or write.
 */
export function resolveFirmwareTruth(
  mountPoint: string,
  liveIdentity: { model?: IpodModel } | undefined,
  sieReader: SieReader
): FirmwareTruth | undefined {
  // 1. SysInfoExtended.SerialNumber → suffix lookup
  const sie = sieReader(mountPoint);
  const serial = sie?.identity.serialNumber;
  if (serial && serial.length >= 3) {
    const model = identify({ from: 'serial', serialNumber: serial });
    if (model) {
      return {
        model,
        source: 'sysinfo-extended',
        serialNumber: serial,
        serialSuffix: serial.slice(-3),
      };
    }
  }

  // 2. Live USB-derived model (generation only)
  if (liveIdentity?.model) {
    return { model: liveIdentity.model, source: 'live-usb' };
  }

  return undefined;
}
