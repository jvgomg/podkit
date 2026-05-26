/**
 * CLI runner re-exports for the e2e-host-tests harness.
 *
 * The generic runner (`runCli`, `runCliJson`, directory-source config
 * helpers) lives in `@podkit/e2e-shared`. This file re-exports the surface
 * for back-compat with test files that already import from
 * `../helpers/cli-runner`. Subsonic-specific config + docker container
 * lifecycle live in `@podkit/e2e-docker-tests`.
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
} from '@podkit/e2e-shared';
