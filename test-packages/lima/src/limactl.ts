/**
 * Shared `limactl` invocation helpers used across the Lima substrate — the
 * lifecycle primitives, the transport helpers, and the docker-image runner.
 *
 * Extracted to one place so a Lima-version-specific change (argument order,
 * error-message wording, missing-instance heuristics) only needs to be made
 * once. Every call is routed through an injected `SubprocessRunner` so the
 * substrate is unit-testable with scripted outputs.
 *
 * @module
 */

import type { SubprocessRunner } from '@podkit/device-types';
import { guestCommandError, isTimeoutRejection, shellQuote } from '@podkit/substrate';

// POSIX shell quoting is not a Lima concern — it belongs to the substrate link
// layer, which is where it now lives. Re-exported here so the many callers that
// reach for it alongside `runLimactl` keep one import.
export { shellQuote };

/** Captured outcome of one `limactl` invocation. */
export interface LimactlResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Options for {@link runLimactl}. */
export interface RunLimactlOpts {
  /**
   * Hard wall-clock bound for the invocation, in milliseconds. Omitted means
   * "wait forever", which is only appropriate for genuinely open-ended work
   * (image builds, rsync staging).
   *
   * Anything on a per-test hot path SHOULD pass a bound: `limactl shell` opens
   * an SSH session, and an SSH session that never completes its handshake
   * leaves the caller blocked with no upper limit. Callers that poll in a loop
   * must bound the individual probe too — a deadline check between iterations
   * is never reached if one iteration never returns.
   */
  timeoutMs?: number;
}

/**
 * Run `limactl <args>` via the supplied subprocess runner. Returns the
 * `{stdout, stderr, exitCode}` triple. Throws a descriptive `Error` with an
 * install hint when the binary itself is missing (ENOENT / "not found"), and a
 * `timed out after Nms` error when `opts.timeoutMs` elapses.
 *
 * A runner with its own liveness watchdog (the streaming runner's
 * `idleTimeoutMs`) rejects with a message that does NOT name the command,
 * precisely so this wrapper's `limactl <args> failed: …` prefix reads as one
 * sentence rather than repeating it.
 *
 * Callers are expected to check `result.exitCode` themselves — this helper
 * only throws for transport-level failures (limactl unavailable, signal
 * killing the process, timeout), not for normal non-zero exits.
 */
export async function runLimactl(
  subprocess: SubprocessRunner,
  args: string[],
  opts: RunLimactlOpts = {}
): Promise<LimactlResult> {
  const { timeoutMs } = opts;
  try {
    return await subprocess.run(
      'limactl',
      args,
      typeof timeoutMs === 'number' ? { timeoutMs } : undefined
    );
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    // `execFile`'s timeout kills the child with a signal, so the rejection
    // carries a generic "killed"/"SIGTERM" message with no mention of the
    // bound that was exceeded. Say so explicitly — a bound that fires
    // anonymously is barely better than no bound at all.
    if (typeof timeoutMs === 'number' && isTimeoutRejection(err)) {
      throw new Error(
        `limactl ${args.join(' ')} timed out after ${timeoutMs}ms. ` +
          `The VM is not answering — it may be starved of host CPU/memory, ` +
          `or its SSH session may be wedged.`
      );
    }
    const hint = /ENOENT|not found/i.test(cause)
      ? ' (is `limactl` installed? `brew install lima`)'
      : '';
    throw new Error(`limactl ${args.join(' ')} failed: ${cause}${hint}`);
  }
}

/**
 * Wrap a non-zero `limactl` exit into a descriptive `Error`.
 *
 * The rendering belongs to the substrate layer — a failed guest command reads
 * the same however it was carried — so this is an alias that keeps the Lima
 * callers' vocabulary rather than a second implementation of the same three
 * lines.
 */
export function limactlError(prefix: string, result: LimactlResult): Error {
  return guestCommandError(prefix, result);
}
