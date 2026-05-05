import * as fs from 'node:fs';
import { join } from 'node:path';
import { interpretError } from '../../error-codes.js';
import type { ReadinessStageResult } from '../types.js';

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
