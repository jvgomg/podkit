/**
 * Test source exports
 *
 * Provides source abstractions for E2E testing with different
 * music sources (directory, Subsonic, etc.)
 */

export type { TestSource, SourceAvailabilityResult } from './types.js';

export { DirectoryTestSource, createDirectorySource } from './directory.js';

export { SubsonicTestSource, createSubsonicSource, isDockerAvailable } from './subsonic.js';
