import * as fs from 'node:fs';
import { interpretError } from '../error-codes.js';
import type { IpodClassification } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from '../usb-enumeration.js';
import type {
  DiscoveredDeviceIpod,
  DiscoveredDeviceMassStorage,
  DiscoveredDeviceUnsupported,
} from '../discovery.js';
import type { PlatformDeviceInfo } from '../types.js';
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
import type { IpodDatabase } from '../../ipod/database.js';
import {
  isFilesystemUnsupportedHere,
  makeHfsplusOnLinuxUnsupportedReason,
} from '../filesystem-policy.js';

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

// ── Pipeline entry ───────────────────────────────────────────────────────────

/**
 * Run the readiness pipeline for any {@link DiscoveredDevice}.
 *
 * One entry point. Internal dispatch on `device.kind` (and on `block`
 * presence inside the iPod arm). The CLI no longer has to know which
 * helper to call for which device shape.
 *
 * See {@link ReadinessInput} for per-arm semantics.
 */
export async function checkReadiness(input: ReadinessInput): Promise<ReadinessResult> {
  const { device } = input;

  switch (device.kind) {
    case 'ipod':
      return device.block
        ? runIpodBlockPipeline(device, device.block, input.ipod, input.platform)
        : runIpodUsbOnly(device);
    case 'mass-storage':
      return runMassStorage(device);
    case 'unsupported':
      return runUnsupported(device);
  }
}

// ── iPod arm — full block-device pipeline ────────────────────────────────────

/**
 * The historical 6-stage cascade: usb → partition → filesystem → mount →
 * sysinfo → database. Runs when an iPod is visible on the OS as a partitioned
 * block device (mounted or not).
 *
 * USB context (`usbConnection`, `usbModel`) is read off the `DiscoveredDevice`
 * iPod arm's `usb` field. When `usb.supported === false` (Apple unsupported
 * PID, iOS range fallback) the unsupported short-circuit fires up-front —
 * none of the disk-mode probes can run against a device that never enters
 * disk mode.
 */
async function runIpodBlockPipeline(
  discovered: DiscoveredDeviceIpod,
  device: PlatformDeviceInfo,
  ipod: IpodDatabase | undefined,
  platform: string | undefined
): Promise<ReadinessResult> {
  const usbClassification = discovered.usb;
  const usbConnection = usbClassification?.device;
  const usbModel = usbClassification?.model;

  const stages: ReadinessStageResult[] = [];

  // Unsupported short-circuit. When the USB classifier already rejected the
  // device (Apple unsupported-PID table, iOS range fallback), don't run the
  // rest of the cascade — there's nothing for the stage probes to discover.
  if (usbClassification && usbClassification.supported === false) {
    const unsupported = ipodClassificationToUnsupportedReason(usbClassification);
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
      ...(usbModel ? { usbModel } : {}),
    };
  }

  // Stage 1: USB Connected
  // If we have a PlatformDeviceInfo, the device was discovered by the OS.
  // Mirror the unsupported-path stage shape: surface vendorId/productId/
  // usbModel into the stage details so JSON consumers reading
  // `result.stages[0].details` see the same information as the
  // unsupported-path push (TASK-338).
  stages.push({
    stage: 'usb',
    status: 'pass',
    summary: 'Device visible to OS',
    details: {
      identifier: device.identifier,
      ...(usbConnection?.vendorId ? { vendorId: usbConnection.vendorId } : {}),
      ...(usbConnection?.productId ? { productId: usbConnection.productId } : {}),
      ...(usbModel ? { usbModel: usbModel.displayName } : {}),
    },
  });

  // Stage 2: Partitioned
  // scan({ kinds: ['ipod'] }) only returns partitioned devices. Surface the partition
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
  if (isFilesystemUnsupportedHere(device.storage.filesystem, platform)) {
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
        platform: platform ?? process.platform,
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
      ...(usbModel ? { usbModel } : {}),
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
    const sysInfoResult = await checkSysInfo(mountPoint, usbConnection, usbModel?.displayName);
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

  // Post-sysinfo unsupported short-circuit. Mirrors the USB-arm short-circuit
  // above, but for the block-only path: when `usb` is undefined (e.g. doctor's
  // `ipodFromBlock` fallback), the USB guard above never fires. SysInfo
  // identification still populates `deviceModel.unsupportedReason` for
  // unsupported generations (nano 7G, touch 5G–7G, …). Refuse here instead of
  // proceeding to the database stage against a device podkit cannot sync.
  if (deviceModel?.unsupportedReason) {
    const unsupported = deviceModel.unsupportedReason;
    skipRemaining(stages, stages.length);
    return {
      level: 'unsupported',
      stages,
      unsupported,
      ...(usbModel ? { usbModel } : {}),
      deviceModel,
    };
  }

  // Stage 6: Has Database
  let trackCount: number | undefined;
  try {
    const dbResult = await checkDatabase(ipod ? { ipod } : { mountPoint });
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

  return { level, stages, usbModel, deviceModel, summary };
}

// ── iPod arm — USB-only ──────────────────────────────────────────────────────

/**
 * Synthesise a ReadinessResult for an iPod that the OS sees on the USB bus
 * but has not surfaced as a mounted disk yet. USB stage passes, partition
 * stage fails, remaining stages are skipped — `level: 'needs-partition'`.
 *
 * When the USB classifier already rejected the device (Apple unsupported-PID
 * table, iOS range fallback), short-circuits with `level: 'unsupported'`
 * and the canonical reason instead of pretending the device only needs a
 * partition table.
 *
 * Pre-T5 this was a separate exported helper (`createUsbOnlyReadinessResult`).
 * It now lives behind the single {@link checkReadiness} entry point — the
 * dispatch picks this arm when `device.kind === 'ipod' && !device.block`.
 */
function runIpodUsbOnly(discovered: DiscoveredDeviceIpod): ReadinessResult {
  const usbClassification = discovered.usb;
  if (!usbClassification) {
    // Should never happen: the discovery reconciler requires at least one of
    // `block` or `usb` on every record. A USB-only iPod with neither is an
    // empty record — return a defensive `unknown` result.
    const stages: ReadinessStageResult[] = [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'No USB or block-device data for this iPod',
        details: {},
      },
    ];
    skipRemaining(stages, 1);
    return { level: 'unknown', stages };
  }

  const { device, model } = usbClassification;

  // Unsupported short-circuit: an Apple-vendor PID that lives in the
  // unsupported-PID table (or the iOS range fallback) is classified with
  // `supported: false` and a canonical `unsupportedReason` payload. Surface
  // the new level + structured reason instead of pretending the device only
  // needs a partition table.
  if (usbClassification.supported === false && usbClassification.unsupportedReason) {
    const unsupported = ipodClassificationToUnsupportedReason(usbClassification);
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

// ── Mass-storage arm ─────────────────────────────────────────────────────────

/**
 * Synthesise a ReadinessResult for a recognised mass-storage device.
 *
 * Mass-storage devices don't run the iPod readiness cascade — they have no
 * iTunesDB, SysInfo, or iPod_Control directory. The result is a structural
 * placeholder so JSON consumers (scan, doctor) see a consistent shape:
 *
 * - With `block`: `level: 'ready'`. The device is mounted and recognised
 *   by USB preset; podkit can write to it.
 * - Without `block` (USB-only): `level: 'needs-partition'`. Mirrors the
 *   USB-only iPod shape — the user needs to put the device into mass-storage
 *   mode or power it on.
 *
 * Pre-T5 mass-storage devices had no readiness pipeline at all (scan left
 * the field undefined). T5 unifies the per-kind dispatch so every
 * discovered device has a typed readiness result.
 */
function runMassStorage(discovered: DiscoveredDeviceMassStorage): ReadinessResult {
  const presetLabel = discovered.usb?.preset?.productName ?? 'mass-storage device';

  if (discovered.block) {
    // Mounted, recognised mass-storage device. Single usb-stage pass + the
    // remaining stages collapse to skip rows so the renderer doesn't break.
    const stages: ReadinessStageResult[] = [
      {
        stage: 'usb',
        status: 'pass',
        summary: `${presetLabel} (mass-storage)`,
        details: {
          identifier: discovered.block.identifier,
          ...(discovered.usb?.device.vendorId ? { vendorId: discovered.usb.device.vendorId } : {}),
          ...(discovered.usb?.device.productId
            ? { productId: discovered.usb.device.productId }
            : {}),
        },
      },
    ];
    skipRemaining(stages, 1);
    return { level: 'ready', stages };
  }

  // USB-only mass-storage — recognised by preset but not mounted (powered
  // off, wrong USB mode).
  const stages: ReadinessStageResult[] = [
    {
      stage: 'usb',
      status: 'pass',
      summary: `${presetLabel} (mass-storage, USB only)`,
      details: {
        ...(discovered.usb?.device.vendorId ? { vendorId: discovered.usb.device.vendorId } : {}),
        ...(discovered.usb?.device.productId ? { productId: discovered.usb.device.productId } : {}),
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
  return { level: 'needs-partition', stages };
}

// ── Unsupported arm ──────────────────────────────────────────────────────────

/**
 * Synthesise a ReadinessResult for an unsupported device (recognised VID/PID
 * but explicitly refused — Sony Walkman, generic non-music USB storage).
 *
 * Always `level: 'unsupported'` with a typed reason built from the
 * classifier's `reason` string. The shape mirrors what the old
 * `check-readiness-unsupported` short-circuit produced for iPods, so JSON
 * consumers see a single uniform unsupported shape regardless of which
 * arm produced it.
 */
function runUnsupported(discovered: DiscoveredDeviceUnsupported): ReadinessResult {
  const { device, reason, family } = discovered.usb;
  const unsupported: ReadinessUnsupportedReason = {
    kind: 'unsupported-preset',
    headline: reason,
  };
  const stages: ReadinessStageResult[] = [
    {
      stage: 'usb',
      status: 'fail',
      summary: 'Device not supported',
      details: {
        vendorId: device.vendorId,
        productId: device.productId,
        ...(family ? { family } : {}),
        unsupported,
      },
    },
  ];
  skipRemaining(stages, 1);
  return { level: 'unsupported', stages, unsupported };
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
 * synthesise a `PlatformDeviceInfo` without going through `scan()`.
 */
function buildPartitionStageDetails(device: PlatformDeviceInfo): Record<string, unknown> {
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

// ── Test seam ────────────────────────────────────────────────────────────────

/**
 * Construct a single-record `DiscoveredDeviceIpod` from a `PlatformDeviceInfo`
 * for callers that only have the block-side data.
 *
 * This is a **production export** used by path-mode callers and fallback flows
 * (e.g. `doctor` resolving a device by configured mount path, `device info`
 * in path mode) that have a block device but did not go through full USB
 * discovery. It is also convenient for unit tests that only need the block arm.
 *
 * `usb` is omitted — the iPod arm permits `block`-only matches. When `usb`
 * is absent the USB short-circuit in `runIpodBlockPipeline` does not fire;
 * instead the post-sysinfo unsupported check catches unsupported generations
 * (nano 7G, touch 5G–7G, …) via `deviceModel.unsupportedReason`.
 *
 * Not re-exported from `@podkit/core`. Production code that does have USB
 * context should prefer `discoverConnectedDevices` (the full reconciliation).
 */
export function ipodFromBlock(block: PlatformDeviceInfo): DiscoveredDeviceIpod {
  return { kind: 'ipod', block, matchedBy: 'block-only' };
}
