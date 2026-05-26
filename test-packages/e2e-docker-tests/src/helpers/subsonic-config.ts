/**
 * Subsonic-specific config helper.
 *
 * Lives next to the Docker harness because Subsonic configs only make sense
 * paired with a Navidrome container started via {@link SubsonicTestSource}.
 * The generic directory-source config helpers live in `@podkit/e2e-shared`.
 *
 * @module
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create a temporary podkit config that points at a Subsonic server.
 *
 * @param serverUrl - Subsonic server URL (e.g. `http://localhost:4533`).
 * @param username  - Subsonic username (the password comes from the
 *                    `SUBSONIC_PASSWORD` environment variable when the CLI
 *                    invokes the source).
 * @returns Absolute path to the generated `config.toml`. Caller should pass
 *          it to `cleanupTempConfig` when the test ends.
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
