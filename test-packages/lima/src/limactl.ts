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

/**
 * Run `limactl <args>` via the supplied subprocess runner. Returns the
 * `{stdout, stderr, exitCode}` triple. Throws a descriptive `Error` with an
 * install hint when the binary itself is missing (ENOENT / "not found").
 *
 * Callers are expected to check `result.exitCode` themselves — this helper
 * only throws for transport-level failures (limactl unavailable, signal
 * killing the process, etc.), not for normal non-zero exits.
 */
export async function runLimactl(
  subprocess: SubprocessRunner,
  args: string[]
): Promise<LimactlResult> {
  try {
    return await subprocess.run('limactl', args);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const hint = /ENOENT|not found/i.test(cause)
      ? ' (is `limactl` installed? `brew install lima`)'
      : '';
    throw new Error(`limactl ${args.join(' ')} failed: ${cause}${hint}`);
  }
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
