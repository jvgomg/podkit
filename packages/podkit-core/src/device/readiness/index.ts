import * as fs from 'node:fs';
import { interpretError } from '../error-codes.js';
import type { IpodClassification } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from '../usb-enumeration.js';
import { checkIpodStructure } from './stages/mount.js';
import { checkSysInfo } from './stages/sysinfo.js';
import { checkDatabase } from './stages/database.js';
import { skipRemaining, determineLevel } from './determine-level.js';
import type {
  ReadinessInput,
  ReadinessResult,
  ReadinessStageResult,
  ReadinessUnsupportedReason,
} from './types.js';
import type { IpodModel } from '@podkit/devices-ipod';
import {
  isFilesystemUnsupportedHere,
  makeHfsplusOnLinuxUnsupportedReason,
} from '../filesystem-policy.js';

/**
 * Coerce a `ReadinessInput.unsupported` value into the typed payload.
 *
 * Accepts the structured object directly, or wraps a bare headline string
 * with `kind: 'unsupported-device'` for legacy callers (the iPod /
 * mass-storage classifiers thread strings today; once migrated this branch
 * becomes dead code).
 */
function coerceUnsupportedReason(
  input: ReadinessUnsupportedReason | string
): ReadinessUnsupportedReason {
  if (typeof input === 'string') {
    return { kind: 'unsupported-device', headline: input };
  }
  return input;
}

/**
 * Map an `IpodClassification` rejection into the typed `ReadinessUnsupportedReason`.
 *
 * `classifyAsIpod` (in `@podkit/devices-ipod`) already attaches the canonical
 * typed payload via `lookupUnsupportedReadinessReason`. This helper just
 * narrows + provides a defensive fallback for the unreachable case where the
 * classifier returned `supported: false` without one.
 */
function ipodClassificationToUnsupportedReason(
  classification: IpodClassification<EnumeratedUsbDevice>
): ReadinessUnsupportedReason {
  return (
    classification.unsupportedReason ?? {
      kind: 'unsupported-device',
      headline: 'Device not supported by podkit.',
    }
  );
}

export { checkIpodStructure } from './stages/mount.js';
export { checkSysInfo } from './stages/sysinfo.js';
export { checkDatabase } from './stages/database.js';
export type {
  ReadinessStage,
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessInput,
  ReadinessUnsupportedReason,
  SysInfoCheckResult,
} from './types.js';
export { STAGE_DISPLAY_NAMES } from './types.js';

// ── Pipeline ─────────────────────────────────────────────────────────────────

export async function checkReadiness(input: ReadinessInput): Promise<ReadinessResult> {
  const { device } = input;
  const stages: ReadinessStageResult[] = [];

  // Unsupported short-circuit. When the caller has already classified the
  // device as "recognised but not supported" (Apple unsupported-PID table,
  // iOS range fallback, non-Apple USB with no preset), don't run the rest
  // of the cascade — there's nothing for the stage probes to discover.
  if (input.unsupported) {
    const unsupported = coerceUnsupportedReason(input.unsupported);
    stages.push({
      stage: 'usb',
      status: 'fail',
      summary: 'Device not supported',
      details: {
        identifier: device.identifier,
        unsupported,
      },
    });
    skipRemaining(stages, 1);
    return {
      level: 'unsupported',
      stages,
      unsupported,
      ...(input.usbModel ? { usbModel: input.usbModel } : {}),
    };
  }

  // Stage 1: USB Connected
  // If we have a PlatformDeviceInfo, the device was discovered by the OS.
  // Mirror the unsupported-path stage shape: surface vendorId/productId/
  // usbModel into the stage details so JSON consumers reading
  // `result.stages[0].details` see the same information as the
  // unsupported-path push (TASK-338). The data is reachable via
  // `input.usbConnection` (UsbFingerprint) and `input.usbModel` (IpodModel).
  stages.push({
    stage: 'usb',
    status: 'pass',
    summary: 'Device visible to OS',
    details: {
      identifier: device.identifier,
      ...(input.usbConnection?.vendorId ? { vendorId: input.usbConnection.vendorId } : {}),
      ...(input.usbConnection?.productId ? { productId: input.usbConnection.productId } : {}),
      ...(input.usbModel ? { usbModel: input.usbModel.displayName } : {}),
    },
  });

  // Stage 2: Partitioned
  // findIpodDevices only returns partitioned devices. Surface the partition
  // layout collected by the platform probe (lsblk on Linux, diskutil on
  // macOS) so JSON consumers can render "iPod with single partition (FAT32,
  // 32GB)" without re-probing the kernel (TASK-338).
  stages.push({
    stage: 'partition',
    status: 'pass',
    summary: 'Partition table present',
    details: buildPartitionStageDetails(device),
  });

  // Stage 3: Has Filesystem
  //
  // Refuse HFS+ iPods on Linux up-front: the kernel hfsplus driver is
  // read-only on journaled volumes (the iPod default), udev/blkid don't
  // surface a UUID, and udisksctl picks a generic `/media/$USER/disk` mount
  // point. Trying to "make it work" patches three friction points without
  // fixing any of them; refusing cleanly with a docs link is the policy.
  // See `filesystem-policy.ts` and TASK-317.12.
  if (isFilesystemUnsupportedHere(device.storage.filesystem, input.platform)) {
    const unsupported = makeHfsplusOnLinuxUnsupportedReason({
      ...(device.storage.filesystem ? { filesystem: device.storage.filesystem } : {}),
      ...(device.isMounted ? { path: device.mountPoint } : {}),
    });
    stages.push({
      stage: 'filesystem',
      status: 'fail',
      summary: `${device.storage.filesystem} is not supported on Linux`,
      details: {
        filesystem: device.storage.filesystem,
        platform: input.platform ?? process.platform,
        unsupported,
      },
    });
    // Deliberately do NOT push placeholder "Skipped — previous check failed"
    // rows for mount/sysinfo/database — TASK-317.12 calls those out as
    // misleading wording (the cause is the filesystem, not a prior failure).
    return {
      level: 'unsupported',
      stages,
      unsupported,
      ...(input.usbModel ? { usbModel: input.usbModel } : {}),
    };
  }
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

  // Stage 4: Mounted. Type narrowing on `isMounted` makes the subsequent
  // `device.mountPoint` reads non-nullable.
  if (!device.isMounted) {
    stages.push({
      stage: 'mount',
      status: 'fail',
      summary: 'Device is not mounted',
      details: { isMounted: false },
    });
    skipRemaining(stages, 4);
    return { level: determineLevel(stages), stages };
  }

  const mountPoint = device.mountPoint;
  try {
    const mountResult = await checkIpodStructure(mountPoint);
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
      mountPoint,
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
    const dbResult = await checkDatabase(input.ipod ? { ipod: input.ipod } : { mountPoint });
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
      const stats = fs.statfsSync(mountPoint);
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

// ── Stage detail helpers ──────────────────────────────────────────────────────

/**
 * Build the partition-stage `details` payload from a platform-probed device.
 *
 * The platform probe (`lsblk -J` on Linux, `diskutil list -plist` on macOS)
 * already enumerated the whole-disk partition layout into
 * `PlatformDeviceInfo.partitionLayout`. We thread it into the stage details
 * verbatim — no re-probing — so JSON consumers can render layout-aware
 * messages ("iPod with single partition (FAT32, 32GB)").
 *
 * Cross-platform asymmetry: Linux's `lsblk` surfaces the kernel's full
 * partition table (including firmware partitions and unformatted slices, so
 * `partitionCount` can exceed the user-visible volume count). macOS's
 * `diskutil list` enumerates user-visible partitions only — firmware
 * partitions and free space are filtered out — so `partitionCount` reflects
 * the volume-owning partitions only. The `filesystem` strings also differ
 * by platform (Linux: `"vfat"`, `"hfsplus"`; macOS: `"MS-DOS FAT32"`,
 * `"Apple_HFS"`). Both are documented inline at the
 * `PartitionLayout` / `PlatformDeviceInfo.filesystem` type definitions.
 *
 * Falls back to the historical `{ identifier }` shape when no layout was
 * captured by the probe — preserves the existing contract for callers that
 * synthesise a `PlatformDeviceInfo` without going through `listDevices()`.
 */
function buildPartitionStageDetails(device: ReadinessInput['device']): Record<string, unknown> {
  const layout = device.storage.partitionLayout;
  if (!layout) {
    return { identifier: device.identifier };
  }
  return {
    identifier: device.identifier,
    partitionCount: layout.partitionCount,
    partitions: layout.partitions.map((p) => ({
      index: p.index,
      filesystem: p.filesystem,
      sizeBytes: p.sizeBytes,
      ...(p.identifier ? { identifier: p.identifier } : {}),
      ...(p.volumeUuid ? { volumeUuid: p.volumeUuid } : {}),
    })),
  };
}

// ── USB-only readiness result ─────────────────────────────────────────────────

/**
 * Create a ReadinessResult for an iPod that the OS sees on the USB bus but
 * has not surfaced as a mounted disk yet. USB stage passes, partition stage
 * fails, remaining stages are skipped.
 *
 * Accepts an `IpodClassification` (the typed output of the iPod classifier)
 * so the caller does not duplicate vendor/product extraction logic.
 */
export function createUsbOnlyReadinessResult(
  classification: IpodClassification<EnumeratedUsbDevice>
): ReadinessResult {
  const { device, model } = classification;

  // Unsupported short-circuit: an Apple-vendor PID that lives in the
  // unsupported-PID table (or the iOS range fallback) is classified with
  // `supported: false` and a canonical `unsupportedReason` payload. Surface
  // the new level + structured reason instead of pretending the device only
  // needs a partition table.
  if (classification.supported === false && classification.unsupportedReason) {
    const unsupported = ipodClassificationToUnsupportedReason(classification);
    const stages: ReadinessStageResult[] = [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: {
          vendorId: device.vendorId,
          productId: device.productId,
          modelName: model?.displayName,
          unsupported,
        },
      },
    ];
    skipRemaining(stages, 1);
    return {
      level: 'unsupported',
      stages,
      unsupported,
      ...(model ? { usbModel: model } : {}),
    };
  }

  const stages: ReadinessStageResult[] = [
    {
      stage: 'usb',
      status: 'pass',
      summary: `${model?.displayName ?? 'Unknown iPod'} (Apple ${device.vendorId})`,
      details: {
        vendorId: device.vendorId,
        productId: device.productId,
        modelName: model?.displayName,
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
    usbModel: model,
  };
}
