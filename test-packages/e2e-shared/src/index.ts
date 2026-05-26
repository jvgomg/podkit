/**
 * @podkit/e2e-shared — cross-cutting helpers for end-to-end test packages.
 *
 * Consumed by `@podkit/e2e-host-tests`, `@podkit/e2e-docker-tests`, and
 * potentially `@podkit/e2e-vm-tests`. Owns generic CLI runner, CLI error
 * assertion helper, and composable preflight checks; package-specific
 * helpers (Subsonic config, docker container lifecycle, real-iPod
 * filesystem probes) belong with the package that knows their context.
 *
 * @module
 */

export {
  cleanupTempConfig,
  createTempConfig,
  getCliPath,
  isCliAvailable,
  runCli,
  runCliJson,
  type CliJsonResult,
  type CliOptions,
  type CliResult,
} from './cli-runner.js';

export { expectCliError, type CliErrorJson, type ExpectCliErrorMatch } from './cli-error.js';

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
