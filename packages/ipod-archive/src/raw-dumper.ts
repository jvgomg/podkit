/**
 * RawDumper — the stage-1 lossless copy.
 *
 * Recursively copies a set of whitelisted top-level trees from a mounted iPod
 * volume into a destination directory, hashing every file with SHA-256 *during*
 * the copy (a single read of each byte), and emits a `manifest.sha256` at the
 * dump root in `shasum -c`-compatible format.
 *
 * Design notes:
 * - Per-file read/write failures are recorded and the run continues — a single
 *   unreadable file on a dying device must not abort the whole dump.
 * - Symlinks are not followed; they are recorded as failures (an iPod data tree
 *   contains no legitimate symlinks, and following them risks escaping the
 *   volume). Treating them as failures keeps them visible in the report.
 * - Empty directories are recreated (so the tree shape is preserved) but
 *   contribute no manifest lines.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, opendir, lstat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** One verified file in the dump: its hash and dump-relative path. */
export interface ManifestEntry {
  /** Lowercase hex SHA-256 of the file's bytes. */
  sha256: string;
  /**
   * Path relative to the dump root, using POSIX separators. This is what the
   * manifest records and what `shasum -c` resolves against (run from the dump
   * root). e.g. `iPod_Control/Music/F00/ABCD.m4a`.
   */
  relativePath: string;
}

/** A file (or entry) that could not be copied. The run continues regardless. */
export interface DumpFailure {
  /** Source-relative path of the entry that failed. */
  path: string;
  /** Human-readable reason (the underlying error message). */
  error: string;
}

export interface RawDumpResult {
  /** One entry per successfully copied + hashed file. */
  manifest: ManifestEntry[];
  /** Entries that could not be copied (read error, symlink, etc.). */
  failures: DumpFailure[];
}

/** The manifest filename written at the dump root. */
export const MANIFEST_FILENAME = 'manifest.sha256';

/**
 * Render manifest entries into `shasum -c`-compatible text.
 *
 * Format per line: `<hex><SP><SP><relative/path>` (two spaces — the binary-mode
 * separator `shasum`/`sha256sum` accept). A trailing newline terminates the
 * file. Entries are sorted by path for deterministic, diff-friendly output.
 */
export function formatManifest(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return (
    sorted.map((e) => `${e.sha256}  ${e.relativePath}`).join('\n') + (sorted.length ? '\n' : '')
  );
}

/**
 * Copy a single file from `src` to `dest` while computing its SHA-256 in the
 * same pass. The read stream is tee'd: every chunk is both written to `dest`
 * and fed to the hash, so each byte is read exactly once.
 */
async function copyAndHash(src: string, dest: string): Promise<string> {
  const hash = createHash('sha256');
  const read = createReadStream(src);
  read.on('data', (chunk) => hash.update(chunk));
  await pipeline(read, createWriteStream(dest));
  return hash.digest('hex');
}

/**
 * Recursively walk `srcDir`, mirroring its structure under `destDir`, copying
 * and hashing each regular file. Accumulates manifest entries and failures.
 *
 * @param relPrefix - POSIX-joined path of `srcDir` relative to the dump root,
 *   used to label manifest entries and failures.
 */
async function dumpTree(
  srcDir: string,
  destDir: string,
  relPrefix: string,
  manifest: ManifestEntry[],
  failures: DumpFailure[],
  onFile?: () => void
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  let dir;
  try {
    dir = await opendir(srcDir);
  } catch (err) {
    failures.push({ path: relPrefix, error: errorMessage(err) });
    return;
  }

  for await (const entry of dir) {
    const childRel = relPrefix ? posix.join(relPrefix, entry.name) : entry.name;
    const childSrc = join(srcDir, entry.name);
    const childDest = join(destDir, entry.name);

    // Resolve type via lstat so symlinks are not silently followed. `opendir`
    // dirents can report DT_UNKNOWN on some filesystems, so we never trust
    // `entry.isDirectory()` alone for the symlink decision.
    let stat;
    try {
      stat = await lstat(childSrc);
    } catch (err) {
      failures.push({ path: childRel, error: errorMessage(err) });
      continue;
    }

    if (stat.isSymbolicLink()) {
      failures.push({ path: childRel, error: 'symbolic link skipped (not an iPod data file)' });
      continue;
    }

    if (stat.isDirectory()) {
      await dumpTree(childSrc, childDest, childRel, manifest, failures, onFile);
      continue;
    }

    if (!stat.isFile()) {
      failures.push({ path: childRel, error: 'not a regular file (skipped)' });
      continue;
    }

    try {
      const sha256 = await copyAndHash(childSrc, childDest);
      manifest.push({ sha256, relativePath: childRel });
      onFile?.();
    } catch (err) {
      failures.push({ path: childRel, error: errorMessage(err) });
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Copy the given top-level entries (the whitelist) from `srcRoot` into
 * `destDir`, hashing on the way, then write `manifest.sha256` at `destDir`.
 *
 * `destDir` is created if absent. The manifest covers every successfully
 * copied file across all entries; failures are returned, not thrown.
 *
 * @param srcRoot - mounted iPod volume root.
 * @param entriesToCopy - top-level entry names (typically the classifier's
 *   `copy` bucket). Missing entries are recorded as failures.
 * @param destDir - directory the dump tree is written into.
 * @param onFile - optional, side-effect-only callback invoked once per file
 *   successfully copied + hashed. Used by the orchestrator to drive live
 *   progress; it never affects the result.
 */
export async function dump(
  srcRoot: string,
  entriesToCopy: readonly string[],
  destDir: string,
  onFile?: () => void
): Promise<RawDumpResult> {
  const manifest: ManifestEntry[] = [];
  const failures: DumpFailure[] = [];

  await mkdir(destDir, { recursive: true });

  for (const entry of entriesToCopy) {
    const entrySrc = join(srcRoot, entry);
    const entryDest = join(destDir, entry);

    let stat;
    try {
      stat = await lstat(entrySrc);
    } catch (err) {
      failures.push({ path: entry, error: errorMessage(err) });
      continue;
    }

    if (stat.isSymbolicLink()) {
      failures.push({ path: entry, error: 'symbolic link skipped (not an iPod data file)' });
      continue;
    }

    if (stat.isDirectory()) {
      await dumpTree(entrySrc, entryDest, entry, manifest, failures, onFile);
    } else if (stat.isFile()) {
      // A whitelist entry can in principle be a plain file (e.g. a `Notes`
      // file rather than a directory). Copy it directly.
      try {
        const sha256 = await copyAndHash(entrySrc, entryDest);
        manifest.push({ sha256, relativePath: entry });
        onFile?.();
      } catch (err) {
        failures.push({ path: entry, error: errorMessage(err) });
      }
    } else {
      failures.push({ path: entry, error: 'not a regular file or directory (skipped)' });
    }
  }

  await writeFile(join(destDir, MANIFEST_FILENAME), formatManifest(manifest), 'utf8');

  return { manifest, failures };
}
