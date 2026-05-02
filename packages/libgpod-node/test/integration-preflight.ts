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

// The libgpod source ships a tiny MP3 used by tests that copy audio onto an
// iPod. It lives under tools/libgpod-macos/build (gitignored — produced by
// the libgpod build script).
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MP3_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'tools',
  'libgpod-macos',
  'build',
  'libgpod-0.8.3',
  'bindings',
  'python',
  'tests',
  'resources',
  'tiny.mp3'
);
if (!existsSync(TEST_MP3_PATH)) {
  failMissingDep(
    'libgpod test MP3 fixture',
    `Expected at:\n     ${TEST_MP3_PATH}\n\n Build libgpod (which extracts the fixture):\n     cd tools/libgpod-macos && ./build.sh`
  );
}
