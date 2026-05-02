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

// Path to the test MP3 file in libgpod source. The fixture itself is asserted
// to exist by `test/integration-preflight.ts`; this just exports the path.
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
