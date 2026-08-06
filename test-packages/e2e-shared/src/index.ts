/**
 * @podkit/e2e-shared — cross-cutting helpers for end-to-end test packages.
 *
 * Consumed by `@podkit/e2e-tests` and potentially `@podkit/e2e-vm-tests`.
 * Owns generic CLI runner, CLI error assertion helper, and composable
 * preflight checks; package-specific helpers (Subsonic config, docker
 * container lifecycle, real-iPod filesystem probes) belong with the package
 * that knows their context.
 *
 * @module
 */

export {
  cleanupTempConfig,
  createTempConfig,
  getCliPath,
  CLI_BINARY_ENV,
  isCliAvailable,
  runCli,
  runCliJson,
  type CliBinary,
  type CliJsonResult,
  type CliOptions,
  type CliResult,
} from './cli-runner.js';

export { expectCliError, type CliErrorJson, type ExpectCliErrorMatch } from './cli-error.js';

// Re-exported from @podkit/test-fixtures so the e2e-shared entry stays a
// one-stop import for e2e harnesses.
export {
  ensureFixturesExist,
  requireBinary,
  requireFFmpeg,
  requireFfprobe,
  requireGpodTool,
  requireMetaflac,
  type StaticFixtureSet,
} from '@podkit/test-fixtures';

export {
  checkCliBuilt,
  checkFfmpeg,
  checkFixtureSet,
  checkGpodTool,
  checkMetaflac,
  checkMountExists,
  checkWritePermissions,
  printResults,
  runPreflightChecks,
  type CheckResult,
  type PreflightCheck,
} from './preflight.js';

export { type SourceAvailabilityResult, type TestSource } from './test-source.js';
