/**
 * Generator for the multi-format audio fixture set.
 *
 * Produces 8 short (5s) audio files covering every codec podkit accepts as
 * input, with deterministic metadata so collection-source tests can assert
 * exact `title` / `artist` / `album` values.
 *
 * The set is split across three categorical albums:
 *
 *   - **Lossless Collection** (WAV, AIFF, FLAC, ALAC) — losslessly converted
 *     to any target format.
 *   - **Compatible Lossy** (MP3, AAC/M4A) — already iPod-playable, copied
 *     as-is by the sync pipeline.
 *   - **Incompatible Lossy** (OGG Vorbis, Opus) — must be transcoded; tests
 *     verify the lossy-to-lossy warning fires.
 *
 * Each track carries a unique sine frequency so listeners can audibly
 * distinguish them when manually inspecting a generated collection.
 *
 * @module
 */
import { join } from 'node:path';
import { requireEncoder } from '../encoder-guard.js';
import { ensureDir, metadataArgs, runFfmpeg, writeGeneratedSentinel } from './shared.js';

const COMMON = {
  artist: 'Multi-Format Test',
  date: '2026',
  genre: 'Electronic',
} as const;

/**
 * One track in the multi-format set. Hoisted to a type so the generator
 * loop and the README docs share a single source of truth.
 */
interface MultiFormatTrack {
  filename: string;
  title: string;
  album: 'Lossless Collection' | 'Compatible Lossy' | 'Incompatible Lossy';
  track: number;
  frequency: number;
  /** ffmpeg encoder name (passed to `-c:a`). */
  encoder: string;
  /** Sample rate. Opus is forced to 48 kHz because libopus rejects 44.1k. */
  sampleRate: number;
  /** Extra ffmpeg args specific to this codec (bitrate, quality flags). */
  extraArgs: readonly string[];
}

const TRACKS: readonly MultiFormatTrack[] = [
  {
    filename: '01-wav-track.wav',
    title: 'WAV Test Track',
    album: 'Lossless Collection',
    track: 1,
    frequency: 440,
    encoder: 'pcm_s16le',
    sampleRate: 44100,
    extraArgs: [],
  },
  {
    filename: '02-aiff-track.aiff',
    title: 'AIFF Test Track',
    album: 'Lossless Collection',
    track: 2,
    frequency: 523.25,
    encoder: 'pcm_s16be',
    sampleRate: 44100,
    extraArgs: [],
  },
  {
    filename: '03-flac-track.flac',
    title: 'FLAC Test Track',
    album: 'Lossless Collection',
    track: 3,
    frequency: 659.25,
    encoder: 'flac',
    sampleRate: 44100,
    extraArgs: [],
  },
  {
    filename: '04-alac-track.m4a',
    title: 'ALAC Test Track',
    album: 'Lossless Collection',
    track: 4,
    frequency: 783.99,
    encoder: 'alac',
    sampleRate: 44100,
    extraArgs: [],
  },
  {
    filename: '05-mp3-track.mp3',
    title: 'MP3 Test Track',
    album: 'Compatible Lossy',
    track: 1,
    frequency: 329.63,
    encoder: 'libmp3lame',
    sampleRate: 44100,
    extraArgs: ['-q:a', '0'],
  },
  {
    filename: '06-aac-track.m4a',
    title: 'AAC Test Track',
    album: 'Compatible Lossy',
    track: 2,
    frequency: 392,
    encoder: 'aac',
    sampleRate: 44100,
    extraArgs: ['-b:a', '256k'],
  },
  {
    filename: '07-ogg-track.ogg',
    title: 'OGG Test Track',
    album: 'Incompatible Lossy',
    track: 1,
    frequency: 493.88,
    encoder: 'libvorbis',
    sampleRate: 44100,
    extraArgs: ['-q:a', '7'],
  },
  {
    filename: '08-opus-track.opus',
    title: 'Opus Test Track',
    album: 'Incompatible Lossy',
    track: 2,
    frequency: 587.33,
    encoder: 'libopus',
    sampleRate: 48000,
    extraArgs: ['-b:a', '128k'],
  },
];

/**
 * Encoders required by this generator. Surfaced separately so the build-time
 * `check-ffmpeg.ts` and the runtime generator share the same list.
 */
export const REQUIRED_ENCODERS = [
  'pcm_s16le',
  'pcm_s16be',
  'flac',
  'alac',
  'libmp3lame',
  'aac',
  'libvorbis',
  'libopus',
] as const;

/**
 * Generate the full multi-format set into the given directory.
 *
 * Files are overwritten if present (ffmpeg runs with `-y`). All tracks are
 * 5 seconds long, stereo, deterministic.
 */
export async function generateMultiFormat(outputDir: string): Promise<void> {
  for (const encoder of REQUIRED_ENCODERS) {
    requireEncoder(encoder);
  }
  await ensureDir(outputDir);

  for (const track of TRACKS) {
    const outPath = join(outputDir, track.filename);
    await runFfmpeg([
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${track.frequency}:duration=5:sample_rate=${track.sampleRate}`,
      '-c:a',
      track.encoder,
      '-ar',
      String(track.sampleRate),
      '-ac',
      '2',
      ...track.extraArgs,
      ...metadataArgs({
        title: track.title,
        artist: COMMON.artist,
        album: track.album,
        track: track.track,
        date: COMMON.date,
        genre: COMMON.genre,
      }),
      outPath,
    ]);
  }

  await writeGeneratedSentinel(outputDir, 'multi-format');
}
