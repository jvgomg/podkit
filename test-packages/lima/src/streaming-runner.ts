/**
 * A `SubprocessRunner` that streams the child's output as it arrives while
 * still capturing it.
 *
 * The default runner buffers via `execFile` and hands back the output only on
 * exit. That is right for probes, but wrong for the one operation that can take
 * ten minutes: a cold `limactl start --name … <yaml>`, whose provisioning log
 * is the operator's only evidence that anything is happening. Buffering it
 * makes a slow create indistinguishable from a hung one.
 *
 * So the CLI uses this runner for the verbs that can create or start a VM, and
 * the plain buffered default everywhere else. Output is teed to a sink (stderr
 * by default, so a caller can still pipe the CLI's stdout) AND returned, so the
 * lifecycle primitives' error messages keep their detail.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import {
  defaultSubprocessRunner,
  type SubprocessRunner,
  type SubprocessRunOpts,
  type SubprocessRunResult,
} from '@podkit/device-types';

/** Where streamed output is echoed. */
export type StreamSink = (chunk: string) => void;

/**
 * Grace period between SIGTERM and SIGKILL for a timed-out child. Long enough
 * for a well-behaved process to flush and exit on its own, short enough that a
 * wedged one does not linger.
 */
const SIGKILL_GRACE_MS = 2_000;

/**
 * Build a runner that echoes the child's stdout+stderr to `sink` as they
 * arrive and also resolves with the captured text.
 *
 * Contract matches `SubprocessRunner`: a non-zero exit resolves (it is a normal
 * outcome); only a spawn-level failure rejects.
 */
export function createStreamingSubprocessRunner(
  sink: StreamSink = (chunk) => process.stderr.write(chunk)
): SubprocessRunner {
  return {
    run(
      command: string,
      args: string[],
      opts: SubprocessRunOpts = {}
    ): Promise<SubprocessRunResult> {
      return new Promise<SubprocessRunResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: opts.cwd,
          env: opts.env ? { ...process.env, ...opts.env } : process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        // The promise must settle exactly once. On timeout we settle from the
        // timer rather than from `close` (see below), so both paths race.
        let settled = false;

        const finish = (act: () => void): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          act();
        };

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk;
          sink(chunk);
        });
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk;
          sink(chunk);
        });

        if (typeof opts.timeoutMs === 'number') {
          const timeoutMs = opts.timeoutMs;
          timer = setTimeout(() => {
            child.kill('SIGTERM');
            // Escalate for a child that ignores SIGTERM, so a wedged process is
            // not left running indefinitely after we have stopped waiting.
            killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
            killTimer.unref?.();
            // Reject here rather than waiting for `close`. `close` fires only
            // once the child's stdio pipes are closed, and a grandchild that
            // inherited them keeps them open after the direct child dies —
            // `sh -c '<cmd>'` forks rather than execs on some shells, so the
            // rejection would be deferred until the grandchild exits, which is
            // exactly the runaway this timeout exists to bound. Settling on the
            // timer makes the deadline mean what it says.
            finish(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)));
          }, timeoutMs);
        }

        child.on('error', (err) => {
          finish(() => reject(err));
        });
        child.on('close', (code, signal) => {
          // A signalled child has no numeric exit code; report the conventional
          // 128+signal shape rather than inventing a success.
          const exitCode = code ?? (signal ? 129 : 1);
          finish(() => resolve({ stdout, stderr, exitCode }));
        });

        if (opts.input !== undefined && child.stdin) {
          child.stdin.end(opts.input);
        }
      });
    },
  };
}

/**
 * The `limactl` subcommands worth streaming: the two that provision. Everything
 * else the lifecycle issues is a probe (`list --json`) or a fast mutation
 * (`stop`, `delete`), whose output is either machine-readable noise or a single
 * line — echoing those would bury the provisioning log the operator needs.
 */
const STREAMED_SUBCOMMANDS = new Set(['start', 'create']);

/**
 * Whether a given invocation's output should be streamed. Exposed so the
 * routing decision is testable on its own — asserting it by actually spawning
 * `limactl start` would provision a VM.
 */
export function streamsOutput(command: string, args: readonly string[]): boolean {
  return command === 'limactl' && args[0] !== undefined && STREAMED_SUBCOMMANDS.has(args[0]);
}

/**
 * The runner the CLI hands to the lifecycle primitives: streams a
 * create/start's provisioning output live, buffers everything else through the
 * plain default runner.
 */
export function createVmProvisioningRunner(
  sink: StreamSink = (chunk) => process.stderr.write(chunk)
): SubprocessRunner {
  const streaming = createStreamingSubprocessRunner(sink);
  return {
    run(command, args, opts) {
      const runner = streamsOutput(command, args) ? streaming : defaultSubprocessRunner;
      return runner.run(command, args, opts);
    },
  };
}
