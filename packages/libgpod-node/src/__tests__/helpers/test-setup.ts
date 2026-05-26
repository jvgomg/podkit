/**
 * Common test setup and utilities for libgpod-node integration tests.
 *
 * Importing this module fails loudly if any of the required dependencies
 * are missing or broken:
 *
 *   - native libgpod-node bindings (must dlopen cleanly)
 *   - gpod-tool on `$PATH` (used by `@podkit/gpod-testing` to mint iPod fixtures)
 *   - the tiny.mp3 fixture committed under `test/fixtures/`
 *
 * Every `*.integration.test.ts` in this package imports from here, so the
 * preflight runs once per process even though each test file owns its own
 * top-of-module side effects.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireGpodTool } from '@podkit/test-fixtures';
import { requireLibgpodNode } from '../../preflight.js';

requireLibgpodNode();
requireGpodTool();

// Re-export gpod-testing utilities
export { withTestIpod } from '@podkit/gpod-testing';

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

// Tiny tracked MP3 fixture (~1.4KB). Originally extracted from the libgpod
// python bindings test resources; kept in-repo so Linux test runs don't need
// the macOS libgpod build artifacts. Verified to exist at module load — if
// someone accidentally removes it, tests fail fast with a focused error here
// rather than deep inside a Database call.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEST_MP3_PATH = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'tiny.mp3');

if (!existsSync(TEST_MP3_PATH)) {
  throw new Error(
    `tiny test MP3 fixture missing at:\n  ${TEST_MP3_PATH}\n\n` +
      `Restore it from git:\n  git checkout HEAD -- ${TEST_MP3_PATH}`
  );
}
