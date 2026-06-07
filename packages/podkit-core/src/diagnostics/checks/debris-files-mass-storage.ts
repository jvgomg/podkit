/**
 * Debris file detection for mass-storage devices
 *
 * Reports podkit's own in-flight write residue (`.podkit-tmp` and the
 * adapter-failure `.Audio file` extension) under the configured content
 * directories. Every such file is incomplete by construction — it was
 * created by an atomic-write tmp+rename that never finished. Repair is
 * therefore safe-by-design and the CLI does NOT prompt the user before
 * deletion.
 *
 * Splits the original `orphan-files-mass-storage` check: orphans (potentially
 * user-owned content) stay there with confirmation-gated repair; debris
 * (always podkit-owned) lives here with non-interactive repair.
 */

import { readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';
import {
  walkMassStorageContent,
  resolveContentDirs,
  getFileSizes,
  formatBytes,
} from '../scanners/mass-storage-walker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up from a directory, deleting any that are empty, until either a
 * non-empty directory is hit or the content root is reached.
 */
async function cleanEmptyDirs(startDir: string, stopDir: string): Promise<void> {
  let current = startDir;
  while (current !== stopDir && current.startsWith(stopDir)) {
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

export const debrisFilesMassStorageCheck: DiagnosticCheck = {
  id: 'debris-files-mass-storage',
  name: 'Debris Files (Mass Storage)',
  applicableTo: ['mass-storage'],
  scope: 'database-health',

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    if (!ctx.contentPaths) {
      return { status: 'skip', summary: 'No content paths configured', repairable: false };
    }

    // Debris is identified by file extension, not by manifest membership, so
    // we pass an empty managedFiles set and ignore the walker's orphan +
    // missing categories.
    const { debris: debrisPaths } = await walkMassStorageContent(
      ctx.mountPoint,
      ctx.contentPaths,
      new Set()
    );

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
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      if (!ctx.contentPaths) {
        return { success: false, summary: 'No content paths configured' };
      }

      const { debris: debrisPaths } = await walkMassStorageContent(
        ctx.mountPoint,
        ctx.contentPaths,
        new Set()
      );
      const debris = await getFileSizes(debrisPaths);
      const totalSize = debris.reduce((sum, d) => sum + d.size, 0);

      if (debris.length === 0) {
        return { success: true, summary: 'No debris to clean up' };
      }

      // Dry run
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

      // Real run
      let deleted = 0;
      let freedBytes = 0;
      const errors: string[] = [];
      const { scanDirs } = resolveContentDirs(ctx.mountPoint, ctx.contentPaths);

      for (let i = 0; i < debris.length; i++) {
        const entry = debris[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: debris.length,
          path: entry.path,
        });

        try {
          await unlink(entry.path);
          deleted++;
          freedBytes += entry.size;

          const parentDir = dirname(entry.path);
          for (const contentRoot of scanDirs) {
            if (parentDir.startsWith(contentRoot)) {
              await cleanEmptyDirs(parentDir, contentRoot);
              break;
            }
          }
        } catch (error) {
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
