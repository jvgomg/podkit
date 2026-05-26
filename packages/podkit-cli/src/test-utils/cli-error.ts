/**
 * Test helpers for asserting on `CliErrorOutput`-shaped JSON.
 *
 * These collapse the most common assertion pattern — pull the JSON out of a
 * `BufferSink`, narrow to `CliErrorOutput`, check `code` / `error` / details
 * — into a single helper. Tests stay short and the canonical shape is
 * enforced consistently.
 *
 * In-process tests should call the runner with an `OutputContext` whose
 * stdout is a `BufferSink` and whose exitCode is a `BufferExitCodeSink`,
 * then pass both into `expectCliError`.
 *
 * For subprocess (e2e) tests, see `test-packages/e2e-tests/src/helpers/cli-error.ts`.
 */

import { expect } from 'bun:test';
import type { CliErrorOutput } from '../errors.js';
import type { BufferSink } from './buffer-sink.js';
import type { BufferExitCodeSink } from '../output/index.js';

export interface ExpectCliErrorMatch {
  /** Required: the canonical machine-readable code. */
  code: string;
  /** Optional: substring or regex the human-readable `error` must match. */
  error?: string | RegExp;
  /** Optional: details fields the payload's `details` object must include. */
  details?: Record<string, unknown>;
  /** Optional: expected exit code (defaults to 1 if not provided). */
  exitCode?: number;
}

/**
 * Assert that a `BufferSink` contains a canonical `CliErrorOutput` JSON
 * payload matching the given expectations. Returns the parsed payload so
 * callers can do additional inspection.
 *
 * @example
 * ```ts
 * await runAction(out, () => runMount(opts, out));
 * expectCliError(stdout, exitSink, {
 *   code: MountErrorCodes.MOUNT_REQUIRES_SUDO,
 *   error: /elevated privileges/,
 *   details: { device: '/dev/disk4s2' },
 *   exitCode: 1,
 * });
 * ```
 */
export function expectCliError(
  stdout: BufferSink,
  exitCode: BufferExitCodeSink,
  match: ExpectCliErrorMatch
): CliErrorOutput {
  const payload = stdout.json<CliErrorOutput>();

  expect(payload.success).toBe(false);
  expect(payload.code).toBe(match.code);

  if (match.error !== undefined) {
    if (match.error instanceof RegExp) {
      expect(payload.error).toMatch(match.error);
    } else {
      expect(payload.error).toContain(match.error);
    }
  }

  if (match.details !== undefined) {
    expect(payload.details).toMatchObject(match.details);
  }

  expect(exitCode.get()).toBe(match.exitCode ?? 1);

  return payload;
}
