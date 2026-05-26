/**
 * CLI runner re-exports + host-specific config helpers.
 *
 * The generic runner (`runCli`, `runCliJson`, config temp-file helpers) lives
 * in `@podkit/e2e-shared`. This file re-exports it for back-compat with the
 * many test files that already import from `../helpers/cli-runner` and adds
 * the docker-specific Subsonic helper that depends on the Docker harness.
 *
 * The Subsonic helper moves to `@podkit/e2e-docker-tests` when the docker
 * suite is extracted; until then it lives here so the import sites that need
 * it don't have to know about a package that doesn't exist yet.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * Create a temporary config file for a Subsonic music collection.
 *
 * Docker-specific: only meaningful next to the e2e Subsonic harness which
 * starts a Navidrome container. Will move into `@podkit/e2e-docker-tests`.
 *
 * @example
 * ```ts
 * const configPath = await createSubsonicConfig('http://localhost:4533', 'admin');
 * const result = await runCli(['--config', configPath, 'sync'], {
 *   env: { SUBSONIC_PASSWORD: 'testpass' }
 * });
 * ```
 */
export async function createSubsonicConfig(serverUrl: string, username: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'podkit-subsonic-config-'));
  const configPath = join(tempDir, 'config.toml');

  const content = `version = 2

[music.main]
type = "subsonic"
url = "${serverUrl}"
username = "${username}"

[defaults]
music = "main"
`;

  await writeFile(configPath, content);
  return configPath;
}
