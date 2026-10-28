/**
 * Synthetic minimal-duration audio tracks for integration tests.
 *
 * Each generator produces a single short sine-tone file in the requested
 * codec/container, with optional metadata. Designed for tests that
 * round-trip tags through real audio files (e.g. the mass-storage tag
 * writer) but do not need realistic music content.
 *
 * Requires ffmpeg with libvorbis, libopus, libmp3lame, aac, and flac
 * encoders. The package's `build` script verifies this via
 * `scripts/check-ffmpeg.ts`, so importing these helpers from a built
 * `@podkit/test-fixtures` is safe at runtime.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireEncoder } from './encoder-guard.js';

/** Optional metadata fields. Defaults are deterministic test values. */
export interface MiniTrackOptions {
  /** Output filename inside `dir`. */
  filename: string;
  /** Title tag. Defaults to "Test Song". */
  title?: string;
  /** Artist tag. Defaults to "Test Artist". */
  artist?: string;
  /**
   * Comment tag (Vorbis Comment "COMMENT" / ID3v2 "COMM" / MP4 "©cmt").
   * Note: for FLAC and MP3, ffmpeg maps `-metadata comment` to the
   * wrong frame in some containers. Use the returned path and a tag
   * writer to set comments authoritatively when round-trip accuracy
   * matters.
   */
  comment?: string;
  /**
   * Further tags as ffmpeg `-metadata` key/value pairs, written as given
   * (e.g. `composer`, `grouping`, `TITLESORT`). Container mapping is ffmpeg's.
   */
  tags?: Record<string, string>;
  /** Duration in seconds. Defaults to 1. */
  durationSeconds?: number;
  /** Sine frequency in Hz. Defaults to 440. */
  frequencyHz?: number;
}

const DEFAULTS = {
  title: 'Test Song',
  artist: 'Test Artist',
  durationSeconds: 1,
  frequencyHz: 440,
} as const;

function metadataArgs(opts: MiniTrackOptions): string[] {
  const title = opts.title ?? DEFAULTS.title;
  const artist = opts.artist ?? DEFAULTS.artist;
  const args = ['-metadata', `title=${title}`, '-metadata', `artist=${artist}`];
  if (opts.comment !== undefined) {
    args.push('-metadata', `comment=${opts.comment}`);
  }
  for (const [key, value] of Object.entries(opts.tags ?? {})) {
    args.push('-metadata', `${key}=${value}`);
  }
  return args;
}

function sineInputArgs(opts: MiniTrackOptions, sampleRate: number): string[] {
  const duration = opts.durationSeconds ?? DEFAULTS.durationSeconds;
  const frequency = opts.frequencyHz ?? DEFAULTS.frequencyHz;
  return [
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${duration}:sample_rate=${sampleRate}`,
  ];
}

function runFfmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', ...args], { stdio: 'pipe' });
}

/** Generate a minimal FLAC file with the given metadata. */
export function generateMiniFlac(dir: string, opts: MiniTrackOptions): string {
  requireEncoder('flac');
  const outPath = join(dir, opts.filename);
  runFfmpeg([
    ...sineInputArgs(opts, 44100),
    '-c:a',
    'flac',
    '-ar',
    '44100',
    ...metadataArgs(opts),
    outPath,
  ]);
  return outPath;
}

/** Generate a minimal MP3 file with the given metadata. */
export function generateMiniMp3(dir: string, opts: MiniTrackOptions): string {
  requireEncoder('libmp3lame');
  const outPath = join(dir, opts.filename);
  runFfmpeg([
    ...sineInputArgs(opts, 44100),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    ...metadataArgs(opts),
    outPath,
  ]);
  return outPath;
}

/** Generate a minimal M4A (AAC-in-MP4) file with the given metadata. */
export function generateMiniM4a(dir: string, opts: MiniTrackOptions): string {
  requireEncoder('aac');
  const outPath = join(dir, opts.filename);
  runFfmpeg([
    ...sineInputArgs(opts, 44100),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    ...metadataArgs(opts),
    '-f',
    'ipod',
    outPath,
  ]);
  return outPath;
}

/** Generate a minimal OGG Vorbis file with the given metadata. */
export function generateMiniOggVorbis(dir: string, opts: MiniTrackOptions): string {
  requireEncoder('libvorbis');
  const outPath = join(dir, opts.filename);
  runFfmpeg([
    ...sineInputArgs(opts, 44100),
    '-c:a',
    'libvorbis',
    '-q:a',
    '4',
    ...metadataArgs(opts),
    outPath,
  ]);
  return outPath;
}

/** Generate a minimal Opus-in-OGG file with the given metadata. */
export function generateMiniOggOpus(dir: string, opts: MiniTrackOptions): string {
  requireEncoder('libopus');
  const outPath = join(dir, opts.filename);
  runFfmpeg([
    ...sineInputArgs(opts, 48000),
    '-c:a',
    'libopus',
    '-b:a',
    '64k',
    ...metadataArgs(opts),
    '-vn',
    outPath,
  ]);
  return outPath;
}

/**
 * Generate an MP3 carrying a hand-built ID3v2 tag (version 3 or 4) with
 * exactly the given text frames (UTF-16), in order. Taggers cannot produce
 * some real-world tags: iTunes writes the v2.4-only TSOT/TSOP/TSOA sort
 * frames and its GRP1 grouping frame into v2.3, which taglib and ffmpeg drop.
 */
export function generateMiniMp3WithId3Frames(
  dir: string,
  filename: string,
  frames: Array<[id: string, text: string]>,
  version: 3 | 4 = 3
): string {
  requireEncoder('libmp3lame');
  const outPath = join(dir, filename);
  runFfmpeg([
    ...sineInputArgs({ filename }, 44100),
    '-c:a',
    'libmp3lame',
    '-write_id3v2',
    '0',
    '-write_xing',
    '0',
    outPath,
  ]);
  // v2.4 frame sizes are synchsafe; v2.3 ones plain big-endian.
  const size = (n: number) =>
    version === 4
      ? Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
      : Buffer.from([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const content = Buffer.concat([
        Buffer.from([0x01, 0xff, 0xfe]),
        Buffer.from(text, 'utf16le'),
      ]);
      return Buffer.concat([
        Buffer.from(id, 'latin1'),
        size(content.length),
        Buffer.alloc(2),
        content,
      ]);
    })
  );
  const n = body.length;
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    version,
    0x00,
    0x00,
    (n >> 21) & 0x7f,
    (n >> 14) & 0x7f,
    (n >> 7) & 0x7f,
    n & 0x7f,
  ]);
  writeFileSync(outPath, Buffer.concat([header, body, readFileSync(outPath)]));
  return outPath;
}

/** {@link generateMiniMp3WithId3Frames} with an ID3v2.3 tag. */
export function generateMiniMp3WithId3v23(
  dir: string,
  filename: string,
  frames: Array<[id: string, text: string]>
): string {
  return generateMiniMp3WithId3Frames(dir, filename, frames, 3);
}
