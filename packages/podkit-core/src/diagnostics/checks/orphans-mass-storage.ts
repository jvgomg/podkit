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
  isDebrisExtension,
  type MassStorageManifest,
} from '../../device/mass-storage-utils.js';
import { atomicWriteFile } from '../../utils/atomic-fs.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

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
 * Recursively scan a directory and categorise each file as media or
 * adapter-failure debris (weird-extension residue from aborted syncs).
 *
 * Skips dotfiles (._*, .DS_Store, etc.), the .podkit directory, and any
 * directories listed in `excludeDirs` (absolute paths). One traversal returns
 * both categories so the orphan check doesn't double-walk.
 */
async function scanFiles(
  dir: string,
  excludeDirs: Set<string>
): Promise<{ media: string[]; debris: string[] }> {
  const media: string[] = [];
  const debris: string[] = [];

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
        if (!ext) continue;
        if (isMediaExtension(ext)) {
          media.push(fullPath);
        } else if (isDebrisExtension(ext)) {
          debris.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return { media, debris };
}

/**
 * Get the size of each file, returning entries with path and size.
 * Files that can't be stat'd are included with size 0.
 */
async function getFileSizes(paths: string[]): Promise<Array<{ path: string; size: number }>> {
  const results: Array<{ path: string; size: number }> = [];
  for (const filePath of paths) {
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
 * Find orphan files, adapter-failure debris, and manifest entries with no
 * backing file. Scans content directories once and joins with the manifest's
 * managed-files set both ways:
 *   - Disk-side: media files not in the manifest → orphans
 *   - Disk-side: weird-extension residue → debris
 *   - Manifest-side: tracked paths with no file on disk → missingTrackedFiles
 *     (typically caused by user-deleted files; the
 *     copyTrackFile-failure-before-save pathway was closed by TASK-364)
 */
async function findIssues(
  mountPoint: string,
  contentPaths: ContentPaths,
  managedFiles: Set<string>
): Promise<{
  orphanPaths: string[];
  debrisPaths: string[];
  missingTrackedFiles: string[];
  totalFiles: number;
}> {
  const { scanDirs, excludeDirs } = resolveContentDirs(mountPoint, contentPaths);

  const allMedia: string[] = [];
  const allDebris: string[] = [];
  for (const dir of scanDirs) {
    const { media, debris } = await scanFiles(dir, excludeDirs);
    allMedia.push(...media);
    allDebris.push(...debris);
  }

  // Deduplicate in case of overlapping scans
  const uniqueMedia = [...new Set(allMedia)];
  const uniqueDebris = [...new Set(allDebris)];

  const orphanPaths = uniqueMedia.filter((f) => {
    // Normalize to NFC — macOS filesystems may return NFD from readdir
    const relativePath = relative(mountPoint, f).normalize('NFC');
    return !managedFiles.has(relativePath);
  });

  // Symmetric pass: manifest entries with no file on disk. stat() per entry
  // is fine for typical libraries (one syscall per managed file, parallel via
  // Promise.all).
  const missingChecks = await Promise.all(
    [...managedFiles].map(async (rel) => {
      try {
        await stat(join(mountPoint, rel));
        return null;
      } catch {
        return rel;
      }
    })
  );
  const missingTrackedFiles = missingChecks.filter((r): r is string => r !== null);

  return {
    orphanPaths,
    debrisPaths: uniqueDebris,
    missingTrackedFiles,
    totalFiles: uniqueMedia.length,
  };
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

    const { orphanPaths, debrisPaths, missingTrackedFiles, totalFiles } = await findIssues(
      ctx.mountPoint,
      ctx.contentPaths,
      managedFiles
    );

    if (orphanPaths.length === 0 && debrisPaths.length === 0 && missingTrackedFiles.length === 0) {
      return {
        status: 'pass',
        summary: `All ${totalFiles} file${totalFiles === 1 ? '' : 's'} on disk are tracked in the manifest`,
        repairable: false,
        details: {
          orphanCount: 0,
          wastedBytes: 0,
          orphans: [],
          debrisCount: 0,
          debris: [],
          missingTrackedFiles: [],
        },
      };
    }

    const orphans = await getFileSizes(orphanPaths);
    const debris = await getFileSizes(debrisPaths);
    const totalSize =
      orphans.reduce((sum, o) => sum + o.size, 0) + debris.reduce((sum, d) => sum + d.size, 0);

    // Build a summary that lists only the non-zero issue classes. Keeps
    // "${N} orphan files" as the leading phrase when orphans are the only
    // class — preserves existing summary-substring assertions.
    const parts: string[] = [];
    if (orphans.length > 0) {
      parts.push(`${orphans.length} orphan file${orphans.length === 1 ? '' : 's'}`);
    }
    if (debris.length > 0) {
      parts.push(`${debris.length} debris file${debris.length === 1 ? '' : 's'}`);
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
        debrisCount: debris.length,
        debris: debris.map((d) => ({ path: d.path, size: d.size })),
        missingTrackedFiles,
      },
    };
  },

  repair: {
    description:
      'Delete orphans + adapter-failure debris and prune manifest entries with no backing file',
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      if (!ctx.contentPaths) {
        return { success: false, summary: 'No content paths configured' };
      }

      const managedFiles = await loadManagedFiles(ctx.mountPoint);
      if (!managedFiles) {
        return { success: false, summary: 'No state manifest found' };
      }

      const { orphanPaths, debrisPaths, missingTrackedFiles } = await findIssues(
        ctx.mountPoint,
        ctx.contentPaths,
        managedFiles
      );
      const orphans = await getFileSizes(orphanPaths);
      const debris = await getFileSizes(debrisPaths);
      const deletables = [...orphans, ...debris];
      const totalSize = deletables.reduce((sum, e) => sum + e.size, 0);
      const phantomCount = missingTrackedFiles.length;

      if (deletables.length === 0 && phantomCount === 0) {
        return { success: true, summary: 'Nothing to clean up' };
      }

      // Dry run — report what would be cleaned
      if (options?.dryRun) {
        const parts: string[] = [];
        if (orphans.length > 0)
          parts.push(`${orphans.length} orphan file${orphans.length === 1 ? '' : 's'}`);
        if (debris.length > 0)
          parts.push(`${debris.length} debris file${debris.length === 1 ? '' : 's'}`);
        if (phantomCount > 0)
          parts.push(`${phantomCount} phantom manifest entr${phantomCount === 1 ? 'y' : 'ies'}`);
        return {
          success: true,
          summary: `Dry run: ${parts.join(' + ')} would be cleaned, freeing ${formatBytes(totalSize)}`,
          details: {
            orphanCount: orphans.length,
            debrisCount: debris.length,
            phantomCount,
            freedBytes: totalSize,
            freedFormatted: formatBytes(totalSize),
            files: deletables.map((e) => ({ path: e.path, size: e.size })),
            missingTrackedFiles,
          },
        };
      }

      // Real run — delete orphans + debris, then prune phantom manifest entries
      let deleted = 0;
      let freedBytes = 0;
      const errors: string[] = [];

      // Determine content root directories for cleanup boundary
      const { scanDirs } = resolveContentDirs(ctx.mountPoint, ctx.contentPaths);

      for (let i = 0; i < deletables.length; i++) {
        const entry = deletables[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: deletables.length,
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
