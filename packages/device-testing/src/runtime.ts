/**
 * TestRuntime — abstraction over where a test command actually executes.
 *
 * Today's runners:
 *
 * - `local-linux` — spawns commands directly on a Linux host (or CI runner).
 *
 * Future runners (added without modifying core code via the registry pattern):
 *
 * - `lima-test-vm` — proxies commands into a Lima VM with `dummy_hcd` + a
 *   FunctionFS daemon. Lands in TASK-321.03.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @module
 */

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
  /** Execute a single command. */
  run(command: string, opts?: RunOpts): Promise<RunResult>;
  /** Tear down any state owned by this runner. */
  teardown(): Promise<void>;
}
