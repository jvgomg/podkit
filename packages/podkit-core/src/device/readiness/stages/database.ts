import { IpodDatabase } from '../../../ipod/database.js';
import { IpodError } from '../../../ipod/errors.js';
import { interpretError } from '../../error-codes.js';
import type { ReadinessStageResult } from '../types.js';

/**
 * Discriminated input for `checkDatabase`.
 *
 * - `{ mountPoint }`: probe via `IpodDatabase.hasDatabase`, then open, read,
 *   and close a fresh handle ourselves. Atomic; safe for any consumer.
 * - `{ ipod }`: reuse a caller-supplied open handle. Skips both the existence
 *   probe (the handle being open implies the database exists) and the
 *   open/close lifecycle (caller retains ownership). Use to avoid a redundant
 *   libgpod parse when the caller has already opened the database — parsing
 *   the iTunesDB binary is the slowest step in a readiness check.
 */
export type CheckDatabaseInput = { mountPoint: string } | { ipod: IpodDatabase };

export async function checkDatabase(
  input: CheckDatabaseInput
): Promise<ReadinessStageResult & { trackCount?: number; modelName?: string }> {
  if ('ipod' in input) {
    // Pre-opened path: the caller already parsed the database and owns the
    // handle. Skip both the existence probe and the open/close lifecycle.
    return readStageFromOpenIpod(input.ipod);
  }

  const { mountPoint } = input;
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
    return readStageFromOpenIpod(db);
  } catch (error) {
    return formatOpenError(error);
  } finally {
    db?.close();
  }
}

/**
 * Build a passing stage result from an already-open `IpodDatabase`.
 *
 * Synchronous reads on the open handle — this is the "fast path" both the
 * pre-opened branch and the self-opened branch fall through to.
 */
function readStageFromOpenIpod(
  db: IpodDatabase
): ReadinessStageResult & { trackCount: number; modelName?: string } {
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
}

function formatOpenError(error: unknown): ReadinessStageResult {
  const isCorrupt =
    error instanceof IpodError && (error.code === 'DATABASE_CORRUPT' || error.code === 'NOT_FOUND');

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
}
