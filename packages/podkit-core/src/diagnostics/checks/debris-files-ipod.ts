/**
 * Debris file detection for iPod devices.
 *
 * Surfaces `.podkit-tmp` residue across every `iPod_Control/` directory
 * podkit writes into. After TASK-376 routed portable tag-writes through
 * `atomicWriteFileWithSync`, an interrupted sync can leave these tmps
 * anywhere — not just under `iPod_Control/Music/F**`. The walker keys on
 * the suffix, not the path.
 *
 * Repair is safe-by-design: every `.podkit-tmp` represents an incomplete
 * atomic-write that never finished; the destination either still has the
 * prior good version or is missing entirely. Deleting the tmp loses no
 * intended state. The CLI will skip its confirmation prompt for this check
 * once the unified-IDs commit lands.
 */

import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';
import { walkIpodContentForDebris } from '../scanners/ipod-walker.js';
import { formatBytes, getFileSizes } from '../scanners/mass-storage-walker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up from a directory, deleting any that are empty, until either a
 * non-empty directory is hit or `iPod_Control/` is reached (we never
 * remove a top-level iPod surface).
 */
async function cleanEmptyDirs(startDir: string, mountPoint: string): Promise<void> {
  const ipodControl = join(mountPoint, 'iPod_Control');
  let current = startDir;
  while (current !== ipodControl && current.startsWith(ipodControl)) {
    try {
      const entries = await readdir(current);
      if (entries.length === 0) {
        await rmdir(current);
        current = dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

// ── Check ────────────────────────────────────────────────────────────────────

export const debrisFilesIpodCheck: DiagnosticCheck = {
  id: 'debris-files-ipod',
  name: 'Debris Files (iPod)',
  applicableTo: ['ipod'],
  scope: 'database-health',

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    // No mount point? Skip — there's no surface to walk. (Should not happen
    // in normal doctor invocation, but the framework allows reduced
    // contexts.)
    if (!ctx.mountPoint) {
      return { status: 'skip', summary: 'No mount point available', repairable: false };
    }

    const debrisPaths = await walkIpodContentForDebris(ctx.mountPoint);

    if (debrisPaths.length === 0) {
      return {
        status: 'pass',
        summary: 'No incomplete-write residue found',
        repairable: false,
        details: { debrisCount: 0, wastedBytes: 0, debris: [] },
      };
    }

    const debris = await getFileSizes(debrisPaths);
    const totalSize = debris.reduce((sum, d) => sum + d.size, 0);

    return {
      status: 'warn',
      summary: `${debris.length} debris file${debris.length === 1 ? '' : 's'} found (${formatBytes(totalSize)} wasted)`,
      repairable: true,
      details: {
        debrisCount: debris.length,
        wastedBytes: totalSize,
        wastedFormatted: formatBytes(totalSize),
        debris: debris.map((d) => ({ path: d.path, size: d.size })),
      },
    };
  },

  repair: {
    description:
      "Always-safe: delete podkit's incomplete-write residue from prior interrupted syncs",
    // No `'database'` requirement — the tmps live next to their intended
    // targets and don't touch the iTunesDB. This lets debris cleanup run
    // even when the DB is unopenable.
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      const debrisPaths = await walkIpodContentForDebris(ctx.mountPoint);
      const debris = await getFileSizes(debrisPaths);
      const totalSize = debris.reduce((sum, d) => sum + d.size, 0);

      if (debris.length === 0) {
        return { success: true, summary: 'No debris to clean up' };
      }

      if (options?.dryRun) {
        return {
          success: true,
          summary: `Dry run: ${debris.length} debris file${debris.length === 1 ? '' : 's'} would be cleaned, freeing ${formatBytes(totalSize)}`,
          details: {
            debrisCount: debris.length,
            freedBytes: totalSize,
            freedFormatted: formatBytes(totalSize),
            files: debris.map((d) => ({ path: d.path, size: d.size })),
          },
        };
      }

      let deleted = 0;
      let freedBytes = 0;
      const errors: string[] = [];

      for (let i = 0; i < debris.length; i++) {
        const entry = debris[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: debris.length,
          path: entry.path,
        });

        try {
          // Re-stat right before unlinking — if a concurrent process beat
          // us to it, treat the now-missing path as success rather than
          // surfacing a confusing error.
          await stat(entry.path);
          await unlink(entry.path);
          deleted++;
          freedBytes += entry.size;
          await cleanEmptyDirs(dirname(entry.path), ctx.mountPoint);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // File already gone (concurrent cleanup, manual delete, etc.)
            deleted++;
            continue;
          }
          errors.push(
            `Failed to delete ${entry.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        success: errors.length === 0,
        summary: `Deleted ${deleted} debris file${deleted === 1 ? '' : 's'}, freed ${formatBytes(freedBytes)}${errors.length > 0 ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''}`,
        details: {
          deleted,
          freedBytes,
          freedFormatted: formatBytes(freedBytes),
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  },
};
