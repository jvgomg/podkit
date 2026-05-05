import { IpodDatabase } from '../../../ipod/database.js';
import { IpodError } from '../../../ipod/errors.js';
import { interpretError } from '../../error-codes.js';
import type { ReadinessStageResult } from '../types.js';

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
