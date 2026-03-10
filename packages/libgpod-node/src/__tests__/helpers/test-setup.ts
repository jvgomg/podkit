/**
 * Common test setup and utilities for libgpod-node integration tests.
 *
 * Integration tests require native bindings and test fixtures to be available.
 * If prerequisites are missing, tests will fail immediately with a clear
 * error message.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-export gpod-testing utilities
export { withTestIpod, isGpodToolAvailable } from '@podkit/gpod-testing';

// Re-export library exports
export {
  Database,
  PhotoDatabase,
  isNativeAvailable,
  starsToRating,
  ratingToStars,
  formatDuration,
  ipodPathToFilePath,
  filePathToIpodPath,
  MediaType,
  LibgpodError,
  PhotoAlbumType,
  PhotoTransitionDirection,
  type TrackHandle,
} from '../../index';

import { isNativeAvailable } from '../../index';

/**
 * Assert that native bindings are available.
 *
 * This check runs at module load time. If native bindings are not built,
 * the test suite will fail immediately with a clear error message rather
 * than showing many skipped tests.
 */
function requireNativeBinding(): void {
  if (!isNativeAvailable()) {
    throw new Error(
      '\n\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ' Native bindings not available!\n' +
        '═══════════════════════════════════════════════════════════════════\n\n' +
        ' Integration tests require native bindings to be built.\n\n' +
        ' Run the following command to build them:\n\n' +
        '     bun run build:native\n\n' +
        ' Or from the repository root:\n\n' +
        '     bun run build\n\n' +
        '═══════════════════════════════════════════════════════════════════\n'
    );
  }
}

// Fail early if native bindings are not available
requireNativeBinding();

// Path to the test MP3 file in libgpod source
const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEST_MP3_PATH = join(
  __dirname,
  '..',
  '..',
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

/**
 * Assert that the test MP3 file is available.
 *
 * This file is part of the libgpod source and is needed for tests that
 * copy audio files to the iPod. It should exist after building libgpod.
 */
function requireTestMp3(): void {
  if (!existsSync(TEST_MP3_PATH)) {
    throw new Error(
      '\n\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ' Test MP3 file not found!\n' +
        '═══════════════════════════════════════════════════════════════════\n\n' +
        ' Integration tests require a test MP3 file from the libgpod source.\n\n' +
        ' Expected location:\n' +
        `     ${TEST_MP3_PATH}\n\n` +
        ' This file should exist after building libgpod. Try:\n\n' +
        '     cd tools/libgpod-macos && ./build.sh\n\n' +
        '═══════════════════════════════════════════════════════════════════\n'
    );
  }
}

// Fail early if test MP3 is not available
requireTestMp3();
