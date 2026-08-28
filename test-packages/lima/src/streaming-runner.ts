/**
 * A `SubprocessRunner` that streams the child's output as it arrives while
 * still capturing it, plus the composed runner the VM lifecycle uses.
 *
 * The default runner buffers via `execFile` and hands back the output only on
 * exit. That is right for probes, but wrong for the one operation that can take
 * ten minutes: a cold `limactl start --name … <yaml>`, whose provisioning log
 * is the operator's only evidence that anything is happening. Buffering it
 * makes a slow create indistinguishable from a hung one.
 *
 * Streaming also buys something a wall clock cannot: **progress-based
 * liveness**. A cold create legitimately runs for five to ten minutes, so any
 * wall-clock bound tight enough to catch a wedge would abort a healthy
 * provision — and a `limactl start` killed mid-create leaves a half-built
 * instance behind, which is worse than the hang. But a create that has emitted
 * nothing at all for longer than a whole legitimate create takes is not slow,
 * it is wedged. {@link StreamingRunnerOptions.idleTimeoutMs} bounds that case
 * and only that case.
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
import {
  DEFAULT_HEARTBEAT_MS,
  formatElapsed,
  startHeartbeat,
  type ProgressReport,
} from './progress.js';

/** Where streamed output is echoed. */
export type StreamSink = (chunk: string) => void;

/**
 * Grace period between SIGTERM and SIGKILL for a child we have stopped waiting
 * on. Long enough for a well-behaved process to flush and exit on its own,
 * short enough that a wedged one does not linger.
 */
export const DEFAULT_KILL_GRACE_MS = 2_000;

/**
 * Kill grace for a `limactl start`/`create` we have declared wedged.
 *
 * Longer than {@link DEFAULT_KILL_GRACE_MS}, but NOT because `limactl` unwinds
 * anything when asked. Measured: the `limactl start` process exits ~7ms after
 * SIGTERM, silently, with no shutdown of its own. The hostagent child that
 * actually owns the hypervisor is simply reparented to init and **carries on** —
 * in one measurement it went on to finish booting and reach READY some 30s
 * after its parent died.
 *
 * So this grace never elapses in practice: the child's `close` fires almost
 * immediately and cancels the escalation. It is kept as a non-zero floor for a
 * future `limactl` that does handle the signal, not as a wait anything depends
 * on today.
 *
 * The consequence worth understanding is that killing the wrapper does not
 * cancel the provision. What actually reclaims an orphaned hostagent is
 * `destroy()` (`limactl delete --force`), which reads the pidfile and kills the
 * hostagent and hypervisor by PID. `recover` is therefore the honest remedy
 * after an aborted create, and that is what the error text points at.
 */
export const PROVISIONING_KILL_GRACE_MS = 15_000;

/**
 * How long a streamed provisioning call may emit NOTHING before it is treated
 * as wedged.
 *
 * Deliberately larger than the *total* duration of the slowest legitimate cold
 * create (documented in this package's README and ADR-027 as five to ten
 * minutes, dominated by the image download and the per-boot provision scripts).
 * Sizing the idle window above the whole legitimate operation is what makes it
 * safe: a create that is merely slow cannot trip it however slow it gets,
 * because it would have to be silent for longer than a healthy create takes
 * end to end. Anything past that is not progress, and the operator is better
 * served by a named failure and a pointer at `recover` than by an unbounded
 * wait.
 */
export const PROVISIONING_IDLE_TIMEOUT_MS = 15 * 60_000;

/** Options for {@link createStreamingSubprocessRunner}. */
export interface StreamingRunnerOptions {
  /** Where output is echoed as it arrives. Defaults to `process.stderr`. */
  sink?: StreamSink;
  /**
   * Abort the child when it has produced no stdout/stderr for this long.
   * Omitted or `<= 0` disables the watchdog. This is a *liveness* bound, not a
   * duration bound: every chunk of output rearms it.
   */
  idleTimeoutMs?: number;
  /** SIGTERM→SIGKILL grace for an aborted child. */
  killGraceMs?: number;
}

/**
 * Build a runner that echoes the child's stdout+stderr to `sink` as they
 * arrive and also resolves with the captured text.
 *
 * Contract matches `SubprocessRunner`: a non-zero exit resolves (it is a normal
 * outcome); only a spawn-level failure, a `timeoutMs` breach or an
 * `idleTimeoutMs` breach rejects.
 */
export function createStreamingSubprocessRunner(
  options: StreamingRunnerOptions = {}
): SubprocessRunner {
  const sink = options.sink ?? ((chunk: string) => void process.stderr.write(chunk));
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

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
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        // The promise must settle exactly once. On timeout we settle from the
        // timer rather than from `close` (see below), so both paths race.
        let settled = false;

        const finish = (act: () => void): void => {
          if (settled) return;
          settled = true;
          if (deadlineTimer) clearTimeout(deadlineTimer);
          if (idleTimer) clearTimeout(idleTimer);
          // `killTimer` is deliberately NOT cleared here. Settling the promise
          // means we have stopped waiting for the child; it does not mean the
          // child has died. Cancelling the escalation at this point would
          // leave a process that ignores SIGTERM running forever — the exact
          // runaway the escalation exists to prevent. It is cancelled when the
          // child actually closes, and it is unref'd so it never holds the
          // process open.
          act();
        };

        /**
         * SIGTERM now, SIGKILL if the child is still there after the grace.
         * Idempotent: the deadline and the idle watchdog can both reach it, and
         * a second escalation timer would orphan the first.
         */
        const terminate = (): void => {
          if (killTimer) return;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
          killTimer.unref?.();
        };

        /**
         * (Re)start the no-output watchdog. Called at spawn and on each chunk.
         * A settled promise means we have stopped waiting, so late output from
         * a child we already abandoned must not schedule a fresh watchdog.
         */
        const armIdleWatchdog = (): void => {
          if (idleTimeoutMs <= 0 || settled) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            terminate();
            // Phrased without the command name because every caller in this
            // package wraps it (`runLimactl` prefixes `limactl <args> failed:`),
            // and a doubled command in the message reads as a bug.
            finish(() =>
              reject(
                new Error(
                  `produced no output for ${formatElapsed(idleTimeoutMs)} and was aborted as wedged. ` +
                    `A slow VM keeps logging progress; total silence for that long does not. ` +
                    `The instance may be left half-provisioned — recreate it with \`podkit-vm recover\`.`
                )
              )
            );
          }, idleTimeoutMs);
          idleTimer.unref?.();
        };

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk;
          armIdleWatchdog();
          sink(chunk);
        });
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk;
          armIdleWatchdog();
          sink(chunk);
        });
        armIdleWatchdog();

        if (typeof opts.timeoutMs === 'number') {
          const timeoutMs = opts.timeoutMs;
          deadlineTimer = setTimeout(() => {
            terminate();
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
          if (killTimer) clearTimeout(killTimer);
          finish(() => reject(err));
        });
        child.on('close', (code, signal) => {
          // The child is gone; no escalation needed.
          if (killTimer) clearTimeout(killTimer);
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

/** Options for {@link createVmProvisioningRunner}. */
export interface VmProvisioningRunnerOptions {
  /** Where a streamed child's output is echoed. Defaults to `process.stderr`. */
  sink?: StreamSink;
  /**
   * Where periodic "still waiting on …" lines go. Omitted means no heartbeat at
   * all (no timer is started), which is the right default for library callers —
   * only the CLI prints.
   */
  report?: ProgressReport;
  /** Heartbeat interval. `<= 0` disables it. */
  heartbeatMs?: number;
  /** No-output bound for the streamed provisioning subcommands. `<= 0` disables it. */
  idleTimeoutMs?: number;
}

/**
 * The runner the CLI and the harness hand to the lifecycle primitives:
 *
 * - streams a create/start's provisioning output live and holds it to a
 *   progress-based liveness bound;
 * - buffers everything else through the plain default runner;
 * - reports elapsed time periodically for *any* invocation, so a silent
 *   `limactl stop` is diagnosable while it is still running rather than only in
 *   hindsight.
 *
 * The per-call state (last-output timestamp) means the streaming runner is
 * built per invocation; the object is trivial and a VM lifecycle call is not a
 * hot path.
 */
export function createVmProvisioningRunner(
  options: VmProvisioningRunnerOptions = {}
): SubprocessRunner {
  const sink = options.sink ?? ((chunk: string) => void process.stderr.write(chunk));
  const { report } = options;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? PROVISIONING_IDLE_TIMEOUT_MS;

  return {
    async run(command, args, opts) {
      const streamed = streamsOutput(command, args);
      // Seeded at spawn so "since last output" is meaningful before the first
      // chunk, and measured from the same instant as the idle watchdog.
      let lastActivityAt = Date.now();
      const runner = streamed
        ? createStreamingSubprocessRunner({
            sink: (chunk) => {
              lastActivityAt = Date.now();
              sink(chunk);
            },
            idleTimeoutMs,
            killGraceMs: PROVISIONING_KILL_GRACE_MS,
          })
        : defaultSubprocessRunner;

      const heartbeat = report
        ? startHeartbeat({
            label: [command, ...args].join(' '),
            report,
            intervalMs: heartbeatMs,
            lastActivityAt: streamed ? () => lastActivityAt : undefined,
          })
        : undefined;

      try {
        return await runner.run(command, args, opts);
      } finally {
        heartbeat?.stop();
      }
    },
  };
}
