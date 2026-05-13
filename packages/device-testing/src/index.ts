/**
 * @podkit/device-testing — fixture registries + test runtime harness
 *
 * Provides:
 *
 * - `DevicePersona` schema and registry (`personas`)
 * - `SystemState` schema and registry (`systemStates`)
 * - `TestRuntime` interface + the `local-linux` runner
 * - Runner registry (`registerRunner` / `getRunner` / `listRunners`)
 * - `SubprocessRunner` interface + a default real-subprocess implementation
 *
 * Importing this module auto-registers the `local-linux` runner so consumers
 * do not need to wire it themselves.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

import { localLinuxRunner } from './runners/local-linux.js';
import { registerRunner } from './runners/registry.js';

// Personas
export type { DevicePersona, DoctorOutput } from './personas/types.js';
export { personas } from './personas/index.js';

// System states
export type { SystemState } from './system-states/types.js';
export {
  systemStates,
  healthy,
  noFfmpeg,
  noLibgpod,
  noUdev,
  noSgPerms,
  corruptConfigfs,
} from './system-states/index.js';

// Runtime
export type { RunnerId, RunOpts, RunResult, TestRuntime } from './runtime.js';

// Runners
export { localLinuxRunner } from './runners/local-linux.js';
export { registerRunner, getRunner, listRunners } from './runners/registry.js';

// Subprocess (capture + replay framework)
export type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
  SubprocessFixture,
} from './subprocess.js';
export {
  defaultSubprocessRunner,
  CapturingSubprocessRunner,
  ReplaySubprocessRunner,
  createSubprocessRunner,
  hashSubprocessCall,
} from './subprocess.js';

// Auto-register built-in runners on first import.
registerRunner(localLinuxRunner);
