/**
 * Shared walker for mass-storage content directories.
 *
 * Walks the configured content paths once and categorises every file into
 * media (real audio/video), debris (`.podkit-tmp` and adapter-failure
 * extensions), or "missing" — manifest entries with no file on disk. The
 * `orphan-files-mass-storage` and `debris-files-mass-storage` checks share
 * this walker; the future pre-sync sweep (TASK-398) reaches the same code
 * path via the scanner registry, so no surface walks twice.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import {
  PODKIT_DIR,
  isMediaExtension,
  isDebrisExtension,
} from '../../device/mass-storage-utils.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

// ── Result types ─────────────────────────────────────────────────────────────

/**
 * Categorised survey of a mass-storage device's content directories.
 *
 * `orphans` and `missingTrackedFiles` are user-facing concerns (a file the
 * user dropped onto the device, or a manifest entry whose backing file
 * vanished). `debris` is always safe to delete by construction.
 */
export interface MassStorageScanResult {
  /** Media files on disk that are not in the manifest. */
  orphans: string[];
  /** Files matching a debris extension (`.podkit-tmp`, `.Audio file`, ...). */
  debris: string[];
  /** Manifest entries whose backing file no longer exists. */
  missingTrackedFiles: string[];
  /** Unique media files seen on disk (denominator for pass summaries). */
  totalFiles: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format bytes as a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Get the size of each file, returning entries with path and size.
 * Files that can't be stat'd are included with size 0.
 */
export async function getFileSizes(
  paths: string[]
): Promise<Array<{ path: string; size: number }>> {
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
 * Recursively scan a directory and categorise each file as media or
 * adapter-failure debris (weird-extension residue from aborted syncs).
 *
 * Skips dotfiles (`._*`, `.DS_Store`, etc.), the `.podkit` directory, and any
 * directories listed in `excludeDirs` (absolute paths). One traversal returns
 * both categories so the orphan and debris checks never double-walk.
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
 * Determine which absolute directory paths to scan based on content paths.
 * Returns deduplicated list of directories that exist on disk plus the
 * exclusion set (always includes `.podkit`).
 *
 * Exported so the orphan repair can know the content-root boundary when
 * pruning empty directories after deletion.
 */
export function resolveContentDirs(
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
    const alreadyCovered = scanDirs.some(
      (parent) => dir.startsWith(parent + '/') || dir === parent
    );
    if (!alreadyCovered) {
      scanDirs.push(dir);
    }
  }

  // Build exclude set: always exclude .podkit
  const excludeDirs = new Set<string>();
  excludeDirs.add(podkitDir);

  return { scanDirs, excludeDirs };
}

// ── Top-level walk ───────────────────────────────────────────────────────────

/**
 * Walk the configured content directories and produce the full categorised
 * survey. One filesystem traversal yields every category the orphan + debris
 * + pre-sync sweep consumers need.
 *
 * Pass an empty `managedFiles` set when the caller only cares about debris
 * (e.g. the scanner registry's debris-only consumer) — orphan + missing
 * categories will be populated relative to "nothing is tracked", but the
 * caller can simply ignore them.
 */
export async function walkMassStorageContent(
  mountPoint: string,
  contentPaths: ContentPaths,
  managedFiles: Set<string>
): Promise<MassStorageScanResult> {
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

  const orphans = uniqueMedia.filter((f) => {
    // Normalize to NFC — macOS filesystems may return NFD from readdir
    const relativePath = relative(mountPoint, f).normalize('NFC');
    return !managedFiles.has(relativePath);
  });

  // Symmetric pass: manifest entries with no file on disk. stat() per entry
  // is fine for typical libraries (parallel via Promise.all).
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
    orphans,
    debris: uniqueDebris,
    missingTrackedFiles,
    totalFiles: uniqueMedia.length,
  };
}
