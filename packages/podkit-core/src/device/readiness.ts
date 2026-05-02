import * as fs from 'node:fs';
import { join } from 'node:path';
import type { PlatformDeviceInfo } from './types.js';
import type { DeviceAssessment } from './assessment.js';
import type { UsbConnectionInfo, UsbDiscoveredDevice } from './usb-discovery.js';
import { IpodDatabase } from '../ipod/database.js';
import { IpodError } from '../ipod/errors.js';
import { interpretError } from './error-codes.js';
import {
  lookupIpodModelByNumber,
  lookupGenerationByModelNumber,
  lookupGenerationByProductId,
  getChecksumType,
  getGenerationInfo,
  resolveIpodModel,
} from './ipod-models.js';
import type { IpodChecksumType, IpodGenerationId, IpodModel } from './ipod-models.js';
import { readSysInfoExtended } from './sysinfo-extended.js';

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
  /** Model from USB product ID lookup (generation only, no color) */
  usbModel?: IpodModel;
  /** Model from SysInfo/SysInfoExtended (has color, capacity, model number) */
  deviceModel?: IpodModel;
  summary?: {
    trackCount: number;
    freeBytes?: number;
    totalBytes?: number;
  };
}

// ── Pipeline input ───────────────────────────────────────────────────────────

export interface ReadinessInput {
  device: PlatformDeviceInfo;
  assessment?: DeviceAssessment;
  /** USB connection data */
  usbConnection?: UsbConnectionInfo;
  /** iPod model from USB discovery */
  usbModel?: IpodModel;
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

// Non-destructive repair hint for any sysinfo-stage failure: read identity
// from USB firmware and write SysInfoExtended. libgpod prefers
// SysInfoExtended over classic SysInfo, so this fixes missing/empty/corrupt
// SysInfo files without resetting the device or touching user data.
const SYSINFO_SUGGESTION_REPAIR =
  'Run `podkit doctor --repair sysinfo-extended` to read device identity from USB.';

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

/** Check if SysInfo and USB report different iPod generations. */
function detectGenerationMismatch(
  sysInfoGenId: IpodGenerationId | undefined,
  usbConnection: UsbConnectionInfo | undefined
): { sysInfoGeneration: string; usbGeneration: string } | undefined {
  if (!sysInfoGenId || !usbConnection?.productId) return undefined;
  const usbGenId = lookupGenerationByProductId(usbConnection.productId);
  if (!usbGenId || sysInfoGenId === usbGenId) return undefined;
  return {
    sysInfoGeneration: getGenerationInfo(sysInfoGenId).displayName,
    usbGeneration: getGenerationInfo(usbGenId).displayName,
  };
}

export interface SysInfoCheckResult {
  stage: ReadinessStageResult;
  deviceModel?: IpodModel;
}

export async function checkSysInfo(
  mountPoint: string,
  usbConnection?: UsbConnectionInfo,
  usbModelName?: string
): Promise<SysInfoCheckResult> {
  const sysInfoPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfo');
  const sysInfoExtendedPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfoExtended');

  // ── Step 1: Check SysInfoExtended ──────────────────────────────────────
  const sysInfoExtended = readSysInfoExtended(mountPoint);
  const sysInfoExtendedExists = sysInfoExtended !== null;

  // Determine checksum type from USB product ID or SysInfoExtended serial
  let checksumType: IpodChecksumType | undefined;
  if (usbConnection?.productId) {
    const gen = lookupGenerationByProductId(usbConnection.productId);
    if (gen) checksumType = getChecksumType(gen);
  }
  if (!checksumType && sysInfoExtended?.model?.checksumType) {
    checksumType = sysInfoExtended.model.checksumType;
  }

  // Build limitation note for hash72/hashAB devices
  let checksumNote: string | undefined;
  if (checksumType === 'hash72') {
    checksumNote = 'This device requires an initial iTunes sync for HashInfo bootstrapping';
  } else if (checksumType === 'hashAB') {
    checksumNote = 'This device requires proprietary components not available in podkit';
  }

  // ── Step 2: If SysInfoExtended is present, use it ────────────────────
  if (sysInfoExtendedExists && sysInfoExtended.firewireGuid) {
    const displayName = sysInfoExtended.model?.displayName ?? 'Unknown iPod';

    // Check for generation mismatch between SysInfoExtended and USB
    const mismatch = detectGenerationMismatch(sysInfoExtended.model?.generationId, usbConnection);

    return {
      stage: {
        stage: 'sysinfo',
        status: mismatch ? 'warn' : 'pass',
        summary: mismatch ? `${displayName} — generation mismatch with USB` : displayName,
        details: {
          sysInfoPath,
          sysInfoExtendedPath,
          exists: true,
          sysInfoExtendedExists: true,
          hasModelNum: true,
          modelName: sysInfoExtended.model?.displayName,
          firewireGuid: sysInfoExtended.firewireGuid,
          serialNumber: sysInfoExtended.serialNumber,
          checksumType: sysInfoExtended.model?.checksumType ?? checksumType,
          ...(checksumNote ? { checksumNote } : {}),
          ...(usbModelName ? { usbModelName } : {}),
          ...(mismatch
            ? {
                generationMismatch: true,
                sysInfoGeneration: mismatch.sysInfoGeneration,
                usbGeneration: mismatch.usbGeneration,
              }
            : {}),
        },
      },
      deviceModel: sysInfoExtended.model,
    };
  }

  // ── Step 3: Check SysInfo (classic file) ─────────────────────────────
  let fileExists = false;
  try {
    fs.accessSync(sysInfoPath, fs.constants.F_OK);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  /** Helper: wrap a stage-only result (no deviceModel) */
  function stageOnly(result: ReadinessStageResult): SysInfoCheckResult {
    return { stage: result };
  }

  if (!fileExists) {
    // Both missing → fail
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo and SysInfoExtended not found',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: false,
        sysInfoExtendedExists: false,
        hasModelNum: false,
        checksumType,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  // Read raw bytes for binary detection and UTF-8 validation
  let rawBuf: Buffer;
  try {
    rawBuf = fs.readFileSync(sysInfoPath);
  } catch (error) {
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file could not be read',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        error: error instanceof Error ? error.message : String(error),
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  // Empty file
  if (rawBuf.length === 0) {
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file is empty',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  // Binary/corrupt content
  if (isBinaryContent(rawBuf)) {
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file appears to be binary/corrupt',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  // Decode as UTF-8
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(rawBuf);
  } catch {
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo file contains invalid UTF-8',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  // Extract ModelNumStr
  const modelMatch = content.match(/ModelNumStr:\s*(\S+)/);
  if (!modelMatch) {
    return stageOnly({
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfo exists but ModelNumStr not found',
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        hasModelNum: false,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    });
  }

  const modelNumber = modelMatch[1]!;
  const modelName = lookupIpodModelByNumber(modelNumber);
  const sysInfoModel = resolveIpodModel({ from: 'sysinfo', modelNumStr: modelNumber });

  if (!modelName) {
    return stageOnly({
      stage: 'sysinfo',
      status: 'warn',
      summary: `Unrecognized model: ${modelNumber}`,
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        hasModelNum: true,
        modelNumber,
        checksumType,
        ...(usbModelName ? { usbModelName } : {}),
        suggestion:
          'Device will be treated as a generic iPod. This is usually fine but may affect artwork format detection.',
      },
    });
  }

  // Check for generation mismatch between SysInfo model and USB
  const sysInfoGenId = lookupGenerationByModelNumber(modelNumber);
  const mismatch = detectGenerationMismatch(sysInfoGenId, usbConnection);
  const mismatchDetails = {
    ...(usbModelName ? { usbModelName } : {}),
    ...(mismatch
      ? {
          generationMismatch: true,
          sysInfoGeneration: mismatch.sysInfoGeneration,
          usbGeneration: mismatch.usbGeneration,
        }
      : {}),
  };

  // ── Step 4: SysInfo present but SysInfoExtended missing ────────────────
  // Determine severity based on checksum type
  const needsChecksumSysInfoExtended =
    checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';

  if (needsChecksumSysInfoExtended) {
    // Hash-requiring devices FAIL without SysInfoExtended.
    // Mismatch is secondary to the checksum requirement — keep status 'fail'.
    return {
      stage: {
        stage: 'sysinfo',
        status: 'fail',
        summary: `${modelName} (${modelNumber}) — SysInfoExtended required for checksum`,
        details: {
          sysInfoPath,
          sysInfoExtendedPath,
          exists: true,
          sysInfoExtendedExists: false,
          hasModelNum: true,
          modelNumber,
          modelName,
          checksumType,
          ...(checksumNote ? { checksumNote } : {}),
          ...mismatchDetails,
          suggestion: SYSINFO_SUGGESTION_REPAIR,
        },
      },
      deviceModel: sysInfoModel,
    };
  }

  // Non-checksum devices: classic SysInfo is sufficient. SysInfoExtended is
  // optional richer-identity metadata. A generation mismatch promotes to warn.
  return {
    stage: {
      stage: 'sysinfo',
      status: mismatch ? 'warn' : 'pass',
      summary: mismatch
        ? `${modelName} (${modelNumber}) — generation mismatch with USB`
        : `${modelName} (${modelNumber})`,
      details: {
        sysInfoPath,
        sysInfoExtendedPath,
        exists: true,
        sysInfoExtendedExists: false,
        hasModelNum: true,
        modelNumber,
        modelName,
        checksumType,
        ...mismatchDetails,
        suggestion: SYSINFO_SUGGESTION_REPAIR,
      },
    },
    deviceModel: sysInfoModel,
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

interface ReadinessRule {
  /** Human-readable description for maintainability */
  description: string;
  /** Returns true if this rule matches the given stage results */
  match: (stages: Map<ReadinessStage, ReadinessStageResult>) => boolean;
  /** The readiness level to return when matched */
  level: ReadinessLevel;
}

const READINESS_RULES: ReadinessRule[] = [
  {
    description: 'I/O error in any stage',
    match: (stages) =>
      [...stages.values()].some(
        (s) =>
          typeof s.details?.error === 'string' &&
          /i\/o error|input\/output error/i.test(s.details.error as string)
      ),
    level: 'hardware-error',
  },
  {
    description: 'USB detection failed',
    match: (stages) => stages.get('usb')?.status === 'fail',
    level: 'hardware-error',
  },
  {
    description: 'Partition check failed',
    match: (stages) => stages.get('partition')?.status === 'fail',
    level: 'needs-partition',
  },
  {
    description: 'Filesystem check failed',
    match: (stages) => stages.get('filesystem')?.status === 'fail',
    level: 'needs-format',
  },
  {
    description: 'Mount failed — no iPod_Control directory',
    match: (stages) => {
      const mount = stages.get('mount');
      return mount?.status === 'fail' && mount.details?.ipodControlExists === false;
    },
    level: 'needs-init',
  },
  {
    description: 'Mount failed — stale mount or OS error (mountPoint/errno present)',
    match: (stages) => {
      const mount = stages.get('mount');
      return (
        mount?.status === 'fail' &&
        (mount.details?.mountPoint !== undefined || mount.details?.errno !== undefined)
      );
    },
    level: 'hardware-error',
  },
  {
    description: 'Mount failed — unmounted device (fallback)',
    match: (stages) => stages.get('mount')?.status === 'fail',
    level: 'needs-init',
  },
  {
    description: 'Database failed — does not exist',
    match: (stages) => {
      const db = stages.get('database');
      return db?.status === 'fail' && db.details?.exists === false;
    },
    level: 'needs-init',
  },
  {
    description: 'Database failed — exists but corrupt',
    match: (stages) => stages.get('database')?.status === 'fail',
    level: 'needs-repair',
  },
  {
    description: 'SysInfo check failed',
    match: (stages) => stages.get('sysinfo')?.status === 'fail',
    level: 'needs-repair',
  },
  {
    description: 'All stages passed or warned — device is ready',
    match: (stages) => {
      const db = stages.get('database')?.status;
      return db === 'pass' || db === 'warn';
    },
    level: 'ready',
  },
];

function determineLevel(stages: ReadinessStageResult[]): ReadinessLevel {
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  for (const rule of READINESS_RULES) {
    if (rule.match(byStage)) return rule.level;
  }

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
    const dbResult = await checkDatabase(device.mountPoint);
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
