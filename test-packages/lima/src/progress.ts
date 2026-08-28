/**
 * Elapsed-time progress reporting for long-running `limactl` invocations.
 *
 * A VM operation that hangs silently is indistinguishable from one that is
 * merely slow, and that ambiguity is what turns a wedge into a guess: the
 * operator sees a cursor and has to decide, with no evidence, whether to wait
 * or to kill it. A periodic "still waiting on X (Nm elapsed)" line costs
 * nothing and removes the guess.
 *
 * The heartbeat is a *reporting* primitive, not a control one — it never kills
 * anything. Library modules stay quiet (no `report` supplied means no timer is
 * even started); only the CLI wires it to stderr.
 *
 * @module
 */

/** Default gap between heartbeat lines. */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/** Sink for heartbeat lines. The caller owns any prefixing and the stream. */
export type ProgressReport = (line: string) => void;

/**
 * Render a duration the way an operator reads a clock — `45s`, `2m47s` —
 * rather than as raw milliseconds. Heartbeats are read at a glance while
 * deciding whether to keep waiting.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Options for {@link startHeartbeat}. */
export interface HeartbeatOpts {
  /** What is being waited on, e.g. `limactl stop podkit-device`. */
  label: string;
  /** Where the lines go. */
  report: ProgressReport;
  /** Gap between lines. `<= 0` disables the heartbeat entirely. */
  intervalMs?: number;
  /**
   * Timestamp (ms) of the most recent sign of life from the child, when the
   * caller can observe one. Supplied only for invocations whose output is
   * streamed — for those, "time since last output" is the same signal the idle
   * watchdog acts on, so surfacing it lets an operator watch the number the
   * watchdog is about to fire on rather than being surprised by it.
   */
  lastActivityAt?: () => number | undefined;
  /** Clock seam; tests pass a controllable one. */
  now?: () => number;
}

/** Handle for a running heartbeat. */
export interface HeartbeatHandle {
  /** Stop reporting. Safe to call more than once. */
  stop(): void;
}

/**
 * Start emitting periodic progress lines until {@link HeartbeatHandle.stop} is
 * called. The timer is unref'd, so a heartbeat can never be the reason a
 * process fails to exit.
 */
export function startHeartbeat(opts: HeartbeatOpts): HeartbeatHandle {
  const { label, report, lastActivityAt } = opts;
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_MS;
  const now = opts.now ?? Date.now;
  if (intervalMs <= 0) {
    return { stop() {} };
  }

  const startedAt = now();
  const timer = setInterval(() => {
    const elapsed = formatElapsed(now() - startedAt);
    const activity = lastActivityAt?.();
    if (activity === undefined) {
      report(`still waiting on \`${label}\` (${elapsed} elapsed)`);
      return;
    }
    const idle = formatElapsed(now() - activity);
    report(`still waiting on \`${label}\` (${elapsed} elapsed, ${idle} since last output)`);
  }, intervalMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
