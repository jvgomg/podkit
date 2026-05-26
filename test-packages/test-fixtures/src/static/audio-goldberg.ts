/**
 * Generator for the goldberg-selections fixture set.
 *
 * Three 20-second mono FLAC files that share an album cover, used by tests
 * that exercise multi-track album semantics (artwork dedup, album grouping,
 * track ordering).
 *
 * Despite the name, the audio content is *not* Bach — the directory takes its
 * name from an earlier intent to ship real Bach recordings. The shipped
 * content is synthetic and CC0; each track is named after the synthesis
 * technique used so the contents are self-documenting:
 *
 *   - **01-harmony.flac** — three sines mixed at C major triad pitches.
 *   - **02-vibrato.flac** — 440 Hz sine modulated by the `vibrato` filter.
 *   - **03-tremolo.flac** — 440 Hz sine modulated by the `tremolo` filter.
 *
 * All three FLACs embed a 500x500 solid blue cover image as `attached_pic`
 * and the album also ships a standalone `cover.jpg` sidecar.
 *
 * @module
 */

import { join } from 'node:path';
import { requireEncoder } from '../encoder-guard.js';
import {
  ensureDir,
  generateCoverJpeg,
  metadataArgs,
  runFfmpeg,
  writeGeneratedSentinel,
} from './shared.js';

const COMMON = {
  artist: 'Podkit Test Generator',
  album: 'Synthetic Classics',
  date: '2026',
  genre: 'Electronic',
} as const;

/** Solid blue, matching the existing committed cover.jpg colour palette. */
const COVER_COLOR = '#4a90d9';

const DURATION_SECONDS = 20;
const SAMPLE_RATE = 44100;

/**
 * Recipe for one goldberg-selections track. The `filter` field is the ffmpeg
 * `-filter_complex` graph that produces the mono PCM stream tagged `[a]`.
 */
interface GoldbergTrack {
  filename: string;
  title: string;
  track: number;
  /** ffmpeg lavfi filter graph producing a `[a]` output. */
  filter: string;
}

const TRACKS: readonly GoldbergTrack[] = [
  {
    filename: '01-harmony.flac',
    title: 'Harmony',
    track: 1,
    // C major triad: C4 (261.63), E4 (329.63), G4 (392). Mix at equal weights.
    filter:
      `sine=frequency=261.63:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[c];` +
      `sine=frequency=329.63:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[e];` +
      `sine=frequency=392:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[g];` +
      `[c][e][g]amix=inputs=3:duration=longest:normalize=0[a]`,
  },
  {
    filename: '02-vibrato.flac',
    title: 'Vibrato',
    track: 2,
    filter:
      `sine=frequency=440:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE},` +
      `vibrato=f=5:d=0.5[a]`,
  },
  {
    filename: '03-tremolo.flac',
    title: 'Tremolo',
    track: 3,
    filter:
      `sine=frequency=440:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE},` +
      `tremolo=f=4:d=0.6[a]`,
  },
];

/**
 * Generate the goldberg-selections set into the given directory.
 *
 * Produces three FLAC files plus a standalone `cover.jpg` sidecar. The cover
 * is also embedded into each FLAC's attached_pic stream so tests can exercise
 * both embedded and sidecar artwork paths.
 */
export async function generateGoldberg(outputDir: string): Promise<void> {
  requireEncoder('flac');
  requireEncoder('mjpeg');

  await ensureDir(outputDir);

  const coverPath = join(outputDir, 'cover.jpg');
  await generateCoverJpeg(coverPath, COVER_COLOR);

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    // The cover image is `-i` input 0. The `[a]` label comes from the
    // filter_complex; filter sources (`sine`, `aevalsrc`) do not consume an
    // `-i` slot, so the cover stream is still `0:v`.
    await runFfmpeg([
      '-i',
      coverPath,
      '-filter_complex',
      track.filter,
      '-map',
      '[a]',
      '-map',
      '0:v',
      '-c:a',
      'flac',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-c:v',
      'mjpeg',
      '-disposition:v',
      'attached_pic',
      ...metadataArgs({
        title: track.title,
        artist: COMMON.artist,
        album: COMMON.album,
        track: track.track,
        date: COMMON.date,
        genre: COMMON.genre,
      }),
      outPath,
    ]);
  }

  await writeGeneratedSentinel(outputDir, 'goldberg-selections');
}
