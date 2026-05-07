import * as fs from 'node:fs';
import { join } from 'node:path';
import {
  lookupByModelNumber,
  lookupGenerationByModelNumber,
  lookupGenerationByProductId,
  getChecksumType,
  lookupGenerationInfo,
  resolveIpodModel,
} from '@podkit/devices-ipod';
import type { IpodChecksumType, IpodGenerationId } from '@podkit/devices-ipod';
import { readSysInfoExtended } from '@podkit/ipod-firmware';
import type { UsbFingerprint } from '@podkit/device-types';
import type { SysInfoCheckResult, ReadinessStageResult } from '../types.js';

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
  usbConnection: UsbFingerprint | undefined
): { sysInfoGeneration: string; usbGeneration: string } | undefined {
  if (!sysInfoGenId || !usbConnection?.productId) return undefined;
  const usbGenId = lookupGenerationByProductId(usbConnection.productId);
  if (!usbGenId || sysInfoGenId === usbGenId) return undefined;
  return {
    sysInfoGeneration: lookupGenerationInfo(sysInfoGenId).displayName,
    usbGeneration: lookupGenerationInfo(usbGenId).displayName,
  };
}

export async function checkSysInfo(
  mountPoint: string,
  usbConnection?: UsbFingerprint,
  usbModelName?: string
): Promise<SysInfoCheckResult> {
  const sysInfoPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfo');
  const sysInfoExtendedPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfoExtended');

  // ── Step 1: Check SysInfoExtended ──────────────────────────────────────
  const resolveModel = (sn: string) =>
    resolveIpodModel({ from: 'serial', serialNumber: sn }) ?? undefined;
  const sysInfoExtended = readSysInfoExtended(mountPoint, resolveModel);
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
  const modelName = lookupByModelNumber(modelNumber)?.displayName;
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
