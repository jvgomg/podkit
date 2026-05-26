/**
 * Generator for the synthetic-tests fixture set.
 *
 * Three 15-second mono FLAC files designed to exercise edge cases tests
 * care about that the goldberg set does not cover:
 *
 *   - **01-a440.flac** — pure 440 Hz reference tone. Sanity-check baseline.
 *   - **02-sweep.flac** — linear frequency sweep 220→820 Hz. Tests that
 *     analysis code copes with non-stationary spectral content.
 *   - **03-dual-tone.flac** — 440 Hz + 880 Hz mixed (musical octave). Has
 *     **no embedded artwork**, so tests of "track without artwork" semantics
 *     have a stable fixture they can reach for.
 *
 * 01 and 02 embed the album cover as `attached_pic`; 03 does not. The album
 * also ships a standalone `cover.jpg` sidecar.
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
  album: 'Test Tones',
  date: '2026',
  genre: 'Electronic',
} as const;

/** Solid red to visually distinguish from the goldberg album in fixture listings. */
const COVER_COLOR = '#d94a4a';

const DURATION_SECONDS = 15;
const SAMPLE_RATE = 44100;

/**
 * Recipe for one synthetic-tests track. `embedCover` toggles whether the
 * generated FLAC carries an `attached_pic` stream — `03-dual-tone.flac`
 * intentionally omits it.
 */
interface SyntheticTrack {
  filename: string;
  title: string;
  track: number;
  filter: string;
  embedCover: boolean;
}

const TRACKS: readonly SyntheticTrack[] = [
  {
    filename: '01-a440.flac',
    title: 'A440 Reference',
    track: 1,
    filter: `sine=frequency=440:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[a]`,
    embedCover: true,
  },
  {
    filename: '02-sweep.flac',
    title: 'Frequency Sweep',
    track: 2,
    // Linear sweep from 220 Hz to 820 Hz over the duration. `aevalsrc` lets us
    // use a time-varying expression for the instantaneous frequency.
    filter:
      `aevalsrc=exprs='sin(2*PI*(220*t + 20*t*t))':` +
      `duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[a]`,
    embedCover: true,
  },
  {
    filename: '03-dual-tone.flac',
    title: 'Dual Tone',
    track: 3,
    // Musical octave: 440 Hz + 880 Hz mixed at equal weights.
    filter:
      `sine=frequency=440:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[lo];` +
      `sine=frequency=880:duration=${DURATION_SECONDS}:sample_rate=${SAMPLE_RATE}[hi];` +
      `[lo][hi]amix=inputs=2:duration=longest:normalize=0[a]`,
    embedCover: false,
  },
];

/**
 * Generate the synthetic-tests set into the given directory.
 *
 * Produces three FLAC files plus a standalone `cover.jpg` sidecar. Track 3
 * is intentionally artwork-free so it can serve as the "no embedded artwork"
 * fixture for tests that distinguish the two cases.
 */
export async function generateSyntheticTests(outputDir: string): Promise<void> {
  requireEncoder('flac');
  requireEncoder('mjpeg');

  await ensureDir(outputDir);

  const coverPath = join(outputDir, 'cover.jpg');
  await generateCoverJpeg(coverPath, COVER_COLOR);

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    // Cover image (when present) is `-i` input 0. filter_complex sources do
    // not consume `-i` slots, so the cover stream is `0:v` even though the
    // `[a]` label appears earlier in the argv.
    const args: string[] = [];

    if (track.embedCover) {
      args.push('-i', coverPath);
    }
    args.push('-filter_complex', track.filter, '-map', '[a]');
    if (track.embedCover) {
      args.push('-map', '0:v');
    }

    args.push('-c:a', 'flac', '-ar', String(SAMPLE_RATE), '-ac', '1');

    if (track.embedCover) {
      args.push('-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    }

    args.push(
      ...metadataArgs({
        title: track.title,
        artist: COMMON.artist,
        album: COMMON.album,
        track: track.track,
        date: COMMON.date,
        genre: COMMON.genre,
      }),
      outPath
    );

    await runFfmpeg(args);
  }

  await writeGeneratedSentinel(outputDir, 'synthetic-tests');
}
