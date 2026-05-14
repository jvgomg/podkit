/**
 * TestRuntime — abstraction over where a test command actually executes.
 *
 * Today's runners:
 *
 * - `local-linux` — spawns commands directly on a Linux host (or CI runner).
 * - `lima-test-vm` — proxies commands into a Lima VM with `dummy_hcd` + a
 *   FunctionFS daemon (ADR-016 Tier 3 on macOS dev hosts).
 *
 * New runners register themselves via `registerRunner()` (see `runners/registry.ts`)
 * without modifying this file.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @module
 */

import type { SystemState } from './system-states/types.js';

/**
 * Identifier for a registered runner. The known set is `'local-linux'` and
 * `'lima-test-vm'`; the type also admits arbitrary string IDs so third-party
 * runners can register without forcing a union widening here.
 */
export type RunnerId = 'local-linux' | 'lima-test-vm' | (string & {});

/** Options accepted by `TestRuntime.run`. */
export interface RunOpts {
  /** Working directory for the spawned command. */
  cwd?: string;
  /** Environment variables; merged onto `process.env`. */
  env?: Record<string, string>;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
}

/** Captured outcome of a `TestRuntime.run` invocation. */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}

/**
 * Test runtime — abstraction over where a test command executes.
 */
export interface TestRuntime {
  /** Stable identifier for this runner. */
  id: RunnerId;
  /** Whether this runner is usable on the current host (e.g. platform check). */
  isAvailable(): Promise<boolean>;
  /** Idempotent setup; called before the first `run`. */
  prepare(): Promise<void>;
  /**
   * Bring the runtime to a known `SystemState` — restores the matching VM
   * snapshot for `lima-test-vm`, shells out to `apply-state.sh` for
   * `local-linux` (gated behind `PODKIT_DEVTEST_LOCAL_MUTATE=1` so a dev host
   * is never mutated by accident).
   *
   * Tier-3 tests grouped by `SystemState` should call this once per group
   * rather than once per test (see ADR-016 §"Snapshot-based state layering").
   */
  applyState(state: SystemState): Promise<void>;
  /** Execute a single command. */
  run(command: string, opts?: RunOpts): Promise<RunResult>;
  /** Tear down any state owned by this runner. */
  teardown(): Promise<void>;
}
