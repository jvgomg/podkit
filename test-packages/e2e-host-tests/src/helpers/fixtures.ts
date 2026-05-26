/**
 * E2E-side semantic catalogue of the static audio fixture sets.
 *
 * The fixture *files* are owned by `@podkit/test-fixtures` (see that
 * package's README). This module layers on the e2e-test perspective: which
 * track lives where, which has artwork, which category each multi-format
 * track belongs to. Tests import these enums + selector helpers; the path
 * resolution they ultimately produce is the lib API.
 */

import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  getGoldbergFixturesDir,
  getMultiFormatFixturesDir,
  getStaticFixturesRoot,
  getSyntheticTestsFixturesDir,
} from '@podkit/test-fixtures';

/**
 * Absolute path to the root of the static audio fixture sets.
 *
 * Resolves to `<test-fixtures-package>/fixtures/audio` — the parent of the
 * three album subdirectories. Use {@link getAlbumDir} when you want a
 * specific album rather than the root.
 */
export function getFixturesDir(): string {
  return join(getStaticFixturesRoot(), 'audio');
}

/**
 * Album directories available in fixtures.
 */
export const Albums = {
  /** Synthetic Classics — 3 tracks with chord/vibrato/tremolo tones */
  GOLDBERG_SELECTIONS: 'goldberg-selections',

  /** Test Tones — 3 tracks including one without artwork */
  SYNTHETIC_TESTS: 'synthetic-tests',

  /** Multi-Format — 8 tracks in various formats for testing mixed collections */
  MULTI_FORMAT: 'multi-format',
} as const;

export type AlbumDir = (typeof Albums)[keyof typeof Albums];

/**
 * Information about a test audio file.
 */
export interface TestTrack {
  path: string;
  filename: string;
  album: AlbumDir;
  hasArtwork: boolean;
}

/**
 * Resolve the absolute directory for the named album by dispatching to the
 * corresponding `@podkit/test-fixtures` lib function.
 */
export function getAlbumDir(album: AlbumDir): string {
  switch (album) {
    case 'goldberg-selections':
      return getGoldbergFixturesDir();
    case 'synthetic-tests':
      return getSyntheticTestsFixturesDir();
    case 'multi-format':
      return getMultiFormatFixturesDir();
  }
}

/**
 * Get the absolute path to a specific track file inside an album.
 */
export function getTrackPath(album: AlbumDir, filename: string): string {
  return join(getAlbumDir(album), filename);
}

/**
 * Track definitions for known fixture files.
 */
export const Tracks = {
  // Goldberg Selections (Synthetic Classics album)
  HARMONY: { album: Albums.GOLDBERG_SELECTIONS, filename: '01-harmony.flac', hasArtwork: true },
  VIBRATO: { album: Albums.GOLDBERG_SELECTIONS, filename: '02-vibrato.flac', hasArtwork: true },
  TREMOLO: { album: Albums.GOLDBERG_SELECTIONS, filename: '03-tremolo.flac', hasArtwork: true },

  // Synthetic Tests (Test Tones album)
  A440: { album: Albums.SYNTHETIC_TESTS, filename: '01-a440.flac', hasArtwork: true },
  SWEEP: { album: Albums.SYNTHETIC_TESTS, filename: '02-sweep.flac', hasArtwork: true },
  // Intentionally has no artwork — the only no-artwork fixture in the audio sets.
  DUAL_TONE: { album: Albums.SYNTHETIC_TESTS, filename: '03-dual-tone.flac', hasArtwork: false },

  // Multi-Format — Lossless
  WAV_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '01-wav-track.wav',
    hasArtwork: false,
    format: 'wav' as const,
    category: 'lossless' as const,
  },
  AIFF_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '02-aiff-track.aiff',
    hasArtwork: false,
    format: 'aiff' as const,
    category: 'lossless' as const,
  },
  FLAC_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '03-flac-track.flac',
    hasArtwork: false,
    format: 'flac' as const,
    category: 'lossless' as const,
  },
  ALAC_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '04-alac-track.m4a',
    hasArtwork: false,
    format: 'm4a' as const,
    category: 'lossless' as const,
  },

  // Multi-Format — Compatible lossy (copied through, no transcode)
  MP3_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '05-mp3-track.mp3',
    hasArtwork: false,
    format: 'mp3' as const,
    category: 'compatible-lossy' as const,
  },
  AAC_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '06-aac-track.m4a',
    hasArtwork: false,
    format: 'm4a' as const,
    category: 'compatible-lossy' as const,
  },

  // Multi-Format — Incompatible lossy (must transcode + emit lossy-to-lossy warning)
  OGG_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '07-ogg-track.ogg',
    hasArtwork: false,
    format: 'ogg' as const,
    category: 'incompatible-lossy' as const,
  },
  OPUS_TRACK: {
    album: Albums.MULTI_FORMAT,
    filename: '08-opus-track.opus',
    hasArtwork: false,
    format: 'opus' as const,
    category: 'incompatible-lossy' as const,
  },
} as const;

/**
 * Get information about a specific track.
 */
export function getTrack(track: (typeof Tracks)[keyof typeof Tracks]): TestTrack {
  return {
    path: getTrackPath(track.album, track.filename),
    filename: track.filename,
    album: track.album,
    hasArtwork: track.hasArtwork,
  };
}

const AUDIO_EXTENSIONS = ['.flac', '.wav', '.aiff', '.m4a', '.mp3', '.ogg', '.opus', '.aac'];

/**
 * Get all track info for an album by scanning its directory.
 */
export async function getAlbumTracks(album: AlbumDir): Promise<TestTrack[]> {
  const albumDir = getAlbumDir(album);
  const files = await readdir(albumDir);

  const artworkMap: Record<string, boolean> = {};
  for (const track of Object.values(Tracks)) {
    if (track.album === album) {
      artworkMap[track.filename] = track.hasArtwork;
    }
  }

  return files
    .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .sort()
    .map((filename) => ({
      path: join(albumDir, filename),
      filename,
      album,
      hasArtwork: artworkMap[filename] ?? true,
    }));
}

/**
 * Get all available test tracks across every album.
 */
export async function getAllTracks(): Promise<TestTrack[]> {
  const goldberg = await getAlbumTracks(Albums.GOLDBERG_SELECTIONS);
  const synthetic = await getAlbumTracks(Albums.SYNTHETIC_TESTS);
  const multiFormat = await getAlbumTracks(Albums.MULTI_FORMAT);
  return [...goldberg, ...synthetic, ...multiFormat];
}
