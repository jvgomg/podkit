/**
 * Default real-subprocess runner for podkit-core.
 *
 * Implements the `SubprocessRunner` interface defined in `@podkit/device-types`
 * by spawning the real binary via `child_process.execFile`. The framework that
 * layers capture/replay on top lives in `@podkit/device-testing` so production
 * never depends on the test harness; callsites accept a `SubprocessRunner`
 * parameter typed against the interface and default to this runner.
 *
 * Semantics (must match the interface contract):
 *
 * - Non-zero exit codes resolve with `{ stdout, stderr, exitCode }` — they
 *   are a normal outcome, not an error.
 * - `opts.env` is merged onto `process.env` so callers only need to supply
 *   the variables they want to override.
 * - Transport-level failures (binary not found, timeout, spawn error) reject
 *   with the underlying `Error`.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

/** Maximum captured stdout/stderr size — large enough for ffmpeg `-encoders` output. */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Default real-subprocess runner backed by `child_process.execFile`.
 */
export const defaultSubprocessRunner: SubprocessRunner = {
  run(command: string, args: string[], opts: SubprocessRunOpts = {}): Promise<SubprocessRunResult> {
    const { cwd, env, input, timeoutMs } = opts;
    return new Promise<SubprocessRunResult>((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          cwd,
          env: env ? { ...process.env, ...env } : process.env,
          timeout: timeoutMs,
          maxBuffer: DEFAULT_MAX_BUFFER,
          encoding: 'utf8',
        },
        (err, stdout, stderr) => {
          if (err) {
            // execFile sets `.code` to the numeric exit code when the child
            // exited non-zero; only then is this a "normal" outcome.
            const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
            if (typeof code === 'number') {
              resolve({ stdout, stderr, exitCode: code });
              return;
            }
            reject(err);
            return;
          }
          resolve({ stdout, stderr, exitCode: 0 });
        }
      );
      if (input !== undefined && child.stdin) {
        child.stdin.end(input);
      }
    });
  },
};

export type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult };
