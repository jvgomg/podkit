/**
 * Subprocess snapshot framework — capture + replay layered on the
 * `SubprocessRunner` interface from `@podkit/device-types`.
 *
 * Pipeline:
 *
 * - Production callsites accept a `SubprocessRunner` (default: real
 *   `execFile`-backed runner). Tier 3 tests run on a real (or VM) system and
 *   leave the default in place.
 * - Tier 1 unit tests inject a `ReplaySubprocessRunner` pointed at a fixture
 *   directory. The replay runner returns the recorded result for a matching
 *   `(command, args, cwd, env)` hash and throws a clear error on miss.
 * - To regenerate fixtures, set `PODKIT_SNAPSHOT_CAPTURE=1` and
 *   `PODKIT_SNAPSHOT_DIR=<dir>` and run the test command — every call is
 *   recorded to `<dir>/{hash}.json`.
 *
 * The factory `createSubprocessRunner(env)` selects the appropriate runner
 * based on env vars; tests inject the result through the same `SubprocessRunner`
 * DI seam that production uses.
 *
 * @see adr/adr-016-linux-vm-test-harness.md "Tier 1 layer"
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultSubprocessRunner } from '@podkit/core';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

// Re-export the canonical interface + runner so downstream consumers have a
// single import path. Runner is sourced from `@podkit/core` to keep behaviour
// in lockstep with production — no duplication.
export type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult };
export { defaultSubprocessRunner };

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Shape that `JSON.stringify` consumes to produce the hash payload.
 * Keys are written in alphabetical order so the JSON output is stable.
 */
interface HashPayload {
  args: string[];
  command: string;
  cwd: string | null;
  env: Record<string, string> | null;
}

/**
 * Produce a stable 16-hex-char hash of the call descriptor. The hash is
 * deterministic across processes/platforms so captured fixtures and replay
 * lookups always agree.
 */
export function hashSubprocessCall(
  command: string,
  args: string[],
  opts?: SubprocessRunOpts
): string {
  const sortedEnv = opts?.env ? sortKeys(opts.env) : null;
  const payload: HashPayload = {
    args,
    command,
    cwd: opts?.cwd ?? null,
    env: sortedEnv,
  };
  // Stringify keys in alphabetical order regardless of insertion order.
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = obj[key]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

/**
 * On-disk representation of a captured subprocess call.
 *
 * `opts` deliberately omits `input` and `timeoutMs` — they are not part of
 * the hash, and recording them would only clutter the fixture without
 * affecting replay matching.
 */
export interface SubprocessFixture {
  command: string;
  args: string[];
  opts: {
    cwd?: string;
    env?: Record<string, string>;
  };
  stdout: string;
  stderr: string;
  exitCode: number;
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Capturing runner
// ---------------------------------------------------------------------------

/**
 * Wraps a real `SubprocessRunner` and records every call to a fixture
 * directory as `{hash}.json`. Forwards the live result to the caller
 * unchanged.
 *
 * Intended use: run a test command with `PODKIT_SNAPSHOT_CAPTURE=1` and
 * `PODKIT_SNAPSHOT_DIR=<persona-or-shared-dir>` so the fixtures can be
 * checked into the relevant persona directory.
 */
export class CapturingSubprocessRunner implements SubprocessRunner {
  constructor(
    private readonly inner: SubprocessRunner,
    private readonly fixtureDir: string
  ) {}

  async run(
    command: string,
    args: string[],
    opts?: SubprocessRunOpts
  ): Promise<SubprocessRunResult> {
    const result = await this.inner.run(command, args, opts);
    const hash = hashSubprocessCall(command, args, opts);

    const fixture: SubprocessFixture = {
      command,
      args,
      opts: {
        ...(opts?.cwd ? { cwd: opts.cwd } : {}),
        ...(opts?.env ? { env: opts.env } : {}),
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      capturedAt: new Date().toISOString(),
    };

    fs.mkdirSync(this.fixtureDir, { recursive: true });
    const outPath = path.join(this.fixtureDir, `${hash}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');

    return result;
  }
}

// ---------------------------------------------------------------------------
// Replay runner
// ---------------------------------------------------------------------------

/**
 * Returns recorded subprocess results from a fixture directory. Throws a
 * descriptive error when no fixture matches the call, pointing the developer
 * at the exact capture command that would regenerate it.
 */
export class ReplaySubprocessRunner implements SubprocessRunner {
  constructor(private readonly fixtureDir: string) {}

  async run(
    command: string,
    args: string[],
    opts?: SubprocessRunOpts
  ): Promise<SubprocessRunResult> {
    const hash = hashSubprocessCall(command, args, opts);
    const fixturePath = path.join(this.fixtureDir, `${hash}.json`);

    let raw: string;
    try {
      raw = fs.readFileSync(fixturePath, 'utf8');
    } catch {
      throw new Error(formatMissingFixtureError(command, args, this.fixtureDir, hash));
    }

    let fixture: SubprocessFixture;
    try {
      fixture = JSON.parse(raw) as SubprocessFixture;
    } catch (err) {
      throw new Error(
        `Subprocess fixture ${fixturePath} is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    return {
      stdout: fixture.stdout,
      stderr: fixture.stderr,
      exitCode: fixture.exitCode,
    };
  }
}

function formatMissingFixtureError(
  command: string,
  args: string[],
  fixtureDir: string,
  hash: string
): string {
  const argList = args.map((a) => JSON.stringify(a)).join(', ');
  return (
    `No fixture for command='${command}' args=[${argList}] ` +
    `(hash=${hash}, dir=${fixtureDir}). ` +
    `Capture with: PODKIT_SNAPSHOT_CAPTURE=1 PODKIT_SNAPSHOT_DIR=${fixtureDir} <test cmd>`
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Pick a `SubprocessRunner` based on environment variables.
 *
 * - `PODKIT_SNAPSHOT_CAPTURE=1` → `CapturingSubprocessRunner` wrapping the
 *   default real runner; writes fixtures into `PODKIT_SNAPSHOT_DIR`.
 * - `PODKIT_SNAPSHOT_REPLAY=1` → `ReplaySubprocessRunner` reading from
 *   `PODKIT_SNAPSHOT_DIR`.
 * - Otherwise → `defaultSubprocessRunner`.
 *
 * Throws when capture/replay is requested without a `PODKIT_SNAPSHOT_DIR`
 * value — failing loudly is preferable to silently writing fixtures into
 * `process.cwd()` or replaying from a nonexistent path.
 */
export function createSubprocessRunner(env: NodeJS.ProcessEnv = process.env): SubprocessRunner {
  const capture = env['PODKIT_SNAPSHOT_CAPTURE'] === '1';
  const replay = env['PODKIT_SNAPSHOT_REPLAY'] === '1';
  const dir = env['PODKIT_SNAPSHOT_DIR'];

  if (capture && replay) {
    throw new Error(
      'Both PODKIT_SNAPSHOT_CAPTURE=1 and PODKIT_SNAPSHOT_REPLAY=1 are set — choose one.'
    );
  }

  if (capture) {
    if (!dir) {
      throw new Error(
        'PODKIT_SNAPSHOT_CAPTURE=1 requires PODKIT_SNAPSHOT_DIR to be set to the fixture directory.'
      );
    }
    return new CapturingSubprocessRunner(defaultSubprocessRunner, dir);
  }

  if (replay) {
    if (!dir) {
      throw new Error(
        'PODKIT_SNAPSHOT_REPLAY=1 requires PODKIT_SNAPSHOT_DIR to be set to the fixture directory.'
      );
    }
    return new ReplaySubprocessRunner(dir);
  }

  return defaultSubprocessRunner;
}
