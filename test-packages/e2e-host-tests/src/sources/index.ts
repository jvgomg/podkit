/**
 * Test source exports for the e2e-host-tests harness.
 *
 * Only the directory-backed source lives here; the Subsonic source and the
 * Docker harness that backs it moved to `@podkit/e2e-docker-tests` so the
 * host-side tests don't pay the cost of a Docker dependency.
 *
 * The TestSource / SourceAvailabilityResult interfaces live in
 * `@podkit/e2e-shared` so both packages implement against the same contract.
 */

export type { TestSource, SourceAvailabilityResult } from '@podkit/e2e-shared';

export { DirectoryTestSource, createDirectorySource } from './directory.js';
