/**
 * Scanner registration for abandoned transcode scratch directories.
 *
 * Walks `os.tmpdir()` for `podkit-transcode-<uuid>/` directories older than
 * the session start. The mtime-based safety floor (see `transcode-tmp-walker.ts`)
 * guarantees we never reap a concurrent sibling process's in-flight scratch.
 *
 * Host-scoped (`applicableTo: ['host']`) — runs without a device attached.
 * The doctor `debris-transcode-tmp` check uses the same walker directly.
 */

import { tmpdir } from 'node:os';
import type { Scanner, ScannerContext, DebrisScanResult } from './types.js';
import { walkAbandonedTranscodeDirs } from './transcode-tmp-walker.js';

export const transcodeTmpDebrisScanner: Scanner = {
  id: 'transcode-tmp-debris',
  name: 'Abandoned transcode scratch directories',
  applicableTo: ['host'],

  async scan(ctx: ScannerContext): Promise<DebrisScanResult> {
    const abandoned = await walkAbandonedTranscodeDirs(tmpdir(), ctx.sessionStartMs);
    return {
      debris: abandoned.map((d) => ({ path: d.path, bytes: d.bytes })),
      totalBytes: abandoned.reduce((sum, d) => sum + d.bytes, 0),
    };
  },
};
