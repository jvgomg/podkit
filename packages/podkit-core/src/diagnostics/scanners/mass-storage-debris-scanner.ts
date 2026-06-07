/**
 * Scanner registration for mass-storage content debris.
 *
 * Wraps `walkMassStorageContent` and projects only the `debris` bucket —
 * orphans + missingTrackedFiles are user-facing concerns owned by the
 * `orphan-files-mass-storage` check, never by the scanner registry. The
 * pre-sync sweep (TASK-398) consumes this scanner; doctor's
 * `debris-files-mass-storage` check uses the same walker directly.
 */

import { stat } from 'node:fs/promises';
import type { Scanner, ScannerContext, DebrisScanResult } from './types.js';
import { walkMassStorageContent } from './mass-storage-walker.js';

export const massStorageContentDebrisScanner: Scanner = {
  id: 'mass-storage-content-debris',
  name: 'Mass-storage content directories (.podkit-tmp residue)',
  applicableTo: ['mass-storage'],

  async scan(ctx: ScannerContext): Promise<DebrisScanResult> {
    if (!ctx.mountPoint || !ctx.contentPaths) {
      return { debris: [], totalBytes: 0 };
    }

    // Empty managedFiles set — the walker still categorises every file but
    // its orphan + missing buckets are ignored by debris consumers.
    const { debris: debrisPaths } = await walkMassStorageContent(
      ctx.mountPoint,
      ctx.contentPaths,
      new Set()
    );

    const debris = await Promise.all(
      debrisPaths.map(async (path) => {
        try {
          const s = await stat(path);
          return { path, bytes: s.size };
        } catch {
          return { path, bytes: 0 };
        }
      })
    );

    return {
      debris,
      totalBytes: debris.reduce((sum, d) => sum + d.bytes, 0),
    };
  },
};
