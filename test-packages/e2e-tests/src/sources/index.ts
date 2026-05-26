/**
 * Test source exports for the e2e-tests harness.
 *
 * The directory-backed source is used by host-only tests; the Subsonic
 * (Navidrome) source is consumed by the `*.docker.e2e.test.ts` files and
 * pulls in the docker harness transitively.
 *
 * The TestSource / SourceAvailabilityResult interfaces live in
 * `@podkit/e2e-shared` so external implementations target the same contract.
 */

export type { TestSource, SourceAvailabilityResult } from '@podkit/e2e-shared';

export { DirectoryTestSource, createDirectorySource } from './directory.js';
export { SubsonicTestSource, isDockerAvailable } from './subsonic.js';
