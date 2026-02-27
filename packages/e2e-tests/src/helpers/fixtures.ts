/**
 * Test fixture paths for E2E tests.
 *
 * Provides paths to pre-built FLAC test files with metadata and artwork.
 * See test/fixtures/audio/README.md for details on the test files.
 */

import { resolve, join } from 'node:path';
import { readdir, access } from 'node:fs/promises';

/**
 * Base path to the audio fixtures directory.
 */
export function getFixturesDir(): string {
  return resolve(__dirname, '../../../../test/fixtures/audio');
}

/**
 * Album directories available in fixtures.
 */
export const Albums = {
  /** Synthetic Classics - 3 tracks with chord/vibrato/tremolo tones */
  GOLDBERG_SELECTIONS: 'goldberg-selections',

  /** Test Tones - 3 tracks including one without artwork */
  SYNTHETIC_TESTS: 'synthetic-tests',

  /** Multi-Format - 8 tracks in various formats for testing mixed collections */
  MULTI_FORMAT: 'multi-format',
} as const;

export type AlbumDir = (typeof Albums)[keyof typeof Albums];

/**
 * Information about a test audio file.
 */
export interface TestTrack {
  /** Absolute path to the file */
  path: string;

  /** Filename without directory */
  filename: string;

  /** Album directory name */
  album: AlbumDir;

  /** Whether this track has embedded artwork */
  hasArtwork: boolean;
}

/**
 * Get the path to an album directory.
 */
export function getAlbumDir(album: AlbumDir): string {
  return join(getFixturesDir(), album);
}

/**
 * Get path to a specific track file.
 *
 * @param album - Album directory
 * @param filename - Track filename (e.g., '01-harmony.flac')
 */
export function getTrackPath(album: AlbumDir, filename: string): string {
  return join(getAlbumDir(album), filename);
}

/**
 * Track definitions for known fixture files.
 */
export const Tracks = {
  // Goldberg Selections (Synthetic Classics album)
  HARMONY: {
    album: Albums.GOLDBERG_SELECTIONS,
    filename: '01-harmony.flac',
    hasArtwork: true,
  },
  VIBRATO: {
    album: Albums.GOLDBERG_SELECTIONS,
    filename: '02-vibrato.flac',
    hasArtwork: true,
  },
  TREMOLO: {
    album: Albums.GOLDBERG_SELECTIONS,
    filename: '03-tremolo.flac',
    hasArtwork: true,
  },

  // Synthetic Tests (Test Tones album)
  A440: {
    album: Albums.SYNTHETIC_TESTS,
    filename: '01-a440.flac',
    hasArtwork: true,
  },
  SWEEP: {
    album: Albums.SYNTHETIC_TESTS,
    filename: '02-sweep.flac',
    hasArtwork: true,
  },
  DUAL_TONE: {
    album: Albums.SYNTHETIC_TESTS,
    filename: '03-dual-tone.flac',
    hasArtwork: false, // This track intentionally has no artwork
  },

  // Multi-Format (mixed format collection)
  // Lossless formats
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
  // Compatible lossy formats (will be copied)
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
  // Incompatible lossy formats (will trigger warning)
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
export function getTrack(
  track: (typeof Tracks)[keyof typeof Tracks]
): TestTrack {
  return {
    path: getTrackPath(track.album, track.filename),
    filename: track.filename,
    album: track.album,
    hasArtwork: track.hasArtwork,
  };
}

/**
 * Supported audio file extensions.
 */
const AUDIO_EXTENSIONS = ['.flac', '.wav', '.aiff', '.m4a', '.mp3', '.ogg', '.opus', '.aac'];

/**
 * Get all track info for an album.
 */
export async function getAlbumTracks(album: AlbumDir): Promise<TestTrack[]> {
  const albumDir = getAlbumDir(album);
  const files = await readdir(albumDir);

  // Get artwork info from known tracks
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
      hasArtwork: artworkMap[filename] ?? true, // Assume artwork by default
    }));
}

/**
 * Get all available test tracks.
 */
export async function getAllTracks(): Promise<TestTrack[]> {
  const goldberg = await getAlbumTracks(Albums.GOLDBERG_SELECTIONS);
  const synthetic = await getAlbumTracks(Albums.SYNTHETIC_TESTS);
  const multiFormat = await getAlbumTracks(Albums.MULTI_FORMAT);
  return [...goldberg, ...synthetic, ...multiFormat];
}

/**
 * Check if fixtures are available.
 */
export async function areFixturesAvailable(): Promise<boolean> {
  try {
    await access(getFixturesDir());
    const tracks = await getAllTracks();
    return tracks.length > 0;
  } catch {
    return false;
  }
}
