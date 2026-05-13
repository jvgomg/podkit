/**
 * local-linux runner — executes test commands directly on the host.
 *
 * Available only on `linux`. `prepare()` and `teardown()` are no-ops: there is
 * no VM, no gadget setup, no snapshot management to handle.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import type { RunOpts, RunResult, RunnerId, TestRuntime } from '../runtime.js';

const ID: RunnerId = 'local-linux';

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
  async run(command: string, opts?: RunOpts) {
    return runCommand(command, opts);
  },
  async teardown() {
    // No-op: nothing to release.
  },
};

export default localLinuxRunner;
