/**
 * Scanner registration for iPod content debris.
 *
 * Wraps `walkIpodContentForDebris` for consumption by the pre-sync sweep
 * (TASK-398). Doctor's `debris-files-ipod` check uses the same walker
 * directly — both code paths produce identical results.
 */

import { stat } from 'node:fs/promises';
import type { Scanner, ScannerContext, DebrisScanResult } from './types.js';
import { walkIpodContentForDebris } from './ipod-walker.js';

export const ipodContentDebrisScanner: Scanner = {
  id: 'ipod-content-debris',
  name: 'iPod content directories (.podkit-tmp residue)',
  applicableTo: ['ipod'],

  async scan(ctx: ScannerContext): Promise<DebrisScanResult> {
    if (!ctx.mountPoint) {
      return { debris: [], totalBytes: 0 };
    }

    const debrisPaths = await walkIpodContentForDebris(ctx.mountPoint);
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
