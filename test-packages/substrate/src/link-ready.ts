/**
 * Waiting for a substrate to answer over its link.
 *
 * A hypervisor can tell you a guest is `running`; it cannot tell you anything
 * will answer on port 22. Those are different facts minutes apart on a freshly
 * created guest, and every caller that starts a box and then drives it over
 * ssh needs the second one. This module is that wait, and it lives beside the
 * link rather than beside any provisioner because it is a probe on the link:
 * `@podkit/substrate`'s PVE lifecycle deliberately holds no `SubstrateLink`
 * (ADR-029 §2), so it takes this as an injected hook instead.
 *
 * Nothing here prints — callers own the terminal, and pass `report` if they
 * want the wait narrated.
 *
 * @module
 */

import { isSubstrateLinkError, looksLikeTerminalSshFailure, type SubstrateLink } from './link.js';

/**
 * Bound on the wait for a substrate to answer.
 *
 * Sized for the slowest case a caller can land in: a guest created seconds
 * ago, booting a cloud image and running cloud-init, on a hypervisor that is
 * also running everything else the operator owns. A rollback answers in
 * seconds and a warm box on the first probe, so the bound is only ever paid by
 * something genuinely wrong.
 */
export const SUBSTRATE_READY_TIMEOUT_MS = 300_000;

/** Gap between probes. Long enough not to hammer a booting sshd. */
const READY_POLL_MS = 5_000;

/**
 * Bound on one probe.
 *
 * Without it a probe against a host that accepts the TCP connection and then
 * never completes the handshake — a guest mid-boot with a half-started sshd —
 * blocks with no upper limit, and the outer bound never gets to fire. It is
 * clamped to whatever is left of the outer budget, so the bound the caller was
 * told about is the one it actually gets rather than that plus one probe.
 */
const READY_PROBE_TIMEOUT_MS = 15_000;

/** Why the wait ended without the substrate answering. */
export type SubstrateNotReadyReason =
  /** The bound fired. */
  | 'timeout'
  /** The substrate refused in a way waiting will not fix. */
  | 'refused';

/** A substrate that was waited on and never answered. */
export class SubstrateNotReadyError extends Error {
  readonly substrateId: string;
  readonly reason: SubstrateNotReadyReason;
  /** How long the wait actually ran. */
  readonly waitedMs: number;
  /** The last diagnostic the link produced. */
  readonly detail: string;

  constructor(opts: {
    link: SubstrateLink;
    reason: SubstrateNotReadyReason;
    waitedMs: number;
    timeoutMs: number;
    detail: string;
  }) {
    const detail = opts.detail || '(no diagnostic)';
    super(
      opts.reason === 'refused'
        ? `${opts.link.description} refused the connection after ${opts.waitedMs}ms in a way ` +
            `waiting will not fix, so the wait stopped rather than running to its ` +
            `${opts.timeoutMs}ms bound: ${detail}`
        : `Waited ${opts.waitedMs}ms for ${opts.link.description} to answer over ssh and it ` +
            `never did (bound: ${opts.timeoutMs}ms). Last probe said: ${detail}`
    );
    this.name = 'SubstrateNotReadyError';
    this.substrateId = opts.link.substrateId;
    this.reason = opts.reason;
    this.waitedMs = opts.waitedMs;
    this.detail = detail;
  }
}

/** Whether `err` is a failed readiness wait. Narrows, so callers do not match. */
export function isSubstrateNotReadyError(err: unknown): err is SubstrateNotReadyError {
  return err instanceof SubstrateNotReadyError;
}

/** Seams for the wait. Production callers leave the clock ones unset. */
export interface WaitForSubstrateReadyOpts {
  /** Progress reporting seam — callers own the terminal. */
  readonly report?: (message: string) => void;
  /** Bound on the wait. Defaults to {@link SUBSTRATE_READY_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Gap between probes. Defaults to five seconds. */
  readonly pollMs?: number;
  /** Clock, injected so the timeout branch is reachable without waiting. */
  readonly now?: () => number;
  /** Sleep, injected for the same reason. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What one probe learned. */
interface ProbeOutcome {
  readonly ready: boolean;
  /** Whether waiting longer could plausibly change the answer. */
  readonly terminal: boolean;
  readonly detail: string;
}

/**
 * Ask the substrate to run the cheapest command there is.
 *
 * A zero exit is the only evidence that counts: it means a session opened, a
 * shell ran and the guest answered. A non-zero exit is not readiness either —
 * `true` cannot fail, so a failure is a userland that has not finished coming
 * up — but it is worth waiting through rather than reporting.
 */
async function probeOnce(link: SubstrateLink, budgetMs: number): Promise<ProbeOutcome> {
  try {
    const result = await link.exec(['true'], {
      timeoutMs: Math.max(1, Math.min(READY_PROBE_TIMEOUT_MS, budgetMs)),
    });
    if (result.exitCode === 0) return { ready: true, terminal: false, detail: '' };
    return {
      ready: false,
      terminal: false,
      detail: result.stderr.trim() || `the readiness probe exited ${result.exitCode}`,
    };
  } catch (err) {
    const detail = isSubstrateLinkError(err)
      ? err.detail
      : err instanceof Error
        ? err.message
        : String(err);
    return { ready: false, terminal: looksLikeTerminalSshFailure(detail), detail };
  }
}

/**
 * Poll until the substrate answers over its link.
 *
 * @throws {SubstrateNotReadyError} when the bound fires, or when the substrate
 * refuses in a way waiting will not fix. Either way the failure names the
 * link, the bound and the link's own last diagnostic — which is the point of
 * doing the wait here rather than letting the first real command fail with an
 * ssh error from inside whatever it was trying to do.
 */
export async function waitForSubstrateReady(
  link: SubstrateLink,
  opts: WaitForSubstrateReadyOpts = {}
): Promise<void> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const report = opts.report;
  const timeoutMs = opts.timeoutMs ?? SUBSTRATE_READY_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? READY_POLL_MS;
  const started = now();
  const deadline = started + timeoutMs;

  let announced = false;
  let detail = '';

  for (;;) {
    const probe = await probeOnce(link, deadline - now());
    if (probe.ready) return;
    detail = probe.detail;
    if (probe.terminal) {
      throw new SubstrateNotReadyError({
        link,
        reason: 'refused',
        waitedMs: now() - started,
        timeoutMs,
        detail,
      });
    }
    if (now() >= deadline) {
      throw new SubstrateNotReadyError({
        link,
        reason: 'timeout',
        waitedMs: now() - started,
        timeoutMs,
        detail,
      });
    }
    if (!announced) {
      announced = true;
      report?.(
        `waiting up to ${timeoutMs}ms for ${link.description} to answer over ssh (${detail})`
      );
    }
    await sleep(pollMs);
  }
}
