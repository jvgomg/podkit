import * as fs from 'node:fs';
import { join } from 'node:path';
import type { PlatformDeviceInfo } from './types.js';
import type { DeviceAssessment } from './assessment.js';
import type { UsbDiscoveredDevice } from './usb-discovery.js';
import { IpodDatabase } from '../ipod/database.js';
import { IpodError } from '../ipod/errors.js';
import { interpretError } from './error-codes.js';
import { lookupIpodModelByNumber } from './ipod-models.js';

// ── Stage identifiers ────────────────────────────────────────────────────────

export type ReadinessStage = 'usb' | 'partition' | 'filesystem' | 'mount' | 'sysinfo' | 'database';

// ── Stage result ─────────────────────────────────────────────────────────────

export interface ReadinessStageResult {
  stage: ReadinessStage;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  details?: Record<string, unknown>;
}

// ── Readiness levels ─────────────────────────────────────────────────────────

export type ReadinessLevel =
  | 'ready'
  | 'needs-repair'
  | 'needs-init'
  | 'needs-format'
  | 'needs-partition'
  | 'hardware-error'
  | 'unknown';

export interface ReadinessResult {
  level: ReadinessLevel;
  stages: ReadinessStageResult[];
  summary?: {
    trackCount: number;
    modelName?: string;
    freeBytes?: number;
    totalBytes?: number;
  };
}

// ── Pipeline input ───────────────────────────────────────────────────────────

export interface ReadinessInput {
  device: PlatformDeviceInfo;
  assessment?: DeviceAssessment;
}

// ── Stage display names ───────────────────────────────────────────────────────

export const STAGE_DISPLAY_NAMES: Record<ReadinessStage, string> = {
  usb: 'USB Connection',
  partition: 'Partition Table',
  filesystem: 'Filesystem',
  mount: 'Mounted',
  sysinfo: 'SysInfo',
  database: 'Database',
};

// ── Stage ordering ───────────────────────────────────────────────────────────

const STAGE_ORDER: ReadinessStage[] = [
  'usb',
  'partition',
  'filesystem',
  'mount',
  'sysinfo',
  'database',
];

// ── Independent check functions ──────────────────────────────────────────────

export async function checkIpodStructure(mountPoint: string): Promise<ReadinessStageResult> {
  try {
    // Verify mount is live via statfs
    fs.statfsSync(mountPoint);
  } catch (err) {
    const interpreted = interpretError(err instanceof Error ? err : new Error(String(err)));
    return {
      stage: 'mount',
      status: 'fail',
      summary: 'Mount point is not accessible (stale or disconnected)',
      details: {
        mountPoint,
        error: interpreted.rawMessage,
        interpretation: interpreted.explanation,
        errno: interpreted.errno,
        errnoName: interpreted.errnoName,
      },
    };
  }

  // Check for read-only mount
  let readOnly = false;
  try {
    fs.accessSync(mountPoint, fs.constants.W_OK);
  } catch {
    readOnly = true;
  }

  // Check for iPod_Control directory
  const ipodControlPath = join(mountPoint, 'iPod_Control');
  try {
    fs.accessSync(ipodControlPath);
  } catch {
    return {
      stage: 'mount',
      status: 'fail',
      summary: 'iPod_Control directory not found',
      details: { mountPoint, ipodControlExists: false },
    };
  }

  if (readOnly) {
    return {
      stage: 'mount',
      status: 'warn',
      summary: 'Mounted read-only',
      details: { mountPoint, readOnly: true },
    };
  }

  return {
    stage: 'mount',
    status: 'pass',
    summary: mountPoint,
    details: { mountPoint, readOnly: false },
  };
}

const SYSINFO_SUGGESTION_RESET =
  'Run `podkit device reset` to recreate, or manually create iPod_Control/Device/SysInfo with your model number.';

/** Returns true if the buffer contains control characters that indicate binary content. */
function isBinaryContent(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 256);
  for (let i = 0; i < checkLen; i++) {
    const byte = buf[i]!;
    // Control characters 0–8 and 14–31 (excluding tab=9, newline=10, carriage return=13)
    if ((byte >= 0 && byte <= 8) || (byte >= 14 && byte <= 31)) {
      return true;
    }
  }
  return false;
}

export async function checkSysInfo(mountPoint: string): Promise<ReadinessStageResult> {
  const sysInfoPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfo');

  // Check existence
  let fileExists = false;
  try {
    fs.accessSync(sysInfoPath, fs.constants.F_OK);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  if (!fileExists) {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file not found',
      details: {
        sysInfoPath,
        exists: false,
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  // Read raw bytes for binary detection and UTF-8 validation
  let rawBuf: Buffer;
  try {
    rawBuf = fs.readFileSync(sysInfoPath);
  } catch (error) {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file could not be read',
      details: {
        sysInfoPath,
        exists: true,
        error: error instanceof Error ? error.message : String(error),
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  // Empty file
  if (rawBuf.length === 0) {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file is empty',
      details: {
        sysInfoPath,
        exists: true,
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  // Binary/corrupt content
  if (isBinaryContent(rawBuf)) {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file appears to be binary/corrupt',
      details: {
        sysInfoPath,
        exists: true,
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  // Decode as UTF-8
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(rawBuf);
  } catch {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file contains invalid UTF-8',
      details: {
        sysInfoPath,
        exists: true,
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  // Extract ModelNumStr
  const modelMatch = content.match(/ModelNumStr:\s*(\S+)/);
  if (!modelMatch) {
    return {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo exists but ModelNumStr not found',
      details: {
        sysInfoPath,
        exists: true,
        hasModelNum: false,
        suggestion: SYSINFO_SUGGESTION_RESET,
      },
    };
  }

  const modelNumber = modelMatch[1]!;
  const modelName = lookupIpodModelByNumber(modelNumber);

  if (!modelName) {
    return {
      stage: 'sysinfo',
      status: 'warn',
      summary: `Unrecognized model: ${modelNumber}`,
      details: {
        sysInfoPath,
        exists: true,
        hasModelNum: true,
        modelNumber,
        suggestion:
          'Device will be treated as a generic iPod. This is usually fine but may affect artwork format detection.',
      },
    };
  }

  return {
    stage: 'sysinfo',
    status: 'pass',
    summary: `${modelName} (${modelNumber})`,
    details: { sysInfoPath, exists: true, hasModelNum: true, modelNumber, modelName },
  };
}

export async function checkDatabase(
  mountPoint: string
): Promise<ReadinessStageResult & { trackCount?: number; modelName?: string }> {
  const hasDb = await IpodDatabase.hasDatabase(mountPoint);

  if (!hasDb) {
    return {
      stage: 'database',
      status: 'fail',
      summary: 'iTunesDB not found',
      details: { exists: false },
    };
  }

  let db: IpodDatabase | undefined;
  try {
    db = await IpodDatabase.open(mountPoint);
    const trackCount = db.trackCount;
    const info = db.getInfo();
    const modelName = info.device.modelName || undefined;

    return {
      stage: 'database',
      status: 'pass',
      summary: `${trackCount} track${trackCount === 1 ? '' : 's'}`,
      details: { exists: true, trackCount, modelName },
      trackCount,
      modelName,
    };
  } catch (error) {
    const isCorrupt =
      error instanceof IpodError &&
      (error.code === 'DATABASE_CORRUPT' || error.code === 'NOT_FOUND');

    const interpreted = interpretError(error instanceof Error ? error : new Error(String(error)));
    return {
      stage: 'database',
      status: 'fail',
      summary: isCorrupt ? 'iTunesDB is corrupt' : 'Failed to open iTunesDB',
      details: {
        exists: true,
        error: interpreted.rawMessage,
        interpretation: interpreted.explanation,
        errno: interpreted.errno,
        errnoName: interpreted.errnoName,
      },
    };
  } finally {
    db?.close();
  }
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function skipRemaining(stages: ReadinessStageResult[], fromIndex: number): void {
  for (let i = fromIndex; i < STAGE_ORDER.length; i++) {
    stages.push({
      stage: STAGE_ORDER[i]!,
      status: 'skip',
      summary: 'Skipped — previous check failed',
    });
  }
}

function determineLevel(stages: ReadinessStageResult[]): ReadinessLevel {
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  // Check for hardware errors (IO errors during any stage)
  for (const s of stages) {
    if (s.details?.error && typeof s.details.error === 'string') {
      const err = s.details.error.toLowerCase();
      if (err.includes('i/o error') || err.includes('input/output error')) {
        return 'hardware-error';
      }
    }
  }

  const usb = byStage.get('usb');
  const partition = byStage.get('partition');
  const filesystem = byStage.get('filesystem');
  const mount = byStage.get('mount');
  const sysinfo = byStage.get('sysinfo');
  const database = byStage.get('database');

  // USB failed → hardware-error
  if (usb?.status === 'fail') return 'hardware-error';

  // Partitioned failed → needs-partition
  if (partition?.status === 'fail') return 'needs-partition';

  // Filesystem failed → needs-format
  if (filesystem?.status === 'fail') return 'needs-format';

  // Mount failed → check why
  if (mount?.status === 'fail') {
    // No iPod_Control → needs-init
    if (mount.details?.ipodControlExists === false) return 'needs-init';
    // Stale mount or OS error — statfs failed or other low-level mount failure
    if (mount.details?.mountPoint !== undefined || mount.details?.errno !== undefined) {
      return 'hardware-error';
    }
    // Unmounted device (details: { isMounted: false }) — no iPod_Control check was performed
    return 'needs-init';
  }

  // Mount passed (or warned). Check SysInfo and Database.
  // Database doesn't exist → needs-init
  if (database?.status === 'fail') {
    if (database.details?.exists === false) return 'needs-init';
    // DB exists but corrupt → needs-repair
    return 'needs-repair';
  }

  // SysInfo problems with database OK → needs-repair (warn level, won't actually fail pipeline)
  // But if sysinfo warns and database passes, that's still ready
  if (sysinfo?.status === 'fail') return 'needs-repair';

  // All pass or warn → ready
  if (database?.status === 'pass') return 'ready';

  return 'unknown';
}

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
  try {
    const sysInfoResult = await checkSysInfo(device.mountPoint);
    stages.push(sysInfoResult);
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
  let modelName: string | undefined;
  try {
    const dbResult = await checkDatabase(device.mountPoint);
    stages.push(dbResult);
    trackCount = dbResult.trackCount;
    modelName = dbResult.modelName;
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
      modelName,
      freeBytes,
      totalBytes,
    };
  }

  return { level, stages, summary };
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
      summary: `${usbDevice.modelName ?? 'Unknown iPod'} (Apple ${usbDevice.vendorId})`,
      details: {
        vendorId: usbDevice.vendorId,
        productId: usbDevice.productId,
        modelName: usbDevice.modelName,
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
  };
}
