/**
 * SysInfoExtended repair-only check.
 *
 * Detection lives in the readiness `sysinfo` stage (single source of truth
 * for device identity). This check exposes the repair action that reads
 * device identity from iPod firmware via USB and writes it to the filesystem,
 * accessible via `podkit doctor --repair sysinfo-extended`.
 */

import { ensureSysInfoExtended } from '@podkit/ipod-firmware';
import { identify } from '@podkit/devices-ipod';
import { resolveUsbDeviceFromPath, hasCompleteUsbFingerprint } from '../../device/usb-discovery.js';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

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
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
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
          summary: `Dry run: would read SysInfoExtended from USB bus ${usbDevice.bus} device ${usbDevice.devnum}`,
          details: {
            bus: usbDevice.bus,
            devnum: usbDevice.devnum,
          },
        };
      }

      // Step 2: Read from USB and write to device
      options?.onProgress?.({
        phase: 'reading',
        message: `Reading SysInfoExtended from USB bus ${usbDevice.bus} device ${usbDevice.devnum}`,
      });

      const resolveModel = (sn: string) =>
        identify({ from: 'serial', serialNumber: sn }) ?? undefined;
      const result = await ensureSysInfoExtended(
        ctx.mountPoint,
        {
          vendorId: usbDevice.vendorId,
          productId: usbDevice.productId,
          ...(usbDevice.serialNumber ? { serialNumber: usbDevice.serialNumber } : {}),
          bus: usbDevice.bus,
          devnum: usbDevice.devnum,
        },
        { resolveModel }
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

      const modelName = result.model?.displayName ?? 'Unknown iPod';
      return {
        success: true,
        summary: `SysInfoExtended ${result.source === 'existing' ? 'already present' : 'written'} — ${modelName}`,
        details: {
          source: result.source,
          firewireGuid: result.firewireGuid,
          serialNumber: result.serialNumber,
          modelName: result.model?.displayName,
          generationId: result.model?.generationId,
          checksumType: result.model?.checksumType,
        },
      };
    },
  },
};
