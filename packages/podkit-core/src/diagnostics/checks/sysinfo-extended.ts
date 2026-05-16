/**
 * SysInfoExtended repair-only check.
 *
 * Detection lives in the readiness `sysinfo` stage (single source of truth
 * for device identity). This check exposes the repair action that reads
 * device identity from iPod firmware via USB and writes it to the filesystem,
 * accessible via `podkit doctor --repair sysinfo-extended`.
 */

import { ensureSysInfoExtended } from '@podkit/ipod-firmware';
import { resolveIpodModel } from '@podkit/devices-ipod';
import {
  resolveUsbDeviceFromPath,
  hasCompleteUsbFingerprint,
} from '../../device/usb-path-resolution.js';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

/**
 * Shared SysInfoExtended-from-USB repair runner.
 *
 * Both `sysinfo-extended` (file genuinely missing) and `sysinfo-consistency`
 * (file present but stale) drive the same firmware-read / write path; they
 * differ only in whether they want the existing-file short-circuit.
 *
 * @param force when true, re-read from USB and overwrite an existing
 *   on-disk file. When false (default), short-circuit to the existing file.
 */
export async function runSysInfoExtendedRepair(
  ctx: RepairContext,
  options: RepairRunOptions | undefined,
  force: boolean
): Promise<RepairResult> {
  // Step 1: Resolve USB device from mount path
  options?.onProgress?.({
    phase: 'resolving',
    message: 'Resolving USB device from mount path',
  });

  const usbDevice = await resolveUsbDeviceFromPath(ctx.mountPoint);
  if (!hasCompleteUsbFingerprint(usbDevice)) {
    return {
      success: false,
      summary: 'Could not find USB device for this iPod',
      details: {
        mountPoint: ctx.mountPoint,
        error: 'USB device resolution failed — ensure the iPod is connected via USB',
      },
    };
  }

  if (options?.dryRun) {
    return {
      success: true,
      summary: `Dry run: would ${force ? 're-read and overwrite' : 'read'} SysInfoExtended from USB bus ${usbDevice.bus} device ${usbDevice.devnum}`,
      details: {
        bus: usbDevice.bus,
        devnum: usbDevice.devnum,
        force,
      },
    };
  }

  // Step 2: Read from USB and write to device
  options?.onProgress?.({
    phase: 'reading',
    message: `Reading SysInfoExtended from USB bus ${usbDevice.bus} device ${usbDevice.devnum}`,
  });

  const result = await ensureSysInfoExtended(
    ctx.mountPoint,
    {
      vendorId: usbDevice.vendorId,
      productId: usbDevice.productId,
      ...(usbDevice.serialNumber ? { serialNumber: usbDevice.serialNumber } : {}),
      bus: usbDevice.bus,
      devnum: usbDevice.devnum,
    },
    force ? { force: true } : undefined
  );

  if (!result.present) {
    return {
      success: false,
      summary: result.error ?? 'Failed to read SysInfoExtended from USB',
      details: {
        source: result.source,
        error: result.error,
      },
    };
  }

  // Resolve the richest model from every identifier on disk + USB.
  const model =
    resolveIpodModel({
      modelNumStr: result.identity.modelNumStr,
      serialNumber: result.identity.serialNumber,
      familyId: result.identity.familyId ?? null,
      productId: usbDevice.productId,
    }) ?? undefined;

  const modelName = model?.displayName ?? 'Unknown iPod';
  // When force is set we always rewrite — describe the action accordingly so
  // the user sees the file was refreshed rather than "already present".
  const action = force
    ? 'refreshed from USB'
    : result.source === 'existing'
      ? 'already present'
      : 'written';
  return {
    success: true,
    summary: `SysInfoExtended ${action} — ${modelName}`,
    details: {
      source: result.source,
      firewireGuid: result.firewireGuid,
      serialNumber: result.serialNumber,
      modelName: model?.displayName,
      generationId: model?.generationId,
      checksumType: model?.checksumType,
    },
  };
}

export const sysInfoExtendedCheck: DiagnosticCheck = {
  id: 'sysinfo-extended',
  name: 'SysInfoExtended',
  applicableTo: ['ipod'],
  repairOnly: true,

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    return {
      status: 'skip',
      summary: 'SysInfoExtended is a repair-only action (run with --repair sysinfo-extended)',
      repairable: false,
    };
  },

  repair: {
    description: 'Read device identity from iPod firmware via USB',
    // No 'database' requirement: this repair must run on a freshly-formatted
    // iPod that has no iTunesDB yet — populating identity is a prerequisite
    // for database init, not a consumer of it.
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      return runSysInfoExtendedRepair(ctx, options, /* force */ false);
    },
  },
};
