/**
 * Orphan file detection for mass-storage devices
 *
 * Scans configured content directories for media files that are physically
 * present on disk but not tracked in the .podkit/state.json manifest.
 * These orphaned files waste storage space and can accumulate from
 * interrupted syncs, manual file manipulation, or config changes.
 */

import { readdir, readFile, stat, unlink, rmdir } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
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
  isMediaExtension,
  type MassStorageManifest,
  type ContentPaths,
} from '../../device/mass-storage-utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format bytes as a human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

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
 * Recursively scan a directory for media files, returning their absolute paths.
 *
 * Skips dotfiles (._*, .DS_Store, etc.), the .podkit directory, and any
 * directories listed in `excludeDirs` (absolute paths).
 */
async function scanMediaFiles(dir: string, excludeDirs: Set<string>): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Skip dotfiles and dot-directories
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (excludeDirs.has(fullPath)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (ext && isMediaExtension(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Get the size of each orphan file, returning entries with path and size.
 * Files that can't be stat'd are included with size 0.
 */
async function getOrphanSizes(
  orphanPaths: string[]
): Promise<Array<{ path: string; size: number }>> {
  const results: Array<{ path: string; size: number }> = [];
  for (const filePath of orphanPaths) {
    try {
      const s = await stat(filePath);
      results.push({ path: filePath, size: s.size });
    } catch {
      results.push({ path: filePath, size: 0 });
    }
  }
  return results;
}

/**
 * Determine which absolute directory paths to scan based on content paths.
 * Returns deduplicated list of directories that exist on disk.
 */
function resolveContentDirs(
  mountPoint: string,
  contentPaths: ContentPaths
): { scanDirs: string[]; excludeDirs: Set<string> } {
  const podkitDir = join(mountPoint, PODKIT_DIR);

  // Collect all unique content directory absolute paths
  const dirEntries = [
    { key: 'musicDir', relative: contentPaths.musicDir },
    { key: 'moviesDir', relative: contentPaths.moviesDir },
    { key: 'tvShowsDir', relative: contentPaths.tvShowsDir },
  ];

  // Resolve to absolute paths; empty string = device root
  const resolved = dirEntries.map((d) => ({
    ...d,
    absolute: d.relative ? join(mountPoint, d.relative) : mountPoint,
  }));

  // Deduplicate and find the minimal set of directories to scan
  // (if one directory is a parent of another, only scan the parent)
  const uniqueDirs = new Map<string, string>();
  for (const entry of resolved) {
    uniqueDirs.set(entry.absolute, entry.key);
  }

  const scanDirs: string[] = [];
  const allAbsolute = [...uniqueDirs.keys()].sort();

  for (const dir of allAbsolute) {
    // Skip if this directory is already covered by a parent in scanDirs
    const alreadyCovered = scanDirs.some(
      (parent) => dir.startsWith(parent + '/') || dir === parent
    );
    if (!alreadyCovered) {
      scanDirs.push(dir);
    }
  }

  // Build exclude set: always exclude .podkit, and exclude content dirs
  // that are siblings when scanning from a parent
  const excludeDirs = new Set<string>();
  excludeDirs.add(podkitDir);

  return { scanDirs, excludeDirs };
}

/**
 * Find orphan files by scanning content directories and comparing against
 * the manifest's managed files set.
 */
async function findOrphans(
  mountPoint: string,
  contentPaths: ContentPaths,
  managedFiles: Set<string>
): Promise<{ orphanPaths: string[]; totalFiles: number }> {
  const { scanDirs, excludeDirs } = resolveContentDirs(mountPoint, contentPaths);

  const allFiles: string[] = [];
  for (const dir of scanDirs) {
    const files = await scanMediaFiles(dir, excludeDirs);
    allFiles.push(...files);
  }

  // Deduplicate in case of overlapping scans
  const uniqueFiles = [...new Set(allFiles)];

  const orphanPaths = uniqueFiles.filter((f) => {
    // Normalize to NFC — macOS filesystems may return NFD from readdir
    const relativePath = relative(mountPoint, f).normalize('NFC');
    return !managedFiles.has(relativePath);
  });

  return { orphanPaths, totalFiles: uniqueFiles.length };
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

    const { orphanPaths, totalFiles } = await findOrphans(
      ctx.mountPoint,
      ctx.contentPaths,
      managedFiles
    );

    if (orphanPaths.length === 0) {
      return {
        status: 'pass',
        summary: `All ${totalFiles} file${totalFiles === 1 ? '' : 's'} on disk are tracked in the manifest`,
        repairable: false,
      };
    }

    const orphans = await getOrphanSizes(orphanPaths);
    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

    return {
      status: 'warn',
      summary: `${orphans.length} orphan file${orphans.length === 1 ? '' : 's'} found (${formatBytes(totalSize)} wasted)`,
      repairable: true,
      details: {
        orphanCount: orphans.length,
        totalFiles,
        wastedBytes: totalSize,
        wastedFormatted: formatBytes(totalSize),
        orphans: orphans.map((o) => ({ path: o.path, size: o.size })),
      },
    };
  },

  repair: {
    description: 'Delete orphaned files not tracked in the state manifest',
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      if (!ctx.contentPaths) {
        return { success: false, summary: 'No content paths configured' };
      }

      const managedFiles = await loadManagedFiles(ctx.mountPoint);
      if (!managedFiles) {
        return { success: false, summary: 'No state manifest found' };
      }

      const { orphanPaths } = await findOrphans(ctx.mountPoint, ctx.contentPaths, managedFiles);
      const orphans = await getOrphanSizes(orphanPaths);
      const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

      if (orphans.length === 0) {
        return { success: true, summary: 'No orphan files to delete' };
      }

      // Dry run — report what would be deleted
      if (options?.dryRun) {
        return {
          success: true,
          summary: `Dry run: ${orphans.length} orphan file${orphans.length === 1 ? '' : 's'} would be deleted, freeing ${formatBytes(totalSize)}`,
          details: {
            orphanCount: orphans.length,
            freedBytes: totalSize,
            freedFormatted: formatBytes(totalSize),
            files: orphans.map((o) => ({ path: o.path, size: o.size })),
          },
        };
      }

      // Real run — delete orphans
      let deleted = 0;
      let freedBytes = 0;
      const errors: string[] = [];

      // Determine content root directories for cleanup boundary
      const { scanDirs } = resolveContentDirs(ctx.mountPoint, ctx.contentPaths);

      for (let i = 0; i < orphans.length; i++) {
        const orphan = orphans[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: orphans.length,
          path: orphan.path,
        });

        try {
          await unlink(orphan.path);
          deleted++;
          freedBytes += orphan.size;

          // Clean up empty directories — walk up to the content root
          const parentDir = dirname(orphan.path);
          for (const contentRoot of scanDirs) {
            if (parentDir.startsWith(contentRoot)) {
              await cleanEmptyDirs(parentDir, contentRoot);
              break;
            }
          }
        } catch (error) {
          errors.push(
            `Failed to delete ${orphan.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        success: errors.length === 0,
        summary: `Deleted ${deleted} orphan file${deleted === 1 ? '' : 's'}, freed ${formatBytes(freedBytes)}${errors.length > 0 ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''}`,
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
