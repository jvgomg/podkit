/**
 * Common test setup and utilities for libgpod-node integration tests.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-export gpod-testing utilities
export {
  withTestIpod,
  isGpodToolAvailable,
} from '@podkit/gpod-testing';

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
} from '../../index';

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
