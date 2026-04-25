/**
 * SysInfoExtended diagnostic check
 *
 * Checks whether SysInfoExtended is present on the device and provides
 * a repair action that reads device identity from iPod firmware via USB
 * and writes it to the filesystem.
 */

import { readSysInfoExtended, ensureSysInfoExtended } from '../../device/sysinfo-extended.js';
import { resolveUsbDeviceFromPath } from '../../device/usb-discovery.js';
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

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    const result = readSysInfoExtended(ctx.mountPoint);

    if (result && result.present && result.deviceInfo) {
      const info = result.deviceInfo;
      const model = info.modelName ?? 'Unknown iPod';
      return {
        status: 'pass',
        summary: `${model} — SysInfoExtended present`,
        repairable: false,
        details: {
          firewireGuid: info.firewireGuid,
          serialNumber: info.serialNumber,
          modelName: info.modelName,
          generationId: info.generationId,
          checksumType: info.checksumType,
        },
      };
    }

    return {
      status: 'warn',
      summary:
        'SysInfoExtended not found — run `podkit doctor --repair sysinfo-extended` to read from USB',
      repairable: true,
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
      if (
        !usbDevice ||
        usbDevice.busNumber === undefined ||
        usbDevice.deviceAddress === undefined
      ) {
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
          summary: `Dry run: would read SysInfoExtended from USB bus ${usbDevice.busNumber} device ${usbDevice.deviceAddress}`,
          details: {
            busNumber: usbDevice.busNumber,
            deviceAddress: usbDevice.deviceAddress,
          },
        };
      }

      // Step 2: Read from USB and write to device
      options?.onProgress?.({
        phase: 'reading',
        message: `Reading SysInfoExtended from USB bus ${usbDevice.busNumber} device ${usbDevice.deviceAddress}`,
      });

      const result = await ensureSysInfoExtended(ctx.mountPoint, {
        busNumber: usbDevice.busNumber,
        deviceAddress: usbDevice.deviceAddress,
      });

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

      const model = result.deviceInfo?.modelName ?? 'Unknown iPod';
      return {
        success: true,
        summary: `SysInfoExtended ${result.source === 'existing' ? 'already present' : 'written'} — ${model}`,
        details: {
          source: result.source,
          firewireGuid: result.deviceInfo?.firewireGuid,
          serialNumber: result.deviceInfo?.serialNumber,
          modelName: result.deviceInfo?.modelName,
          generationId: result.deviceInfo?.generationId,
          checksumType: result.deviceInfo?.checksumType,
        },
      };
    },
  },
};
