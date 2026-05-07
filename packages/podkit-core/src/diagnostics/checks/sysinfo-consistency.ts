/**
 * SysInfoExtended consistency check
 *
 * Device-scope check that verifies the `FireWireGUID` stored in the on-disk
 * `SysInfoExtended` file matches the live USB descriptor's serial number.
 *
 * A mismatch means the file is stale — e.g. the device was replaced, or the
 * volume was cloned/synced from a different iPod. In that case the check
 * reports fail + repairable so the user can overwrite it with the correct data.
 *
 * **GUID source strategy (DiagnosticContext limitation)**
 *
 * `DiagnosticContext.db` (IpodDatabase) does not expose the USB FireWire GUID —
 * the database layer has no concept of it. We obtain the live GUID via
 * `resolveUsbDeviceFromPath`, which returns the USB descriptor's `serialNumber`
 * field (for classic iPods this IS the FireWireGUID in 16-char hex uppercase).
 *
 * When USB resolution fails (device not connected via USB, or unsupported
 * platform), the check skips rather than failing to avoid false positives on
 * network-mounted or snapshot volumes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareSysInfoConsistency } from '@podkit/ipod-firmware';
import { resolveUsbDeviceFromPath } from '../../device/usb-discovery.js';
import { sysInfoExtendedCheck } from './sysinfo-extended.js';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSINFO_EXTENDED_PATH = join('iPod_Control', 'Device', 'SysInfoExtended');

// ── Injectable helpers for testing ────────────────────────────────────────────

/** Injectable filesystem reader (for unit testing without touching real FS). */
export interface SysinfFsReader {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf-8'): string;
}

/** Injectable USB resolver (for unit testing without spawning system_profiler/sysfs reads). */
export type UsbResolver = (mountPoint: string) => Promise<{ serialNumber?: string } | null>;

// ── Pure check logic ─────────────────────────────────────────────────────────

/**
 * Core consistency check logic.
 * Accepts injectable FS + USB helpers so unit tests can run without real hardware.
 */
export async function checkSysinfoConsistency(
  ctx: DiagnosticContext,
  fsReader: SysinfFsReader = { existsSync, readFileSync: (p, enc) => readFileSync(p, enc) },
  resolveUsb: UsbResolver = (mp) => resolveUsbDeviceFromPath(mp)
): Promise<CheckResult> {
  const filePath = join(ctx.mountPoint, SYSINFO_EXTENDED_PATH);

  // 1. File absent → fail + repairable
  if (!fsReader.existsSync(filePath)) {
    return {
      status: 'fail',
      summary: 'SysInfoExtended not present — run --repair sysinfo-extended to fetch from device',
      repairable: true,
    };
  }

  // 2. Read + parse the on-disk file
  let xml: string;
  try {
    xml = fsReader.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      summary: `SysInfoExtended could not be read: ${msg}`,
      repairable: true,
    };
  }

  // 3. Obtain live USB serial (FireWireGUID for classic iPods)
  let liveSerial: string | undefined;
  try {
    const usbInfo = await resolveUsb(ctx.mountPoint);
    liveSerial = usbInfo?.serialNumber;
  } catch {
    // USB resolution failed — not a fatal check error
  }

  // 4. Delegate parse + normalise + compare to the pure ipod-firmware function.
  const result = compareSysInfoConsistency(xml, liveSerial);

  switch (result.status) {
    case 'malformed':
      return {
        status: 'fail',
        summary: 'SysInfoExtended present but malformed or missing FireWireGUID',
        repairable: true,
        details: { filePath },
      };
    case 'no-live-guid':
      return {
        status: 'skip',
        summary: `SysInfoExtended present (GUID: ${result.onDiskGuid}) — live USB GUID unavailable, skipping consistency check`,
        repairable: false,
        details: { onDiskGuid: result.onDiskGuid },
      };
    case 'match':
      return {
        status: 'pass',
        summary: `SysInfoExtended matches live device (GUID: ${result.onDiskGuid})`,
        repairable: false,
        details: { guid: result.onDiskGuid },
      };
    case 'mismatch':
      return {
        status: 'fail',
        summary: `SysInfoExtended GUID mismatch — on-disk: ${result.onDiskGuid}, live device: ${result.liveGuid}`,
        repairable: true,
        details: {
          onDiskGuid: result.onDiskGuid,
          liveGuid: result.liveGuid,
          filePath,
        },
      };
  }
}

// ── Exported check object ─────────────────────────────────────────────────────

export const sysinfoConsistencyCheck: DiagnosticCheck = {
  id: 'sysinfo-consistency',
  name: 'SysInfoExtended consistency with device',
  scope: 'device',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    return checkSysinfoConsistency(ctx);
  },

  // Re-use the existing sysinfo-extended repair, which fetches fresh data from
  // USB and overwrites the file.
  repair: sysInfoExtendedCheck.repair,
};
