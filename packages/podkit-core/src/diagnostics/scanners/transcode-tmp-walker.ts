/**
 * Shared walker for abandoned transcode scratch directories.
 *
 * podkit creates `<os.tmpdir()>/podkit-transcode-<uuid>/` per sync (see
 * `sync/music/pipeline.ts:804`) and removes it in a `finally` block. A
 * SIGKILLed process can't run that finally, so the dir lingers.
 *
 * **Concurrency safety floor.** `os.tmpdir()` is host-global; a daemon
 * and a manual CLI invocation can be active at the same time. We skip any
 * candidate whose `mtime` is `>= sessionStartMs` — those belong to a
 * concurrent sibling process and reaping them would corrupt an in-flight
 * sync. The mtime check is cheap and side-effect free, and is the cheapest
 * substitute for a true PID-based lock that still respects the
 * "never disturb a live process" invariant.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Name pattern emitted by `pipeline.ts:804`. */
const TRANSCODE_DIR_PREFIX = 'podkit-transcode-';

export interface AbandonedTranscodeDir {
  /** Absolute directory path. */
  path: string;
  /** Total size of the directory's contents (recursive sum). */
  bytes: number;
}

/**
 * Walk `tmpDir` and return every `podkit-transcode-<uuid>/` directory whose
 * `mtime` is strictly older than `sessionStartMs`.
 *
 * @param tmpDir          Host scratch root (typically `os.tmpdir()`).
 * @param sessionStartMs  Wall-clock floor — directories newer than this are
 *                        owned by a concurrent process and never returned.
 */
export async function walkAbandonedTranscodeDirs(
  tmpDir: string,
  sessionStartMs: number
): Promise<AbandonedTranscodeDir[]> {
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
    let dirStat;
    try {
      dirStat = await stat(full);
    } catch {
      continue;
    }
    // Concurrent-safety floor: anything younger than session start is live.
    if (dirStat.mtimeMs >= sessionStartMs) continue;

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
