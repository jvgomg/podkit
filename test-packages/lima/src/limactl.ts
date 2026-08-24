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
 * Recognise the rejection `child_process.execFile` produces when its
 * `timeout` option fires: the child is killed by a signal, so `killed` is
 * `true` and/or the error carries a `SIGTERM`/`SIGKILL` signal rather than a
 * numeric exit code.
 */
function isTimeoutRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { killed?: boolean; signal?: string | null };
  if (candidate.killed === true) return true;
  return candidate.signal === 'SIGTERM' || candidate.signal === 'SIGKILL';
}

/**
 * Wrap a non-zero `limactl` exit into a descriptive `Error`. Prefers
 * `stderr` for the trailing detail; falls back to `stdout` then to an
 * `(exit=N)` placeholder.
 */
export function limactlError(prefix: string, result: LimactlResult): Error {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const tail = stderr || stdout || `(no output, exit=${result.exitCode})`;
  return new Error(`${prefix}: exit=${result.exitCode}: ${tail}`);
}

/**
 * Minimal POSIX shell quoting — wraps the value in single quotes and escapes
 * embedded single quotes. Used so paths with spaces or special chars survive
 * the `sh -c '…'` body that the runner passes through `limactl shell`.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
