import * as fs from 'node:fs';
import { interpretError } from '../error-codes.js';
import type { UsbDiscoveredDevice } from '../usb-discovery.js';
import { checkIpodStructure } from './stages/mount.js';
import { checkSysInfo } from './stages/sysinfo.js';
import { checkDatabase } from './stages/database.js';
import { skipRemaining, determineLevel } from './determine-level.js';
import type { ReadinessInput, ReadinessResult, ReadinessStageResult } from './types.js';
import type { IpodModel } from '@podkit/devices-ipod';

export { checkIpodStructure } from './stages/mount.js';
export { checkSysInfo } from './stages/sysinfo.js';
export { checkDatabase } from './stages/database.js';
export type {
  ReadinessStage,
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessInput,
  SysInfoCheckResult,
} from './types.js';
export { STAGE_DISPLAY_NAMES } from './types.js';

// ── Pipeline ─────────────────────────────────────────────────────────────────

export async function checkReadiness(input: ReadinessInput): Promise<ReadinessResult> {
  const { device } = input;
  const stages: ReadinessStageResult[] = [];

  // Stage 1: USB Connected
  // If we have a PlatformDeviceInfo, the device was discovered by the OS
  stages.push({
    stage: 'usb',
    status: 'pass',
    summary: 'Device visible to OS',
    details: { identifier: device.identifier },
  });

  // Stage 2: Partitioned
  // findIpodDevices only returns partitioned devices
  stages.push({
    stage: 'partition',
    status: 'pass',
    summary: 'Partition table present',
    details: { identifier: device.identifier },
  });

  // Stage 3: Has Filesystem
  // If we have a volumeName, the filesystem is recognized
  if (device.volumeName) {
    stages.push({
      stage: 'filesystem',
      status: 'pass',
      summary: device.volumeName,
      details: { volumeName: device.volumeName },
    });
  } else {
    stages.push({
      stage: 'filesystem',
      status: 'fail',
      summary: 'No recognized filesystem',
      details: { volumeName: null },
    });
    skipRemaining(stages, 3);
    return { level: determineLevel(stages), stages };
  }

  // Stage 4: Mounted
  if (!device.isMounted || !device.mountPoint) {
    stages.push({
      stage: 'mount',
      status: 'fail',
      summary: 'Device is not mounted',
      details: { isMounted: false },
    });
    skipRemaining(stages, 4);
    return { level: determineLevel(stages), stages };
  }

  try {
    const mountResult = await checkIpodStructure(device.mountPoint);
    stages.push(mountResult);

    if (mountResult.status === 'fail') {
      skipRemaining(stages, 4);
      return { level: determineLevel(stages), stages };
    }
  } catch (error) {
    const interpreted = interpretError(error instanceof Error ? error : new Error(String(error)));
    stages.push({
      stage: 'mount',
      status: 'fail',
      summary: 'Error checking mount point',
      details: {
        error: interpreted.rawMessage,
        interpretation: interpreted.explanation,
        errno: interpreted.errno,
        errnoName: interpreted.errnoName,
      },
    });
    skipRemaining(stages, 4);
    return { level: 'hardware-error', stages };
  }

  // Stage 5: Valid SysInfo
  let deviceModel: IpodModel | undefined;
  try {
    const sysInfoResult = await checkSysInfo(
      device.mountPoint,
      input.usbConnection,
      input.usbModel?.displayName
    );
    deviceModel = sysInfoResult.deviceModel;
    stages.push(sysInfoResult.stage);
    // SysInfo warns but doesn't block — continue to database
  } catch (error) {
    stages.push({
      stage: 'sysinfo',
      status: 'warn',
      summary: 'Error checking SysInfo',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  }

  // Stage 6: Has Database
  let trackCount: number | undefined;
  try {
    const dbResult = await checkDatabase(
      input.ipod ? { ipod: input.ipod } : { mountPoint: device.mountPoint }
    );
    stages.push(dbResult);
    trackCount = dbResult.trackCount;
  } catch (error) {
    const interpreted = interpretError(error instanceof Error ? error : new Error(String(error)));
    stages.push({
      stage: 'database',
      status: 'fail',
      summary: 'Error checking database',
      details: {
        error: interpreted.rawMessage,
        interpretation: interpreted.explanation,
        errno: interpreted.errno,
        errnoName: interpreted.errnoName,
      },
    });
  }

  const level = determineLevel(stages);

  // Build summary for ready devices
  let summary: ReadinessResult['summary'];
  if (level === 'ready' && trackCount !== undefined) {
    let freeBytes: number | undefined;
    let totalBytes: number | undefined;

    try {
      const stats = fs.statfsSync(device.mountPoint!);
      totalBytes = stats.blocks * stats.bsize;
      freeBytes = stats.bfree * stats.bsize;
    } catch {
      // Storage info is optional
    }

    summary = {
      trackCount,
      freeBytes,
      totalBytes,
    };
  }

  return { level, stages, usbModel: input.usbModel, deviceModel, summary };
}

// ── USB-only readiness result ─────────────────────────────────────────────────

/**
 * Create a ReadinessResult for a USB-discovered device that has no disk
 * representation. USB stage passes, partition stage fails, remaining stages
 * are skipped.
 */
export function createUsbOnlyReadinessResult(usbDevice: UsbDiscoveredDevice): ReadinessResult {
  const stages: ReadinessStageResult[] = [
    {
      stage: 'usb',
      status: 'pass',
      summary: `${usbDevice.model?.displayName ?? 'Unknown iPod'} (Apple ${usbDevice.usb.vendorId})`,
      details: {
        vendorId: usbDevice.usb.vendorId,
        productId: usbDevice.usb.productId,
        modelName: usbDevice.model?.displayName,
      },
    },
    {
      stage: 'partition',
      status: 'fail',
      summary: 'No disk representation found',
      details: { diskIdentifier: undefined },
    },
  ];

  skipRemaining(stages, 2);

  return {
    level: 'needs-partition',
    stages,
    usbModel: usbDevice.model,
  };
}
