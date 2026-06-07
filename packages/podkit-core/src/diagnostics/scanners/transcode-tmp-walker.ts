/**
 * Shared walker for abandoned transcode scratch directories.
 *
 * podkit creates `<os.tmpdir()>/podkit-transcode-<uuid>/` per sync (see
 * `sync/music/pipeline.ts`) and removes it in a `finally` block. A
 * SIGKILLed process can't run that finally, so the dir lingers.
 *
 * **Concurrency safety via `.owner`.** Each live scratch dir contains an
 * `.owner` file written by the pipeline immediately after `mkdir` with
 * a `{pid, startTimeMs}` tuple. The walker probes the owner via
 * {@link isAlive} (kernel `kill(pid, 0)` + start-time tuple match guards
 * against PID reuse). Live owner → skip. Dead owner OR missing `.owner` →
 * reap.
 *
 * This replaces the previous mtime-based session-start floor. A daemon's
 * own prior cycle is now correctly detected as dead when its `.owner`
 * PID is no longer live, even though both cycles live inside one Node
 * process from the old floor's point of view. Sibling-process
 * protection is unchanged — a concurrent `podkit sync`'s `.owner` is
 * live, so its dir is left alone.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isAlive, readOwnership } from '../../lib/pid-file.js';

/** Name pattern emitted by the music pipeline. */
const TRANSCODE_DIR_PREFIX = 'podkit-transcode-';

/** Sibling marker file each live transcode dir carries. */
const OWNER_FILE = '.owner';

export interface AbandonedTranscodeDir {
  /** Absolute directory path. */
  path: string;
  /** Total size of the directory's contents (recursive sum). */
  bytes: number;
}

/**
 * Walk `tmpDir` and return every `podkit-transcode-<uuid>/` directory
 * whose `.owner` is missing, malformed, or points at a dead process.
 *
 * Dirs whose `.owner` points at a live process are always skipped — that
 * includes both the current Node process's own active dirs and any
 * sibling podkit process's active dirs.
 *
 * Tolerant of every individual stat / readdir failure: a file vanishing
 * mid-walk simply drops out of the result rather than throwing.
 */
export async function walkAbandonedTranscodeDirs(tmpDir: string): Promise<AbandonedTranscodeDir[]> {
  let entries;
  try {
    entries = await readdir(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const abandoned: AbandonedTranscodeDir[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(TRANSCODE_DIR_PREFIX)) continue;

    const full = join(tmpDir, entry.name);
    // Cheap exists-check before the owner probe so a deleted dir doesn't
    // throw through the bytes accounting.
    try {
      await stat(full);
    } catch {
      continue;
    }

    const owner = await readOwnership(join(full, OWNER_FILE));
    // Missing or malformed `.owner` → dir is either pre-`.owner` legacy
    // debris or a crash before the write — reap either way.
    if (owner === null) {
      abandoned.push({ path: full, bytes: await dirSize(full) });
      continue;
    }
    // Live owner → never touch.
    if (await isAlive(owner)) continue;
    // Dead owner → reap.
    abandoned.push({ path: full, bytes: await dirSize(full) });
  }

  return abandoned;
}

/** Recursive byte-size sum for a directory, tolerant of races. */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isFile()) {
        const s = await stat(full);
        total += s.size;
      } else if (entry.isDirectory()) {
        total += await dirSize(full);
      }
    } catch {
      // File vanished mid-walk; ignore.
    }
  }
  return total;
}

/**
 * Convenience deleter for use by the repair path. Returns the bytes that
 * were freed by the rm.
 */
export async function removeAbandonedDir(target: AbandonedTranscodeDir): Promise<number> {
  await rm(target.path, { recursive: true, force: true });
  return target.bytes;
}
