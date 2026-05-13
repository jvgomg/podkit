/**
 * @podkit/test-fixtures library entry.
 *
 * Re-exports the fixture-generation helpers that consumers (integration
 * tests, e2e helpers) can import directly. The CLI entry lives at
 * `src/index.ts` and is used by `bun run generate-fixtures`.
 */

export {
  generateMiniFlac,
  generateMiniM4a,
  generateMiniMp3,
  generateMiniOggOpus,
  generateMiniOggVorbis,
  type MiniTrackOptions,
} from './mini-tracks.js';
