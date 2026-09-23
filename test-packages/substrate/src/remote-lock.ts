/**
 * A cross-machine advisory lock, held inside the substrate.
 *
 * The host-local lock in `@podkit/lima` keeps two processes on one machine from
 * racing a Lima instance. It structurally cannot see a second machine, and a
 * shared substrate is exactly where the second machine turns up: two runs
 * interleaving personas and gadget state corrupt each other. So the lock lives
 * where the contention is.
 *
 * Three properties, all from doc-060:
 *
 * - **Atomic.** `mkdir` is the primitive: it succeeds for exactly one caller.
 * - **Bounded wait.** Contention retries for a short window and then fails,
 *   naming the holder's host, user, pid and start time. Blocking indefinitely
 *   on a peer who may legitimately hold for a whole run is indistinguishable
 *   from a hang.
 * - **Breakable.** A crashed run leaves the lock behind; {@link forceReleaseRemoteLock}
 *   is the documented way out. There is no mtime-based auto-reclaim, because a
 *   lock held over ssh has no refresher to go quiet.
 *
 * `/run/lock` is a tmpfs, so a reboot releases the lock — which is the right
 * answer for a holder that no longer exists.
 *
 * @module
 */

import * as os from 'node:os';

import { shellQuote, type SubstrateLink } from './link.js';

/** Lock directory inside the substrate. */
export const REMOTE_LOCK_PATH = '/run/lock/podkit-substrate.lock';

/** Default wait before reporting contention. */
export const DEFAULT_REMOTE_LOCK_TIMEOUT_MS = 60_000;
/** Poll interval while waiting. */
export const DEFAULT_REMOTE_LOCK_POLL_MS = 2_000;

/** Who holds the lock. */
export interface RemoteLockHolder {
  readonly host: string;
  readonly user: string;
  readonly pid: number;
  /** ISO-8601 acquisition time, as recorded by the acquiring host. */
  readonly startedAt: string;
  /** Opaque value proving a release belongs to the hold that took it. */
  readonly token: string;
}

/** Contention that outlasted the wait. */
export class RemoteLockBusyError extends Error {
  readonly holder: RemoteLockHolder | null;
  constructor(message: string, holder: RemoteLockHolder | null) {
    super(message);
    this.name = 'RemoteLockBusyError';
    this.holder = holder;
  }
}

/** Options for {@link acquireRemoteLock}. */
export interface AcquireRemoteLockOpts {
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  /** Identity to record. Defaults to this process. */
  readonly holder?: Partial<Omit<RemoteLockHolder, 'token'>>;
  /** DI seam for the poll delay. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** DI seam for the clock. */
  readonly now?: () => number;
  /** DI seam for the hold token. */
  readonly makeToken?: () => string;
}

/** Releases a held lock. */
export type RemoteLockRelease = () => Promise<void>;

function serialize(holder: RemoteLockHolder): string {
  return [
    `host=${holder.host}`,
    `user=${holder.user}`,
    `pid=${holder.pid}`,
    `startedAt=${holder.startedAt}`,
    `token=${holder.token}`,
  ].join('\n');
}

/** Parse a holder record, tolerating a truncated one from a crashed write. */
export function parseRemoteLockHolder(text: string): RemoteLockHolder | null {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const host = fields.get('host');
  if (!host) return null;
  return {
    host,
    user: fields.get('user') ?? 'unknown',
    pid: Number(fields.get('pid') ?? 0),
    startedAt: fields.get('startedAt') ?? 'unknown',
    token: fields.get('token') ?? '',
  };
}

/** Render a holder for a terminal. */
export function describeRemoteLockHolder(holder: RemoteLockHolder | null): string {
  if (!holder) return 'an unidentified holder (the lock record is missing or truncated)';
  return `${holder.user}@${holder.host} (pid ${holder.pid}) since ${holder.startedAt}`;
}

/**
 * Try once to take the lock.
 *
 * `mkdir` without `-p` is the atomic step; the holder record is written after
 * and is therefore advisory detail rather than part of the claim.
 */
async function tryAcquire(
  link: SubstrateLink,
  holder: RemoteLockHolder
): Promise<RemoteLockHolder | null> {
  const script =
    `if mkdir ${shellQuote(REMOTE_LOCK_PATH)} 2>/dev/null; then ` +
    `printf '%s\\n' ${shellQuote(serialize(holder))} > ${shellQuote(`${REMOTE_LOCK_PATH}/holder`)}; ` +
    `echo ACQUIRED; ` +
    `else echo HELD; cat ${shellQuote(`${REMOTE_LOCK_PATH}/holder`)} 2>/dev/null || true; fi`;

  const result = await link.exec(['sh', '-c', script]);
  if (result.exitCode !== 0) {
    throw new Error(
      `cannot take the substrate lock on ${link.description}: ` +
        `${result.stderr.trim() || `exit ${result.exitCode}`}`
    );
  }
  const [verdict, ...rest] = result.stdout.split('\n');
  if (verdict?.trim() === 'ACQUIRED') return null;
  return parseRemoteLockHolder(rest.join('\n'));
}

/**
 * Hold the substrate for the duration of a run.
 *
 * @throws {RemoteLockBusyError} when the wait expires, naming the holder.
 */
export async function acquireRemoteLock(
  link: SubstrateLink,
  opts: AcquireRemoteLockOpts = {}
): Promise<RemoteLockRelease> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REMOTE_LOCK_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_REMOTE_LOCK_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const holder: RemoteLockHolder = {
    host: opts.holder?.host ?? os.hostname(),
    user: opts.holder?.user ?? os.userInfo().username,
    pid: opts.holder?.pid ?? process.pid,
    startedAt: opts.holder?.startedAt ?? new Date(now()).toISOString(),
    token: opts.makeToken?.() ?? crypto.randomUUID(),
  };

  const deadline = now() + timeoutMs;
  let blocker: RemoteLockHolder | null = null;
  for (;;) {
    blocker = await tryAcquire(link, holder);
    if (blocker === null) {
      return () => releaseRemoteLock(link, holder.token);
    }
    if (now() >= deadline) break;
    await sleep(pollMs);
  }

  throw new RemoteLockBusyError(
    `${link.description} is locked by ${describeRemoteLockHolder(blocker)}.\n` +
      `Waited ${Math.round(timeoutMs / 1000)}s. Another run holds the substrate; ` +
      `two at once would interleave persona and gadget state.\n` +
      `If that run is gone, break the lock with: podkit-vm unlock <instance> --force`,
    blocker
  );
}

/** Release a hold. A lock someone else now owns is left alone. */
export async function releaseRemoteLock(link: SubstrateLink, token: string): Promise<void> {
  const holderFile = `${REMOTE_LOCK_PATH}/holder`;
  const script =
    `if grep -qxF ${shellQuote(`token=${token}`)} ${shellQuote(holderFile)} 2>/dev/null; then ` +
    `rm -rf ${shellQuote(REMOTE_LOCK_PATH)}; echo RELEASED; ` +
    `else echo NOTOURS; fi`;
  await link.exec(['sh', '-c', script]).catch(() => undefined);
}

/** Break the lock whoever holds it. Returns the holder that was displaced. */
export async function forceReleaseRemoteLock(
  link: SubstrateLink
): Promise<RemoteLockHolder | null> {
  const holder = await readRemoteLockHolder(link);
  await link.exec(['sh', '-c', `rm -rf ${shellQuote(REMOTE_LOCK_PATH)}`]);
  return holder;
}

/** Who holds the lock right now, or `null` when it is free. */
export async function readRemoteLockHolder(link: SubstrateLink): Promise<RemoteLockHolder | null> {
  const result = await link.exec([
    'sh',
    '-c',
    `cat ${shellQuote(`${REMOTE_LOCK_PATH}/holder`)} 2>/dev/null || true`,
  ]);
  return parseRemoteLockHolder(result.stdout);
}

/** Run `fn` holding the substrate lock, releasing it however `fn` ends. */
export async function withRemoteLock<T>(
  link: SubstrateLink,
  fn: () => Promise<T>,
  opts: AcquireRemoteLockOpts = {}
): Promise<T> {
  const release = await acquireRemoteLock(link, opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}
