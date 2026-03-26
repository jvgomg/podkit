/**
 * Orphan file detection diagnostic check
 *
 * Scans iPod_Control/Music/F* directories for audio/video files that are
 * physically present on disk but not referenced by any track in the iTunesDB.
 * These orphaned files waste storage space and can accumulate over time from
 * interrupted syncs or manual file manipulation.
 */

import { readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

/**
 * Convert an iPod colon-separated path to a filesystem path.
 *
 * iPod paths look like `:iPod_Control:Music:F00:file.m4a`
 * Filesystem paths look like `<mountPoint>/iPod_Control/Music/F00/file.m4a`
 */
function ipodPathToFilesystem(mountPoint: string, ipodPath: string): string {
  // Strip leading colon(s) and replace all colons with path separators
  const relativePath = ipodPath.replace(/^:+/, '').replace(/:/g, '/');
  return join(mountPoint, relativePath);
}

/** Format bytes as a human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Scan all F* directories under iPod_Control/Music and return the absolute
 * paths of every file found.
 */
async function scanMusicFiles(musicDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(musicDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const fDirs = entries.filter((e) => e.isDirectory() && /^F\d+$/i.test(e.name));
  const allFiles: string[] = [];

  for (const dir of fDirs) {
    const dirPath = join(musicDir, dir.name);
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        // Skip macOS resource fork files (._*)
        if (file.startsWith('._')) continue;
        allFiles.push(join(dirPath, file));
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return allFiles;
}

/**
 * Get the size of each orphan file, returning entries with path and size.
 * Files that can't be stat'd are included with size 0.
 */
async function getOrphanSizes(
  orphanPaths: string[]
): Promise<Array<{ path: string; size: number }>> {
  const results: Array<{ path: string; size: number }> = [];
  for (const path of orphanPaths) {
    try {
      const s = await stat(path);
      results.push({ path, size: s.size });
    } catch {
      results.push({ path, size: 0 });
    }
  }
  return results;
}

export const orphanFilesCheck: DiagnosticCheck = {
  id: 'orphan-files',
  name: 'Orphan Files',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    if (!ctx.db) {
      return { status: 'skip', summary: 'No iPod database', repairable: false };
    }

    const musicDir = join(ctx.mountPoint, 'iPod_Control', 'Music');

    // Check if music directory exists
    try {
      await stat(musicDir);
    } catch {
      return {
        status: 'skip',
        summary: 'No music directory found',
        repairable: false,
      };
    }

    // Build set of known track paths from the database
    const tracks = ctx.db.getTracks();
    const knownPaths = new Set<string>();
    for (const track of tracks) {
      if (track.filePath) {
        knownPaths.add(ipodPathToFilesystem(ctx.mountPoint, track.filePath));
      }
    }

    // Scan filesystem for all files in F* directories
    const diskFiles = await scanMusicFiles(musicDir);

    // Find orphans — files on disk not referenced by any track
    const orphanPaths = diskFiles.filter((f) => !knownPaths.has(f));

    if (orphanPaths.length === 0) {
      return {
        status: 'pass',
        summary: `All ${diskFiles.length} file${diskFiles.length === 1 ? '' : 's'} on disk are referenced by tracks`,
        repairable: false,
      };
    }

    // Calculate total wasted space
    const orphans = await getOrphanSizes(orphanPaths);
    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

    return {
      status: 'warn',
      summary: `${orphans.length} orphan file${orphans.length === 1 ? '' : 's'} found (${formatBytes(totalSize)} wasted)`,
      repairable: true,
      details: {
        orphanCount: orphans.length,
        totalFiles: diskFiles.length,
        wastedBytes: totalSize,
        wastedFormatted: formatBytes(totalSize),
        orphans: orphans.map((o) => ({ path: o.path, size: o.size })),
      },
    };
  },

  repair: {
    description: 'Delete orphaned files not referenced by any track in the database',
    requirements: ['writable-device'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      const musicDir = join(ctx.mountPoint, 'iPod_Control', 'Music');

      // Build set of known track paths
      const tracks = ctx.db!.getTracks();
      const knownPaths = new Set<string>();
      for (const track of tracks) {
        if (track.filePath) {
          knownPaths.add(ipodPathToFilesystem(ctx.mountPoint, track.filePath));
        }
      }

      // Scan and find orphans
      const diskFiles = await scanMusicFiles(musicDir);
      const orphanPaths = diskFiles.filter((f) => !knownPaths.has(f));
      const orphans = await getOrphanSizes(orphanPaths);
      const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

      if (orphans.length === 0) {
        return {
          success: true,
          summary: 'No orphan files to delete',
        };
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
        } catch (error) {
          errors.push(
            `Failed to delete ${orphan.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Clean up empty F* directories
      try {
        const entries = await readdir(musicDir, { withFileTypes: true });
        const fDirs = entries.filter((e) => e.isDirectory() && /^F\d+$/i.test(e.name));

        for (const dir of fDirs) {
          const dirPath = join(musicDir, dir.name);
          try {
            const remaining = await readdir(dirPath);
            if (remaining.length === 0) {
              await rmdir(dirPath);
            }
          } catch {
            // Ignore errors when cleaning up directories
          }
        }
      } catch {
        // Ignore errors when scanning for empty directories
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
