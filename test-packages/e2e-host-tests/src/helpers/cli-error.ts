/**
 * Re-export of the canonical CLI error assertion helper from
 * `@podkit/e2e-shared`. Kept here so existing imports of
 * `'../helpers/cli-error'` continue to work without churning every test file.
 */

export { expectCliError, type CliErrorJson, type ExpectCliErrorMatch } from '@podkit/e2e-shared';
