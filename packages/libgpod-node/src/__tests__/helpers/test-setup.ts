/**
 * Common test setup and utilities for libgpod-node integration tests.
 *
 * Dependency presence checks (native bindings, gpod-tool, test MP3 fixture)
 * live in `test/integration-preflight.ts` and run via the bunfig preload.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// the macOS libgpod build artifacts.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEST_MP3_PATH = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'tiny.mp3');
