/**
 * PID-file primitive with liveness probe.
 *
 * One small abstraction shared across podkit for cross-process coordination
 * on host-global or device-shared filesystems. The contents are a
 * `{ pid, startTimeMs }` tuple — process ID plus process start time in ms
 * since the epoch — so a probe can distinguish "owner still alive" from
 * "PID was reused after the owner died".
 *
 * Used by:
 *
 * - The per-device sync lock (`.podkit/sync.lock` on mass-storage,
 *   `iPod_Control/.podkit-sync.lock` on iPod).
 * - The transcode-tmp `.owner` marker that lets the debris walker tell a
 *   live transcode session apart from a SIGKILLed prior session's leftovers.
 *
 * **Why a PID-file, not flock(2):** flock semantics on FAT32/exFAT — the
 * iPod filesystem families — are platform-dependent and silently degrade.
 * `open(O_CREAT|O_EXCL)` + `unlink` + `kill(pid, 0)` work uniformly across
 * exFAT, FAT32, HFS+, APFS, ext4, and NTFS. One primitive, predictable
 * behaviour.
 *
 * **Filesystem-agnostic.** No native deps, no advisory locks — only Node
 * stdlib. The kernel-atomic `wx` (`O_CREAT|O_EXCL`) flag is the
 * synchronization primitive.
 *
 * @module
 */

import { exec } from 'node:child_process';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// =============================================================================
// Identity
// =============================================================================

/** PID-file payload — process identity tuple. */
export interface PidFileEntry {
  pid: number;
  /** Wall-clock start time of the process in ms since epoch. */
  startTimeMs: number;
}

/**
 * Return the calling process's identity: `process.pid` and the derived
 * start time `Date.now() - uptime`.
 *
 * Callers that need the identity many times (e.g. one per transcode dir)
 * should cache the result at module load to avoid recomputing.
 */
export function getOwnIdentity(): PidFileEntry {
  return {
    pid: process.pid,
    startTimeMs: Date.now() - Math.floor(process.uptime() * 1000),
  };
}

// =============================================================================
// Read / write
// =============================================================================

/**
 * Atomically write `identity` to `path` (temp + rename).
 *
 * The temp file lives in the same directory as `path` so the rename stays
 * within a single filesystem; a partially-written `.tmp` is never observed
 * at the destination.
 */
export async function writeOwnership(path: string, identity: PidFileEntry): Promise<void> {
  const tmp = `${path}.tmp`;
  const data = JSON.stringify({ pid: identity.pid, startTimeMs: identity.startTimeMs });
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // Best-effort — tmp may not exist if writeFile itself failed.
    }
    throw err;
  }
}

/**
 * Read `path` and parse it as a {@link PidFileEntry}.
 *
 * Returns `null` when the file is missing, unparseable, or the JSON shape
 * is not `{ pid: number, startTimeMs: number }`. Callers treat `null` as
 * "no live owner" and proceed to take over the lock / reap the dir.
 */
export async function readOwnership(path: string): Promise<PidFileEntry | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const pid = obj.pid;
  const startTimeMs = obj.startTimeMs;
  if (typeof pid !== 'number' || typeof startTimeMs !== 'number') return null;
  if (!Number.isFinite(pid) || !Number.isFinite(startTimeMs)) return null;
  if (pid <= 0) return null;
  return { pid, startTimeMs };
}

// =============================================================================
// Liveness probe
// =============================================================================

/**
 * `kill(pid, 0)` + start-time tuple match. Returns `false` on any
 * platform error so callers reliably take over the lock.
 *
 * Compares the recorded `startTimeMs` against the actual process's start
 * time within a ±2s tolerance, defending against PID reuse on long-uptime
 * hosts.
 */
export async function isAlive(entry: PidFileEntry): Promise<boolean> {
  try {
    process.kill(entry.pid, 0);
  } catch {
    // ESRCH (no such process) or EPERM (process exists but we can't signal it).
    // EPERM still implies a live process — but on a host where we can't even
    // signal it, treating it as alive would let a foreign-uid process pin the
    // lock forever. The safer call is to treat both as "not ours; not alive
    // from our point of view" and let the caller take over.
    return false;
  }

  // Process exists. Confirm start-time matches to defend against PID reuse.
  const actualStartMs = await readProcessStartTimeMs(entry.pid);
  if (actualStartMs === null) return false;
  return Math.abs(actualStartMs - entry.startTimeMs) <= 2_000;
}

/**
 * Read the wall-clock start time of `pid` in ms since epoch.
 *
 * Returns `null` on any error — unsupported platform, parse failure, race
 * with process exit. Linux reads `/proc/<pid>/stat` field 22 (`starttime`
 * in clock ticks since boot) and `/proc/stat`'s `btime`. macOS shells out
 * to `ps -o lstart= -p <pid>` once — not in a hot path. Other platforms
 * (Windows) are unsupported today; we return `null` and the caller treats
 * the entry as dead.
 */
async function readProcessStartTimeMs(pid: number): Promise<number | null> {
  if (process.platform === 'linux') {
    return readLinuxStartTime(pid);
  }
  if (process.platform === 'darwin') {
    return readMacosStartTime(pid);
  }
  return null;
}

async function readLinuxStartTime(pid: number): Promise<number | null> {
  let statRaw: string;
  try {
    statRaw = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  // /proc/<pid>/stat format: "<pid> (comm) state ppid ..." where comm can
  // contain spaces. Locate the trailing ')' to anchor field indexing past
  // the comm bracket.
  const lastParen = statRaw.lastIndexOf(')');
  if (lastParen === -1) return null;
  const fieldsAfterComm = statRaw
    .slice(lastParen + 1)
    .trim()
    .split(/\s+/);
  // After comm: field 3 (state) is index 0. starttime is field 22 overall,
  // which means index 22 - 3 = 19 in this trimmed array.
  const startTimeTicksStr = fieldsAfterComm[19];
  if (startTimeTicksStr === undefined) return null;
  const startTimeTicks = Number.parseInt(startTimeTicksStr, 10);
  if (!Number.isFinite(startTimeTicks)) return null;

  let procStatRaw: string;
  try {
    procStatRaw = await readFile('/proc/stat', 'utf8');
  } catch {
    return null;
  }
  const btimeMatch = procStatRaw.match(/^btime\s+(\d+)/m);
  if (!btimeMatch) return null;
  const btimeSeconds = Number.parseInt(btimeMatch[1]!, 10);
  if (!Number.isFinite(btimeSeconds)) return null;

  // sysconf(_SC_CLK_TCK) is conventionally 100 on Linux; node doesn't expose
  // sysconf directly. 100Hz has been the kernel default for decades and is
  // the value libgpod / pidfd consumers also assume.
  //
  // If the kernel runs HZ≠100, the computed start time can be off by a
  // multiplicative factor, potentially exceeding the ±2s tolerance. Effect:
  // a live process's lock is treated as stale and reclaimed — never the
  // reverse — so the failure mode is contention, not corruption.
  const clkTck = 100;
  return (btimeSeconds + startTimeTicks / clkTck) * 1_000;
}

async function readMacosStartTime(pid: number): Promise<number | null> {
  // Use `etime` (elapsed time since process start) rather than `lstart`
  // (absolute timestamp) — etime is timezone-independent, so a test
  // runner with a non-system TZ (e.g. bun's UTC test environment) can't
  // mis-parse the result. Format: `[[dd-]hh:]mm:ss`.
  let stdout: string;
  try {
    const result = await execAsync(`ps -o etime= -p ${pid}`);
    stdout = result.stdout;
  } catch {
    return null;
  }
  const line = stdout.trim();
  if (line === '') return null;
  const elapsedMs = parseEtime(line);
  if (elapsedMs === null) return null;
  return Date.now() - elapsedMs;
}

/**
 * Parse the BSD `ps -o etime=` format: `[[dd-]hh:]mm:ss`. Returns the
 * elapsed time in milliseconds or `null` on malformed input.
 *
 * Examples:
 *   `01:23`            → 1 minute 23 seconds
 *   `12:34:56`         → 12 hours 34 minutes 56 seconds
 *   `7-12:34:56`       → 7 days 12 hours 34 minutes 56 seconds
 */
function parseEtime(input: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(input);
  if (!match) return null;
  const days = match[1] ? Number.parseInt(match[1], 10) : 0;
  const hours = match[2] ? Number.parseInt(match[2], 10) : 0;
  const minutes = Number.parseInt(match[3]!, 10);
  const seconds = Number.parseInt(match[4]!, 10);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1_000;
}

// =============================================================================
// Lock acquire / release
// =============================================================================

/**
 * Raised by {@link acquireLock} when the lock is held by a live process.
 *
 * Carries the holding PID + start time + the path it was holding, so the
 * caller can surface a clear "pid N is syncing" message without re-reading
 * the file.
 */
export class LockHeldError extends Error {
  readonly pid: number;
  readonly startTimeMs: number;
  readonly lockPath: string;

  constructor(lockPath: string, holder: PidFileEntry) {
    super(`lock held by pid ${holder.pid} at ${lockPath}`);
    this.name = 'LockHeldError';
    this.pid = holder.pid;
    this.startTimeMs = holder.startTimeMs;
    this.lockPath = lockPath;
  }
}

/**
 * Raised by {@link acquireLock} when the lock file exists but its contents
 * could not be read after multiple retries (e.g. a concurrent writer between
 * `open(wx)` and `writeFile`, or an ENOSPC-orphaned empty file that another
 * process is simultaneously retrying).
 *
 * The caller should treat this identically to {@link LockHeldError} — log and
 * skip / surface a CLI error — rather than retrying immediately, which would
 * risk a tight spin in the unlikely case the writer is perpetually stalled.
 */
export class LockContestedError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string) {
    super(
      `Lock file at ${lockPath} exists but its contents could not be read after multiple retries. ` +
        'Another podkit process may be writing it concurrently, or the file is stale. ' +
        'Try again in a moment.'
    );
    this.name = 'LockContestedError';
    this.lockPath = lockPath;
  }
}

/**
 * Raised by {@link acquireLock} when the lock file cannot be created because
 * the containing filesystem refuses the write outright — EACCES (permissions),
 * EROFS (read-only filesystem), or EPERM (operation not permitted, e.g. an
 * ext4 immutable bit on the parent dir).
 *
 * Distinct from {@link LockHeldError} (no live owner exists; the lock file
 * was never even created) and from {@link LockContestedError} (the file does
 * exist but its contents are unreadable). The caller should surface a typed
 * CLI error with a message describing the unwritable path — sync cannot
 * proceed and there is no contention to wait on.
 *
 * Carries the originating errno so callers can disambiguate "fix the
 * permissions" (EACCES/EPERM) from "remount writable" (EROFS) if needed.
 */
export class LockUnavailableError extends Error {
  readonly lockPath: string;
  readonly code: 'EACCES' | 'EROFS' | 'EPERM';

  constructor(lockPath: string, code: 'EACCES' | 'EROFS' | 'EPERM', cause?: unknown) {
    super(
      `Lock file at ${lockPath} could not be created (${code}). ` +
        'The containing directory is not writable by this process. ' +
        'Check the directory permissions and that the device is mounted read-write.'
    );
    this.name = 'LockUnavailableError';
    this.lockPath = lockPath;
    this.code = code;
    if (cause !== undefined) {
      // Preserve the underlying ErrnoException for diagnostics.
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Handle returned by {@link acquireLock}. Hold for the duration of the
 * critical section and call {@link release} in a `finally`.
 *
 * `release` is idempotent — multiple calls are no-ops — so the caller can
 * unconditionally release without tracking whether they already did.
 */
export class LockHandle {
  private released = false;
  private readonly identity: PidFileEntry;

  constructor(
    readonly path: string,
    identity: PidFileEntry
  ) {
    this.identity = identity;
  }

  /**
   * Unlink the lock file, but ONLY if it still belongs to us.
   *
   * Reads the current file contents and compares `pid` + `startTimeMs`
   * against the identity this handle was constructed with. If another
   * process has taken over the lock (e.g. it judged our entry stale and
   * reclaimed it), we skip the unlink silently — unlinking a foreign lock
   * would corrupt that process's critical section.
   *
   * Idempotent — multiple `release()` calls are no-ops after the first.
   * Tolerant of ENOENT and read errors: if the file is already gone, the
   * lock is no longer ours to worry about.
   */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    // Verify ownership before unlinking to defend against the race where:
    // (A) we hold lock, (B) B judges A stale and takes over, (A) late
    // finally calls release() — without this check, A would unlink B's lock.
    let current: PidFileEntry | null;
    try {
      current = await readOwnership(this.path);
    } catch {
      // Can't read → assume it's gone or not ours.
      return;
    }
    if (current === null) return; // Already gone.
    if (current.pid !== this.identity.pid || current.startTimeMs !== this.identity.startTimeMs) {
      // Lock was taken over by another process. Do not unlink.
      return;
    }
    try {
      await unlink(this.path);
    } catch {
      // File may have been removed by an external process, or the FS may
      // be gone (device unplugged). Either way the lock is no longer ours
      // to worry about.
    }
  }
}

/**
 * Test seam: do not use in production code.
 *
 * Optional injection points for `acquireLock`. When omitted, the default
 * disk-based implementations are used, preserving identical behaviour to
 * calling `acquireLock(path)` with no second argument.
 */
export interface LockHooks {
  /** Override the ownership reader. Default reads from disk. */
  readOwnership?: (path: string) => Promise<PidFileEntry | null>;
  /**
   * Override the atomic lock-file creation attempt. Must return `'acquired'`
   * if the caller now owns the file, or `'eexist'` if the file already
   * exists (equivalent to `open(wx)` returning EEXIST). Any other error
   * should be thrown. Default uses `open(path, 'wx')`.
   */
  tryOpen?: (path: string) => Promise<'acquired' | 'eexist'>;
}

/**
 * Acquire an exclusive lock at `path`.
 *
 * Algorithm:
 *
 *   1. `open(path, 'wx')` — kernel-atomic `O_CREAT|O_EXCL`.
 *   2. On success: write `{pid, startTimeMs}`, `fsync`, close, return handle.
 *   3. On `EEXIST`: read the existing file, probe liveness.
 *      - Alive → throw {@link LockHeldError}.
 *      - Dead → `unlink` the stale file, retry step 1 once.
 *   4. On retry `EEXIST`: another process won the takeover race. Probe
 *      once more — alive → throw, dead → throw (don't loop forever).
 *
 * The single retry caps the worst-case at two probes; we never spin.
 */
export async function acquireLock(path: string, hooks?: LockHooks): Promise<LockHandle> {
  const identity = getOwnIdentity();
  const readOwnershipFn = hooks?.readOwnership ?? readOwnership;
  const tryOpenFn = hooks?.tryOpen;
  // First attempt.
  const firstAttempt = await tryCreateAndWrite(path, identity, tryOpenFn);
  if (firstAttempt === 'acquired') return new LockHandle(path, identity);

  // EEXIST: probe the existing holder. The file may be momentarily empty
  // (a sibling between `open(wx)` and `writeFile`); re-read with a short
  // bounded backoff before declaring it malformed. This also makes the
  // path robust against tooling that writes the file via temp+rename.
  //
  // Readers retry up to 3× with 5ms backoff before declaring the file
  // stale, to handle the brief window between another process's `open(wx)`
  // and its content `writeFile`.
  const existing = await waitForOwnership(path, 3, readOwnershipFn);
  if (existing && (await isAlive(existing))) {
    throw new LockHeldError(path, existing);
  }

  // Stale lock OR malformed-after-backoff. Unlink and retry once.
  try {
    await unlink(path);
  } catch {
    // Another process may have just unlinked it. Either way, retry.
  }

  const secondAttempt = await tryCreateAndWrite(path, identity, tryOpenFn);
  if (secondAttempt === 'acquired') return new LockHandle(path, identity);

  // Lost the takeover race to a sibling. Probe one final time (again
  // with backoff so an in-flight write doesn't masquerade as malformed).
  const newHolder = await waitForOwnership(path, 3, readOwnershipFn);
  if (newHolder && (await isAlive(newHolder))) {
    throw new LockHeldError(path, newHolder);
  }
  // The slot is dead-but-occupied and we already retried — give up rather
  // than spin. The next sync will reclaim cleanly.
  //
  // If newHolder is null after all retries (contents persistently
  // unreadable), throw LockContestedError rather than misattributing the
  // lock to our own PID — that would give the caller a misleading "pid N
  // is syncing" where N is ourselves.
  if (newHolder === null) {
    throw new LockContestedError(path);
  }
  throw new LockHeldError(path, newHolder);
}

/**
 * Read the lock file's ownership, retrying briefly if the file is empty
 * or malformed. Handles the race between `open(wx)` and `writeFile`
 * inside another process.
 */
async function waitForOwnership(
  path: string,
  attempts: number,
  readOwnershipFn: (path: string) => Promise<PidFileEntry | null> = readOwnership
): Promise<PidFileEntry | null> {
  for (let i = 0; i < attempts; i++) {
    const owner = await readOwnershipFn(path);
    if (owner !== null) return owner;
    // 5ms backoff — long enough for any reasonable filesystem to flush
    // a 50-byte writeFile, short enough to keep the lock-acquire path
    // responsive.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return null;
}

/**
 * Internal: try to `open(wx)` + write + fsync + close. Returns `'acquired'`
 * on success, `'eexist'` if the file already exists. Any other error is
 * thrown.
 */
async function tryCreateAndWrite(
  path: string,
  identity: PidFileEntry,
  tryOpenFn?: (path: string) => Promise<'acquired' | 'eexist'>
): Promise<'acquired' | 'eexist'> {
  // When a tryOpen hook is provided (test seam), delegate entirely to it and
  // skip the real open + write + sync cycle — the hook signals whether the
  // "file" was created or already existed.
  if (tryOpenFn !== undefined) {
    return tryOpenFn(path);
  }
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return 'eexist';
    // Filesystem refuses the write outright (read-only mount, parent dir
    // chmod 0555, ext4 +i on the parent). There is no contention to wait
    // on and no holder to report — wrap as LockUnavailableError so the
    // CLI can surface a typed error with a clear "directory not writable"
    // message instead of an uncaught JS stack trace propagating out of
    // the sync orchestrator.
    if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') {
      throw new LockUnavailableError(path, code, err);
    }
    throw err;
  }
  // `open(wx)` succeeded — we own the file. If writeFile/sync fails (e.g.
  // ENOSPC), clean up the orphaned empty file before re-throwing so the
  // next acquireLock sees a clean state rather than a persistently-empty
  // lock file that triggers waitForOwnership retries on every call.
  let writeError: unknown = null;
  try {
    await handle.writeFile(
      JSON.stringify({ pid: identity.pid, startTimeMs: identity.startTimeMs }),
      'utf8'
    );
    await handle.sync();
  } catch (err) {
    writeError = err;
  } finally {
    await handle.close();
  }
  if (writeError !== null) {
    try {
      await unlink(path);
    } catch {
      // Best-effort: if the unlink also fails, the next acquireLock's
      // waitForOwnership retries will eventually treat the empty file as
      // stale and unlink it. Not ideal but safe.
    }
    throw writeError;
  }
  return 'acquired';
}
