/**
 * E2E test helper for asserting on canonical CLI error JSON.
 *
 * Subprocess flavour of the in-process helper at
 * `packages/podkit-cli/src/test-utils/cli-error.ts`. Spawns the CLI, captures
 * stdout + stderr + exitCode, and asserts the stdout contains a
 * `CliErrorOutput` payload matching expectations.
 *
 * @module
 */

import { expect } from 'bun:test';
import { runCli, type CliOptions, type CliResult } from './cli-runner.js';

/**
 * Canonical error JSON shape — mirrors `CliErrorOutput` from podkit-cli.
 *
 * Inlined here to avoid creating a build-order dependency on podkit-cli's
 * source from the e2e packages.
 */
export interface CliErrorJson {
  success: false;
  error: string;
  code: string;
  details: Record<string, unknown>;
}

export interface ExpectCliErrorMatch {
  /** Required: machine-readable code (e.g. `NO_DEVICES`). */
  code: string;
  /** Optional: substring or regex `error` must match. */
  error?: string | RegExp;
  /** Optional: subset of fields the payload's `details` object must include. */
  details?: Record<string, unknown>;
  /** Optional: expected exit code (defaults to 1). */
  exitCode?: number;
}

/**
 * Run the CLI and assert the failure shape. Returns the parsed payload and
 * raw `CliResult` so callers can do additional inspection.
 *
 * @example
 * ```ts
 * const { json } = await expectCliError(
 *   ['device', 'music', '--json'],
 *   { code: 'NO_DEVICES', error: /No devices configured/ }
 * );
 * ```
 */
export async function expectCliError(
  args: string[],
  match: ExpectCliErrorMatch,
  options: CliOptions = {}
): Promise<{ result: CliResult; json: CliErrorJson }> {
  const result = await runCli(args, options);

  expect(result.exitCode).toBe(match.exitCode ?? 1);

  const trimmed = result.stdout.trim();
  if (!trimmed) {
    throw new Error(`expectCliError: no JSON on stdout. stderr was:\n${result.stderr}`);
  }

  let json: CliErrorJson;
  try {
    json = JSON.parse(trimmed) as CliErrorJson;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`expectCliError: stdout was not valid JSON (${msg}). stdout was:\n${trimmed}`);
  }

  expect(json.success).toBe(false);
  expect(json.code).toBe(match.code);

  if (match.error !== undefined) {
    if (match.error instanceof RegExp) {
      expect(json.error).toMatch(match.error);
    } else {
      expect(json.error).toContain(match.error);
    }
  }

  if (match.details !== undefined) {
    expect(json.details).toMatchObject(match.details);
  }

  return { result, json };
}
