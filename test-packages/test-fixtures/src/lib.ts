/**
 * @podkit/test-fixtures library entry.
 *
 * Two flavours of fixtures are exposed:
 *
 *   1. **Static fixture sets** — pre-defined audio + video files produced by
 *      the generators in `./static/`. Use `getMultiFormatFixturesDir()` &c
 *      to locate them at test time, and call `ensureFixturesExist(set)` at
 *      module load to fail fast with an actionable message if the set has
 *      not been generated yet. Turbo runs `generate-static-fixtures` as a
 *      dependency of `test:integration`, so under normal flows the sets are
 *      present before tests start.
 *
 *   2. **Dynamic mini-track helpers** — small one-off audio files synthesised
 *      on demand from inside a test (e.g. when a test needs a FLAC with a
 *      specific tag set that doesn't fit any static fixture).
 *
 * Runnable scripts live under `scripts/` — `generate-fixtures.ts` for the
 * dynamic generator CLI and `generate-static-fixtures.ts` for the static
 * sets — and both import from this lib entry, so this file is the single
 * source of truth for the public surface.
 */

export {
  generateMiniFlac,
  generateMiniM4a,
  generateMiniMp3,
  generateMiniOggOpus,
  generateMiniOggVorbis,
  type MiniTrackOptions,
} from './mini-tracks.js';

export {
  ensureFixturesExist,
  generateAllStaticFixtures,
  generateGoldberg,
  generateMultiFormat,
  generateSyntheticTests,
  generateVideo,
  getGoldbergFixturesDir,
  getMultiFormatFixturesDir,
  getStaticFixturesRoot,
  getSyntheticTestsFixturesDir,
  getVideoFixturesDir,
  STATIC_FIXTURE_GENERATORS,
  type StaticFixtureSet,
} from './static/index.js';

export { requireBinary } from './require-binary.js';
