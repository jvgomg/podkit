/**
 * CLI runner re-exports for the e2e-tests harness.
 *
 * The generic runner (`runCli`, `runCliJson`, directory-source config
 * helpers) lives in `@podkit/e2e-shared`. This file re-exports the surface
 * for back-compat with test files that already import from
 * `../helpers/cli-runner`. Subsonic-specific config lives next to the
 * docker harness in `./subsonic-config.ts`.
 */

export {
  cleanupTempConfig,
  createTempConfig,
  getCliPath,
  cliSpawnArgv,
  isCliAvailable,
  runCli,
  runCliJson,
  type CliJsonResult,
  type CliOptions,
  type CliResult,
} from '@podkit/e2e-shared';
