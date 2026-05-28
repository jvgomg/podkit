/**
 * Shared matrix axes for the e2e sync-matrix harness.
 *
 * These are the typed variables the matrix tests cross-product over. Today
 * only the artwork concern consumes them; as the strategy in doc-039 lands,
 * new axes (device, transfer mode, codec config) join this file.
 *
 * @module
 */

import { SCENARIO_ARTISTS } from '@podkit/test-fixtures';

/**
 * Artwork-placement scenario. Maps 1:1 to the four `multi-format-*` fixture
 * variants: no art / embedded only / sidecar only / both.
 */
export type Scenario = 'A-none' | 'B-embedded' | 'C-sidecar' | 'D-both';

/** Audio source format (one track per format in each multi-format fixture). */
export type Format = 'wav' | 'aiff' | 'flac' | 'alac' | 'mp3' | 'aac' | 'ogg' | 'opus';

export const SCENARIOS: readonly Scenario[] = ['A-none', 'B-embedded', 'C-sidecar', 'D-both'];
export const FORMATS: readonly Format[] = [
  'wav',
  'aiff',
  'flac',
  'alac',
  'mp3',
  'aac',
  'ogg',
  'opus',
];

/**
 * Artist tag per scenario. Each multi-format variant stamps a distinct artist
 * so the `operations[].track` strings in sync output (which embed the artist)
 * disambiguate which scenario a track came from.
 */
export const SCENARIO_ARTIST: Record<Scenario, string> = {
  'A-none': SCENARIO_ARTISTS.none,
  'B-embedded': SCENARIO_ARTISTS.embedded,
  'C-sidecar': SCENARIO_ARTISTS.sidecar,
  'D-both': SCENARIO_ARTISTS.both,
};

/** Title tag per format. */
export const FORMAT_TITLE: Record<Format, string> = {
  wav: 'WAV Test Track',
  aiff: 'AIFF Test Track',
  flac: 'FLAC Test Track',
  alac: 'ALAC Test Track',
  mp3: 'MP3 Test Track',
  aac: 'AAC Test Track',
  ogg: 'OGG Test Track',
  opus: 'Opus Test Track',
};

/**
 * The track-matching key podkit emits in `operations[].track` and that the
 * device exposes as `artist` + ` - ` + `title`.
 */
export function trackId(artist: string, title: string): string {
  return `${artist} - ${title}`;
}

/** A single (scenario, format) cell of the static artwork matrix. */
export interface ScenarioFormatCell {
  scenario: Scenario;
  format: Format;
}

/** Materialise the full scenario × format product (32 cells). */
export function scenarioFormatCells(): ScenarioFormatCell[] {
  const cells: ScenarioFormatCell[] = [];
  for (const scenario of SCENARIOS) {
    for (const format of FORMATS) {
      cells.push({ scenario, format });
    }
  }
  return cells;
}
