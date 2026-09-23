/**
 * Holding a substrate for the duration of a run.
 *
 * A Lima substrate is local and the host advisory lock already covers it. An
 * `ssh` substrate may be shared with another machine, so it gets the in-guest
 * lock — and an unreachable one is refused rather than run unlocked, because an
 * unlocked run looks exactly like a locked one until two of them interleave.
 *
 * @module
 */

import { createSshLink } from './link-ssh.js';
import { isSshVm, type VmDefinition } from './registry.js';
import {
  acquireRemoteLock,
  RemoteLockBusyError,
  type AcquireRemoteLockOpts,
  type RemoteLockRelease,
} from './remote-lock.js';
import type { SubstrateLink } from './link.js';

/** Whether the run may proceed, and what to release when it ends. */
export type RunLockOutcome =
  /** No lock is needed; nothing to release. */
  | { readonly kind: 'not-required' }
  /** Held. Call {@link RunLockOutcome.release} when the run ends. */
  | { readonly kind: 'held'; readonly release: RemoteLockRelease }
  /** The run must not start. {@link RunLockOutcome.reason} says why. */
  | { readonly kind: 'refused'; readonly reason: string };

/** Options for {@link acquireRunLock}. */
export interface AcquireRunLockOpts extends AcquireRemoteLockOpts {
  /** Build the link. Production callers leave unset. */
  readonly linkFor?: (substrate: VmDefinition) => SubstrateLink;
}

/** Take the run lock for a substrate, if it needs one. Never throws. */
export async function acquireRunLock(
  substrate: VmDefinition | null,
  opts: AcquireRunLockOpts = {}
): Promise<RunLockOutcome> {
  if (!substrate || !isSshVm(substrate)) return { kind: 'not-required' };

  const { linkFor, ...lockOpts } = opts;
  const link = (linkFor ?? ((s: VmDefinition) => createSshLink(s as never)))(substrate);
  try {
    return { kind: 'held', release: await acquireRemoteLock(link, lockOpts) };
  } catch (err) {
    if (err instanceof RemoteLockBusyError) return { kind: 'refused', reason: err.message };
    return {
      kind: 'refused',
      reason:
        `cannot take the run lock on ${link.description}: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        `Start it first with \`bun run vm:up ${substrate.id}\`. The run is refused rather ` +
        `than run unlocked, because an unlocked run is indistinguishable from a locked one ` +
        `until two of them interleave.`,
    };
  }
}
