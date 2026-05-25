/**
 * local-linux runner — executes test commands directly on the host.
 *
 * Available only on `linux`. `prepare()` and `teardown()` are no-ops: there is
 * no VM, no gadget setup, no snapshot management to handle.
 *
 * `applyState()` shells out to `apply-state.sh` BUT only when the env var
 * `PODKIT_DEVTEST_LOCAL_MUTATE=1` is set. The script removes apt packages and
 * mutates udev/configfs state — running it against a developer's host by
 * mistake would silently break their environment. The env-var opt-in is the
 * safeguard; without it, `applyState()` logs a warning and returns.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunOpts, RunResult, RunnerId, TestRuntime } from '../runtime.js';
import type { SystemState } from '../system-states/types.js';

const ID: RunnerId = 'local-linux';

/** Env var that opts a host in to `apply-state.sh` mutation. */
export const LOCAL_MUTATE_ENV = 'PODKIT_DEVTEST_LOCAL_MUTATE';

/**
 * Resolve the host-side path to `apply-state.sh`. Mirrors the path used in
 * `lima-test-vm-state.ts` so both runners stay in sync if the script moves.
 */
function defaultApplyStateScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(thisFile);
  // moduleDir is .../test-packages/device-testing/{src,dist}/runners/
  return path.resolve(
    moduleDir,
    '..',
    '..',
    '..',
    '..',
    'tools',
    'device-testing',
    'scripts',
    'apply-state.sh'
  );
}

/**
 * Run a single shell command, capturing stdout/stderr/exit/signal and
 * respecting an optional timeout.
 */
function runCommand(command: string, opts: RunOpts = {}): Promise<RunResult> {
  const { cwd, env, timeoutMs } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Escalate to SIGKILL if SIGTERM is ignored.
        killHandle = setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);
    }

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : timedOut ? 124 : -1,
        signal: signal ?? null,
      });
    });
  });
}

/** Singleton local-linux runner. */
export const localLinuxRunner: TestRuntime = {
  id: ID,
  async isAvailable() {
    return process.platform === 'linux';
  },
  async prepare() {
    // No-op: no setup required for local execution.
  },
  async applyState(state: SystemState) {
    if (process.env[LOCAL_MUTATE_ENV] !== '1') {
      // eslint-disable-next-line no-console
      console.warn(
        `[local-linux] skipping applyState('${state.id}'): ${LOCAL_MUTATE_ENV}=1 ` +
          `required to mutate this host (apply-state.sh would remove apt packages and ` +
          `change udev/configfs state). No-op.`
      );
      return;
    }
    const scriptPath = defaultApplyStateScriptPath();
    const result = await runCommand(`sudo ${scriptPath} ${state.id}`, { timeoutMs: 60_000 });
    if (result.exitCode !== 0) {
      const tail = result.stderr.trim() || result.stdout.trim() || `exit=${result.exitCode}`;
      throw new Error(
        `[local-linux] apply-state.sh ${state.id} failed (exit=${result.exitCode}): ${tail}`
      );
    }
  },
  async run(command: string, opts?: RunOpts) {
    return runCommand(command, opts);
  },
  async teardown() {
    // No-op: nothing to release.
  },
};

export default localLinuxRunner;
