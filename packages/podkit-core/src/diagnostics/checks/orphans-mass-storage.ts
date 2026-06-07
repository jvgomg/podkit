/**
 * Orphan file detection for mass-storage devices
 *
 * Scans configured content directories for **media files** that are
 * physically present on disk but not tracked in `.podkit/state.json`.
 * "Orphan" here means user-owned: the file could have been placed there
 * intentionally (pre-podkit content, manual copy) so repair is gated by a
 * confirmation prompt. podkit's own in-flight residue (`.podkit-tmp`,
 * `.Audio file`) lives in a separate `debris-files-mass-storage` check
 * with non-interactive safe-auto repair.
 *
 * Same walker, two checks — the shared traversal in
 * `../scanners/mass-storage-walker.ts` produces both buckets in one pass.
 */

import { readdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';
import {
  PODKIT_DIR,
  MANIFEST_FILE,
  type MassStorageManifest,
} from '../../device/mass-storage-utils.js';
import { atomicWriteFile } from '../../utils/atomic-fs.js';
import {
  walkMassStorageContent,
  resolveContentDirs,
  getFileSizes,
  formatBytes,
} from '../scanners/mass-storage-walker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Load the managed files set from the device's state.json manifest.
 * Returns undefined if the manifest doesn't exist or can't be parsed.
 */
async function loadManagedFiles(mountPoint: string): Promise<Set<string> | undefined> {
  const manifestPath = join(mountPoint, PODKIT_DIR, MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as MassStorageManifest;
    if (parsed.version === 1 && Array.isArray(parsed.managedFiles)) {
      // Normalize to NFC for consistent comparison with filesystem paths
      return new Set(parsed.managedFiles.map((p: string) => p.normalize('NFC')));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remove empty directories by walking up from a starting directory
 * toward (but not including) the stop directory.
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

export const orphanFilesMassStorageCheck: DiagnosticCheck = {
  id: 'orphan-files-mass-storage',
  name: 'Orphan Files (Mass Storage)',
  applicableTo: ['mass-storage'],
  scope: 'database-health',

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    if (!ctx.contentPaths) {
      return { status: 'skip', summary: 'No content paths configured', repairable: false };
    }

    const managedFiles = await loadManagedFiles(ctx.mountPoint);
    if (!managedFiles) {
      return {
        status: 'skip',
        summary: 'No state manifest found — run a sync first',
        repairable: false,
      };
    }

    const {
      orphans: orphanPaths,
      missingTrackedFiles,
      totalFiles,
    } = await walkMassStorageContent(ctx.mountPoint, ctx.contentPaths, managedFiles);

    if (orphanPaths.length === 0 && missingTrackedFiles.length === 0) {
      return {
        status: 'pass',
        summary: `All ${totalFiles} file${totalFiles === 1 ? '' : 's'} on disk are tracked in the manifest`,
        repairable: false,
        details: {
          orphanCount: 0,
          wastedBytes: 0,
          orphans: [],
          missingTrackedFiles: [],
        },
      };
    }

    const orphans = await getFileSizes(orphanPaths);
    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

    const parts: string[] = [];
    if (orphans.length > 0) {
      parts.push(`${orphans.length} orphan file${orphans.length === 1 ? '' : 's'}`);
    }
    if (missingTrackedFiles.length > 0) {
      parts.push(
        `${missingTrackedFiles.length} missing manifest entr${
          missingTrackedFiles.length === 1 ? 'y' : 'ies'
        }`
      );
    }

    return {
      status: 'warn',
      summary: `${parts.join(' + ')} found (${formatBytes(totalSize)} wasted)`,
      repairable: true,
      details: {
        orphanCount: orphans.length,
        totalFiles,
        wastedBytes: totalSize,
        wastedFormatted: formatBytes(totalSize),
        orphans: orphans.map((o) => ({ path: o.path, size: o.size })),
        missingTrackedFiles,
      },
    };
  },

  repair: {
    description: 'Delete orphan files and prune manifest entries with no backing file',
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      if (!ctx.contentPaths) {
        return { success: false, summary: 'No content paths configured' };
      }

      const managedFiles = await loadManagedFiles(ctx.mountPoint);
      if (!managedFiles) {
        return { success: false, summary: 'No state manifest found' };
      }

      const { orphans: orphanPaths, missingTrackedFiles } = await walkMassStorageContent(
        ctx.mountPoint,
        ctx.contentPaths,
        managedFiles
      );
      const orphans = await getFileSizes(orphanPaths);
      const totalSize = orphans.reduce((sum, e) => sum + e.size, 0);
      const phantomCount = missingTrackedFiles.length;

      if (orphans.length === 0 && phantomCount === 0) {
        return { success: true, summary: 'Nothing to clean up' };
      }

      // Dry run — report what would be cleaned
      if (options?.dryRun) {
        const parts: string[] = [];
        if (orphans.length > 0)
          parts.push(`${orphans.length} orphan file${orphans.length === 1 ? '' : 's'}`);
        if (phantomCount > 0)
          parts.push(`${phantomCount} phantom manifest entr${phantomCount === 1 ? 'y' : 'ies'}`);
        return {
          success: true,
          summary: `Dry run: ${parts.join(' + ')} would be cleaned, freeing ${formatBytes(totalSize)}`,
          details: {
            orphanCount: orphans.length,
            phantomCount,
            freedBytes: totalSize,
            freedFormatted: formatBytes(totalSize),
            files: orphans.map((e) => ({ path: e.path, size: e.size })),
            missingTrackedFiles,
          },
        };
      }

      // Real run — delete orphans, then prune phantom manifest entries
      let deleted = 0;
      let freedBytes = 0;
      const errors: string[] = [];

      const { scanDirs } = resolveContentDirs(ctx.mountPoint, ctx.contentPaths);

      for (let i = 0; i < orphans.length; i++) {
        const entry = orphans[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: orphans.length,
          path: entry.path,
        });

        try {
          await unlink(entry.path);
          deleted++;
          freedBytes += entry.size;

          // Clean up empty directories — walk up to the content root
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

      // Prune phantom manifest entries by rewriting the manifest atomically.
      // Re-read on disk to avoid clobbering concurrent edits, then drop the
      // missing entries from managedFiles. `phantomsPruned` is only set after
      // atomicWriteFile completes — otherwise a failed rewrite would report
      // a non-zero prune count alongside a "failed to prune" error.
      let phantomsPruned = 0;
      if (phantomCount > 0) {
        try {
          const manifestPath = join(ctx.mountPoint, PODKIT_DIR, MANIFEST_FILE);
          const raw = await readFile(manifestPath, 'utf-8');
          const parsed = JSON.parse(raw) as MassStorageManifest;
          if (parsed.version === 1 && Array.isArray(parsed.managedFiles)) {
            const missingSet = new Set(missingTrackedFiles);
            const before = parsed.managedFiles.length;
            parsed.managedFiles = parsed.managedFiles.filter(
              (p) => !missingSet.has(p.normalize('NFC'))
            );
            atomicWriteFile(manifestPath, JSON.stringify(parsed) + '\n', 'utf-8');
            phantomsPruned = before - parsed.managedFiles.length;
          }
        } catch (error) {
          errors.push(
            `Failed to prune phantom manifest entries: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const summaryParts: string[] = [];
      summaryParts.push(`Deleted ${deleted} file${deleted === 1 ? '' : 's'}`);
      if (phantomsPruned > 0) {
        summaryParts.push(
          `pruned ${phantomsPruned} phantom manifest entr${phantomsPruned === 1 ? 'y' : 'ies'}`
        );
      }
      summaryParts.push(`freed ${formatBytes(freedBytes)}`);

      return {
        success: errors.length === 0,
        summary: `${summaryParts.join(', ')}${errors.length > 0 ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''}`,
        details: {
          deleted,
          phantomsPruned,
          freedBytes,
          freedFormatted: formatBytes(freedBytes),
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  },
};
