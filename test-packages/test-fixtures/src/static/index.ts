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
  generateMultiFormatEmbeddedStripped,
  generateMultiFormatEmbeddedHires,
  generateMultiFormatCompilation,
  generateMultiFormatSidecar,
  generateMultiFormatBoth,
  compilationArtist,
  compilationTrackEmbeds,
  compilationCoverColor,
  COMPILATION_ALBUM,
  COMPILATION_ALBUM_ARTIST,
  HIRES_ARTIST,
  HIRES_COVER_SIZE,
  MULTI_FORMAT_DEFAULT_COVER_SIZE,
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
  getMultiFormatEmbeddedStrippedFixturesDir,
  getMultiFormatEmbeddedHiresFixturesDir,
  getMultiFormatCompilationFixturesDir,
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
  generateMultiFormatCompilation,
  generateMultiFormatEmbedded,
  generateMultiFormatEmbeddedAlt,
  generateMultiFormatEmbeddedHires,
  generateMultiFormatEmbeddedStripped,
  generateMultiFormatSidecar,
} from './audio-multi-format.js';
import { generateSyntheticTests } from './audio-synthetic-tests.js';
import {
  getGoldbergFixturesDir,
  getMultiFormatBothFixturesDir,
  getMultiFormatCompilationFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedHiresFixturesDir,
  getMultiFormatEmbeddedStrippedFixturesDir,
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
    generateMultiFormatEmbeddedStripped(getMultiFormatEmbeddedStrippedFixturesDir()),
    generateMultiFormatEmbeddedHires(getMultiFormatEmbeddedHiresFixturesDir()),
    generateMultiFormatCompilation(getMultiFormatCompilationFixturesDir()),
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
  'multi-format-embedded-stripped': () =>
    generateMultiFormatEmbeddedStripped(getMultiFormatEmbeddedStrippedFixturesDir()),
  'multi-format-embedded-hires': () =>
    generateMultiFormatEmbeddedHires(getMultiFormatEmbeddedHiresFixturesDir()),
  'multi-format-compilation': () =>
    generateMultiFormatCompilation(getMultiFormatCompilationFixturesDir()),
  'multi-format-sidecar': () => generateMultiFormatSidecar(getMultiFormatSidecarFixturesDir()),
  'multi-format-both': () => generateMultiFormatBoth(getMultiFormatBothFixturesDir()),
  'goldberg-selections': () => generateGoldberg(getGoldbergFixturesDir()),
  'synthetic-tests': () => generateSyntheticTests(getSyntheticTestsFixturesDir()),
  video: () => generateVideo(getVideoFixturesDir()),
};
