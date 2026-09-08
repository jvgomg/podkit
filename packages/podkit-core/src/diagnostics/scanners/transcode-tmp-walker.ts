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
 * against PID reuse). Live owner → skip. Dead owner → reap.
 *
 * **The ownerless grace window (TASK-501).** `.owner` cannot be created in
 * the same syscall as the `mkdir` that precedes it, so every live scratch
 * dir passes through a window in which it exists with no owner marker.
 * Treating that as debris deleted the output directory of a running sync,
 * and every transcode after it failed with FFmpeg exit 254 (ENOENT) — the
 * whole sync at once, `bytesTransferred: 0`. It only ever bit under load,
 * where the gap between the two operations stretches from microseconds to
 * whatever the event loop takes to come back.
 *
 * A missing `.owner` is only legitimate on debris — pre-`.owner` leftovers
 * or a crash — and debris is by definition not brand new. So age is what
 * separates the two: an ownerless dir is left alone until it has gone
 * {@link OWNERLESS_GRACE_MS} without being touched. A dead *owner* is
 * unambiguous and is still reaped on sight, so a SIGKILLed session's
 * leftovers are cleared by the very next sync as before.
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

/**
 * How long an `.owner`-less dir is left alone before it counts as debris.
 *
 * Only has to outlast the gap between a sibling's `mkdir` and its
 * `writeOwnership` — three filesystem operations plus however long a
 * saturated host takes to schedule the continuation between them. A minute
 * is far beyond any plausible stall, and the cost of being generous is only
 * that genuine debris survives until the next sweep.
 */
const OWNERLESS_GRACE_MS = 60_000;

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
    // throw through the bytes accounting. The mtime it returns is also what
    // decides the ownerless case below.
    let stats;
    try {
      stats = await stat(full);
    } catch {
      continue;
    }

    const owner = await readOwnership(join(full, OWNER_FILE));
    // Missing or malformed `.owner` → either pre-`.owner` legacy debris, a
    // crash before the write, or a sibling still setting itself up. Only the
    // first two are ours to delete, and only they can be old.
    if (owner === null) {
      if (Date.now() - stats.mtimeMs < OWNERLESS_GRACE_MS) continue;
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
