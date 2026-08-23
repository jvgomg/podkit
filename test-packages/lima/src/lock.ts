/**
 * The single cross-process advisory lock for VM lifecycle operations.
 *
 * Every start path (the CLI, TS callers, and — in a later phase — the build
 * wrappers) funnels through ONE lock code path so two independent processes can
 * never create/start the same shared Lima instance at once and crash its
 * hostagent. The lock is:
 *
 *   - **Liveness-aware + stale-reclaiming.** Backed by `proper-lockfile`, whose
 *     holder refreshes the lockfile mtime on an interval. A live holder keeps
 *     the lock fresh no matter how long its critical section runs (so a
 *     10-minute cold `limactl create` is never aborted); a holder that dies
 *     stops refreshing, and after {@link DEFAULT_STALE_MS} the lock goes stale
 *     and the next contender reclaims it.
 *   - **Never a VM-stopper.** Holding or releasing the lock never stops a VM.
 *     There is no reference-counting — only explicit ops stop VMs.
 *   - **Wait, don't fail-fast.** A contender retries for a generous window
 *     rather than erroring immediately, so a legitimately slow holder is waited
 *     out instead of aborting the operation.
 *
 * The lock is keyed per instance name, so different VMs never contend.
 *
 * @module
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as properLockfile from 'proper-lockfile';

/**
 * Default staleness window. A live holder refreshes the lockfile mtime every
 * {@link DEFAULT_UPDATE_MS}; only if refreshes stop for this long is the lock
 * considered abandoned and reclaimable. proper-lockfile enforces a 5000ms
 * minimum.
 */
export const DEFAULT_STALE_MS = 30_000;
/** Default mtime-refresh interval for a held lock (well under the stale window). */
export const DEFAULT_UPDATE_MS = 5_000;
/**
 * Default per-attempt retry ceiling. With `maxTimeout` at ~2s this waits out a
 * multi-minute cold VM create before giving up.
 */
export const DEFAULT_RETRIES = 600;

/** Options for the lock helpers. */
export interface VmLockOptions {
  /** Directory the lock file lives in. Defaults to the OS temp dir. */
  lockDir?: string;
  /** Staleness window in ms (proper-lockfile min 5000). */
  staleMs?: number;
  /** mtime-refresh interval in ms. */
  updateMs?: number;
  /**
   * Retry attempts on contention. `0` fails fast with an `ELOCKED` error if the
   * lock is already held (useful for a non-blocking "is it busy?" probe).
   */
  retries?: number;
}

/** A function that releases a previously-acquired lock. */
export type ReleaseFn = () => Promise<void>;

/**
 * Absolute path of the lock file for a given instance. The file itself need not
 * exist — proper-lockfile creates a sibling `<path>.lock` directory atomically.
 */
export function lockPathFor(instanceName: string, lockDir: string = os.tmpdir()): string {
  return path.join(lockDir, `podkit-vmlock-${instanceName}`);
}

function lockfileOptions(opts: VmLockOptions): properLockfile.LockOptions {
  const lockDir = opts.lockDir ?? os.tmpdir();
  // Ensure the lock directory exists so the `<path>.lock` mkdir can succeed.
  fs.mkdirSync(lockDir, { recursive: true });
  return {
    stale: opts.staleMs ?? DEFAULT_STALE_MS,
    update: opts.updateMs ?? DEFAULT_UPDATE_MS,
    // The lock target is a synthetic path that need not exist — do not resolve
    // symlinks or require the file to be present.
    realpath: false,
    retries: {
      retries: opts.retries ?? DEFAULT_RETRIES,
      factor: 1,
      minTimeout: 200,
      maxTimeout: 2_000,
    },
  };
}

/**
 * Acquire the advisory lock for `instanceName`. Resolves to a release function;
 * the caller MUST call it (a `finally` block) to release. Prefer
 * {@link withVmLock} which does that automatically.
 */
export async function acquireVmLock(
  instanceName: string,
  opts: VmLockOptions = {}
): Promise<ReleaseFn> {
  const lockPath = lockPathFor(instanceName, opts.lockDir);
  const release = await properLockfile.lock(lockPath, lockfileOptions(opts));
  return async () => {
    await release();
  };
}

/**
 * Report whether `instanceName` is currently locked by a live holder. A stale
 * lock (holder died) reads as unlocked, matching the reclaim semantics.
 */
export async function isVmLocked(instanceName: string, opts: VmLockOptions = {}): Promise<boolean> {
  const lockPath = lockPathFor(instanceName, opts.lockDir);
  return properLockfile.check(lockPath, {
    stale: opts.staleMs ?? DEFAULT_STALE_MS,
    realpath: false,
  });
}

/**
 * Run `fn` while holding the advisory lock for `instanceName`, releasing it
 * afterward even if `fn` throws. This is the single chokepoint every VM start
 * path should route through.
 */
export async function withVmLock<T>(
  instanceName: string,
  fn: () => Promise<T>,
  opts: VmLockOptions = {}
): Promise<T> {
  const release = await acquireVmLock(instanceName, opts);
  try {
    return await fn();
  } finally {
    await release().catch(() => {
      // Best-effort: a failed release is logged nowhere in library code; the
      // stale window guarantees the lock is eventually reclaimable regardless.
    });
  }
}
