/**
 * SubprocessRunner — abstraction the inquiry/doctor/transcoding pipelines use
 * to spawn helpers (`ffmpeg`, `ffprobe`, `lsblk`, `system_profiler`,
 * `diskutil`, `mount`, `umount`, `udisksctl`, `which`, …).
 *
 * The interface lives in `@podkit/device-types` (the dependency root) so that
 * production packages (`@podkit/core`, `@podkit/ipod-firmware`) can type their
 * dependency-injection seams against it without importing the test harness
 * package `@podkit/device-testing`. The harness package re-exports it and
 * layers capture/replay implementations on top.
 *
 * Semantics:
 *
 * - `run` resolves with `{ stdout, stderr, exitCode }` for both zero and
 *   non-zero exit codes — a non-zero exit is a normal outcome, not an error.
 * - `run` rejects only for transport-level failures (binary not found,
 *   timeout, spawn error).
 * - `opts.env`, when provided, is merged onto `process.env` by the default
 *   implementation; callsites should rely on that merge unless they
 *   explicitly want to wipe the environment.
 *
 * @see adr/adr-016-linux-vm-test-harness.md "Unit tests with injectable transports"
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

/** Options for `SubprocessRunner.run`. */
export interface SubprocessRunOpts {
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Environment variables; the default runner merges onto `process.env`. */
  env?: Record<string, string>;
  /** String written to the spawned process's stdin. */
  input?: string;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
}

/** Captured outcome of a `SubprocessRunner.run` invocation. */
export interface SubprocessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Pluggable subprocess execution surface.
 *
 * Production code accepts a `SubprocessRunner` parameter (default: real
 * `execFile`-backed runner) so that unit tests can swap in a hand-rolled stub
 * without altering call semantics.
 */
export interface SubprocessRunner {
  run(command: string, args: string[], opts?: SubprocessRunOpts): Promise<SubprocessRunResult>;
}
