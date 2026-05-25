/**
 * Runner registry — keyed by `RunnerId`.
 *
 * New runners (e.g. `lima-test-vm`) register themselves via `registerRunner()`
 * without modifying this file. Auto-registration of the `local-linux` runner
 * happens as a side-effect of importing `src/index.ts`.
 *
 * @module
 */

import type { RunnerId, TestRuntime } from '../runtime.js';

const registry = new Map<RunnerId, TestRuntime>();

/** Register (or replace) a runner. */
export function registerRunner(runner: TestRuntime): void {
  registry.set(runner.id, runner);
}

/** Look up a runner by ID. */
export function getRunner(id: RunnerId): TestRuntime | undefined {
  return registry.get(id);
}

/** Snapshot of all registered runners. */
export function listRunners(): TestRuntime[] {
  return Array.from(registry.values());
}
