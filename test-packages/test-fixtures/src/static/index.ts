/**
 * Static fixture generators barrel.
 *
 * Re-exports the generator entry points plus the path/preflight helpers
 * so consumers can import everything from `@podkit/test-fixtures` without
 * reaching into `static/` paths.
 *
 * @module
 */

export {
  generateMultiFormat,
  generateMultiFormatEmbedded,
  generateMultiFormatEmbeddedAlt,
  generateMultiFormatSidecar,
  generateMultiFormatBoth,
  SCENARIO_ARTISTS,
} from './audio-multi-format.js';
export { generateGoldberg } from './audio-goldberg.js';
export { generateSyntheticTests } from './audio-synthetic-tests.js';
export { generateVideo } from './video.js';

export {
  ensureFixturesExist,
  getGoldbergFixturesDir,
  getMultiFormatFixturesDir,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
  getMultiFormatSidecarFixturesDir,
  getMultiFormatBothFixturesDir,
  getStaticFixturesRoot,
  getSyntheticTestsFixturesDir,
  getVideoFixturesDir,
  type StaticFixtureSet,
} from './paths.js';

import { generateGoldberg } from './audio-goldberg.js';
import {
  generateMultiFormat,
  generateMultiFormatBoth,
  generateMultiFormatEmbedded,
  generateMultiFormatEmbeddedAlt,
  generateMultiFormatSidecar,
} from './audio-multi-format.js';
import { generateSyntheticTests } from './audio-synthetic-tests.js';
import {
  getGoldbergFixturesDir,
  getMultiFormatBothFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatFixturesDir,
  getMultiFormatSidecarFixturesDir,
  getSyntheticTestsFixturesDir,
  getVideoFixturesDir,
  type StaticFixtureSet,
} from './paths.js';
import { generateVideo } from './video.js';

/**
 * Run every static fixture generator into the package-owned `fixtures/`
 * directory. Sets are generated in parallel — each writes to its own
 * subdirectory, so there is no contention.
 */
export async function generateAllStaticFixtures(): Promise<void> {
  await Promise.all([
    generateMultiFormat(getMultiFormatFixturesDir()),
    generateMultiFormatEmbedded(getMultiFormatEmbeddedFixturesDir()),
    generateMultiFormatEmbeddedAlt(getMultiFormatEmbeddedAltFixturesDir()),
    generateMultiFormatSidecar(getMultiFormatSidecarFixturesDir()),
    generateMultiFormatBoth(getMultiFormatBothFixturesDir()),
    generateGoldberg(getGoldbergFixturesDir()),
    generateSyntheticTests(getSyntheticTestsFixturesDir()),
    generateVideo(getVideoFixturesDir()),
  ]);
}

/**
 * Map from set name (as accepted by `--only`) to the generator function.
 *
 * Exported so the CLI script can dispatch and so future tooling (e.g. a
 * `regenerate-fixture` mise task) can target a single set without
 * re-implementing the dispatch logic.
 */
export const STATIC_FIXTURE_GENERATORS: Record<StaticFixtureSet, () => Promise<void>> = {
  'multi-format': () => generateMultiFormat(getMultiFormatFixturesDir()),
  'multi-format-embedded': () => generateMultiFormatEmbedded(getMultiFormatEmbeddedFixturesDir()),
  'multi-format-embedded-alt': () =>
    generateMultiFormatEmbeddedAlt(getMultiFormatEmbeddedAltFixturesDir()),
  'multi-format-sidecar': () => generateMultiFormatSidecar(getMultiFormatSidecarFixturesDir()),
  'multi-format-both': () => generateMultiFormatBoth(getMultiFormatBothFixturesDir()),
  'goldberg-selections': () => generateGoldberg(getGoldbergFixturesDir()),
  'synthetic-tests': () => generateSyntheticTests(getSyntheticTestsFixturesDir()),
  video: () => generateVideo(getVideoFixturesDir()),
};
