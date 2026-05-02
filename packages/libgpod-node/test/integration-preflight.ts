/**
 * Preloaded by bunfig.toml for libgpod-node integration tests.
 * Needs gpod-tool, the native binding, and the libgpod test MP3 fixture.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireGpodTool, failMissingDep } from '@podkit/gpod-testing';
import { isNativeAvailable } from '../src/index';

requireGpodTool();
if (!isNativeAvailable()) {
  failMissingDep(
    'libgpod-node native bindings',
    'Build the native bindings:\n     bun run build:native'
  );
}

// Tiny in-repo MP3 fixture (~1.4KB) used by tests that copy audio onto a
// virtual iPod. Tracked in git — must be present for integration runs.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MP3_PATH = join(__dirname, 'fixtures', 'tiny.mp3');
if (!existsSync(TEST_MP3_PATH)) {
  failMissingDep(
    'tiny test MP3 fixture',
    `Expected at:\n     ${TEST_MP3_PATH}\n\n Restore via:\n     git checkout HEAD -- ${TEST_MP3_PATH}`
  );
}
