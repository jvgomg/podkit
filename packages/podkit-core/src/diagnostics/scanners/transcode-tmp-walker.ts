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
 * {@link probeLiveness} (kernel `kill(pid, 0)` + start-time tuple match
 * guards against PID reuse). Live owner → skip. Owner PID gone → reap.
 *
 * **Reaping is irreversible here, so only proof of death counts.** A false
 * "dead" deletes a running sync's output directory and fails every transcode
 * after it, so unlike the sync lock the walker never acts on an ambiguous
 * verdict (see `docs/architecture/sync/planning.md` §6). The two ambiguous
 * cases wait for inactivity instead:
 *
 * - *No `.owner`.* It cannot be created in the same syscall as the `mkdir`
 *   before it, so every live scratch dir passes through a window with no
 *   marker; under load that gap stretches to whatever the event loop takes.
 *   Left alone until untouched for {@link OWNERLESS_GRACE_MS}.
 * - *Owner `unknown`.* The PID exists but cannot be tied to the record — PID
 *   reuse, or a live owner the probe misjudged. Left alone until untouched
 *   for {@link UNVERIFIED_OWNER_GRACE_MS}.
 *
 * "Touched" is the newest mtime anywhere in the dir, not the dir's own: a
 * long transcode grows one file without changing the directory entry.
 *
 * Only a missing PID is unambiguous, and that is the SIGKILL case — so a
 * killed session's leftovers are still cleared by the very next sync.
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
import { probeLiveness, readOwnership } from '../../lib/pid-file.js';

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

/**
 * How long a dir whose owner probes `unknown` is left alone after its last
 * write before it counts as debris.
 *
 * Has to outlast the longest stretch a live sync goes without writing to its
 * scratch dir — a transcode queue stalled behind a slow device copy — rather
 * than one scheduling gap, so it is far wider than the ownerless window.
 */
const UNVERIFIED_OWNER_GRACE_MS = 60 * 60_000;

export interface AbandonedTranscodeDir {
  /** Absolute directory path. */
  path: string;
  /** Total size of the directory's contents (recursive sum). */
  bytes: number;
}

/**
 * Walk `tmpDir` and return every `podkit-transcode-<uuid>/` directory
 * whose `.owner` points at a PID that no longer exists, or whose `.owner`
 * is missing, malformed or unverifiable and nothing in it has been touched
 * for the matching grace window.
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
    let dirMtimeMs;
    try {
      dirMtimeMs = (await stat(full)).mtimeMs;
    } catch {
      continue;
    }

    const owner = await readOwnership(join(full, OWNER_FILE));
    // A missing PID is the one verdict that proves the owner gone; every
    // other non-live answer has to be confirmed by inactivity.
    let requiredQuietMs: number | 'none' = OWNERLESS_GRACE_MS;
    if (owner !== null) {
      const liveness = await probeLiveness(owner);
      if (liveness === 'alive') continue;
      requiredQuietMs = liveness === 'dead' ? 'none' : UNVERIFIED_OWNER_GRACE_MS;
    }

    const { bytes, newestMtimeMs } = await dirStats(full);
    const lastTouchedMs = Math.max(dirMtimeMs, newestMtimeMs);
    if (requiredQuietMs !== 'none' && Date.now() - lastTouchedMs < requiredQuietMs) continue;
    abandoned.push({ path: full, bytes });
  }

  return abandoned;
}

/**
 * Recursive byte-size sum and newest file/subdir mtime for a directory,
 * tolerant of races.
 */
async function dirStats(dir: string): Promise<{ bytes: number; newestMtimeMs: number }> {
  let bytes = 0;
  let newestMtimeMs = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, newestMtimeMs };
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isFile()) {
        const s = await stat(full);
        bytes += s.size;
        newestMtimeMs = Math.max(newestMtimeMs, s.mtimeMs);
      } else if (entry.isDirectory()) {
        const s = await stat(full);
        const sub = await dirStats(full);
        bytes += sub.bytes;
        newestMtimeMs = Math.max(newestMtimeMs, s.mtimeMs, sub.newestMtimeMs);
      }
    } catch {
      // File vanished mid-walk; ignore.
    }
  }
  return { bytes, newestMtimeMs };
}

/**
 * Convenience deleter for use by the repair path. Returns the bytes that
 * were freed by the rm.
 */
export async function removeAbandonedDir(target: AbandonedTranscodeDir): Promise<number> {
  await rm(target.path, { recursive: true, force: true });
  return target.bytes;
}
