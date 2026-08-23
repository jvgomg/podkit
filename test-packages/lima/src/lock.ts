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
 * Default retry count for a contended acquire. Paired with the backoff in
 * {@link lockfileOptions} (200ms doubling to a 2s ceiling) this waits roughly
 * half an hour before giving up.
 *
 * That budget has to clear the SLOWEST legitimate hold, not the typical one: a
 * cold `limactl start` that downloads an image and runs cloud-init takes five
 * to ten minutes, and the contender is usually a sibling turbo task that must
 * simply wait for it. Giving up early turns "someone else is creating the VM"
 * into a build failure — which is the exact race the lock exists to prevent.
 *
 * Waiting this long is safe because it is bounded by liveness, not just by the
 * clock: a holder refreshes the lockfile mtime every {@link DEFAULT_UPDATE_MS},
 * so if it dies the lock goes stale within {@link DEFAULT_STALE_MS} and the
 * next contender reclaims it rather than waiting out the full budget.
 */
export const DEFAULT_RETRIES = 900;

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

/** Backoff shape for a contended acquire. See {@link DEFAULT_RETRIES}. */
const RETRY_BACKOFF = { factor: 2, minTimeout: 200, maxTimeout: 2_000 } as const;

/**
 * Total time a contender will wait before giving up, for a given retry count.
 *
 * Derived from {@link RETRY_BACKOFF} rather than assumed, so the wait budget is
 * an assertable number instead of a claim in a comment. A `factor` of 1 would
 * silently pin every delay at `minTimeout` and collapse this to a fraction of
 * its intended value, which is why the budget is pinned by a test.
 */
export function lockRetryBudgetMs(retries: number = DEFAULT_RETRIES): number {
  let total = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    total += Math.min(
      RETRY_BACKOFF.minTimeout * RETRY_BACKOFF.factor ** attempt,
      RETRY_BACKOFF.maxTimeout
    );
  }
  return total;
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
    retries: { retries: opts.retries ?? DEFAULT_RETRIES, ...RETRY_BACKOFF },
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
