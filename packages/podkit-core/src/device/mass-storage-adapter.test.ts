/**
 * Tests for MassStorageAdapter and MassStorageTrack
 *
 * Uses a temporary directory as a mock device mount point and injects
 * a fake metadata reader to avoid needing real audio files.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import { MassStorageAdapter, MassStorageTrack } from './mass-storage-adapter.js';
import type { MetadataReader } from './mass-storage-adapter.js';
import type { TagFields, TagWriter } from './mass-storage-tag-writer.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import {
  sanitizeFilename,
  generateTrackPath,
  generateVideoPath,
  resolvePathTemplate,
  DEFAULT_MUSIC_PATH_TEMPLATE,
  deduplicatePath,
  padTrackNumber,
  normalizeContentDir,
  normalizeContentPaths,
  validateContentPaths,
  PODKIT_DIR,
  MANIFEST_FILE,
} from './mass-storage-utils.js';
import { DEFAULT_CONTENT_PATHS } from '@podkit/devices-mass-storage';

// =============================================================================
// Test helpers
// =============================================================================

/** Minimal device capabilities for testing */
const TEST_CAPABILITIES: DeviceCapabilities = {
  artworkSources: ['embedded'],
  artworkMaxResolution: 600,
  supportedAudioCodecs: ['flac', 'mp3', 'aac', 'vorbis'],
  supportsVideo: false,
  audioNormalization: 'none',
  supportsAlbumArtistBrowsing: true,
};

/** Create a temporary directory for use as a mock device mount point */
function createTempDevice(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'podkit-mass-storage-test-'));
}

/** Remove a temporary directory recursively */
function removeTempDevice(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Create a fake audio file on the mock device.
 * The content is just a text placeholder — the metadata reader is mocked.
 */
function createFakeAudioFile(
  mountPoint: string,
  relativePath: string,
  content = 'fake audio'
): void {
  const fullPath = path.join(mountPoint, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Create a metadata reader that returns fixed metadata for known files.
 */
function createMockMetadataReader(
  fileMetadata: Record<
    string,
    {
      title?: string;
      artist?: string;
      album?: string;
      albumartist?: string;
      genre?: string;
      trackNumber?: number;
      totalTracks?: number;
      discNumber?: number;
      totalDiscs?: number;
      year?: number;
      duration?: number;
      bitrate?: number;
      sampleRate?: number;
      compilation?: boolean;
      hasPicture?: boolean;
    }
  >
): MetadataReader {
  return async (filePath: string) => {
    const basename = path.basename(filePath);
    const meta = fileMetadata[basename] ?? fileMetadata[filePath] ?? {};

    return {
      common: {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        albumartist: meta.albumartist,
        genre: meta.genre ? [meta.genre] : undefined,
        track: {
          no: meta.trackNumber ?? null,
          of: meta.totalTracks ?? null,
        },
        disk: {
          no: meta.discNumber ?? null,
          of: meta.totalDiscs ?? null,
        },
        year: meta.year,
        compilation: meta.compilation,
        picture: meta.hasPicture ? [{ data: Buffer.from('fake-image') }] : undefined,
      },
      format: {
        duration: meta.duration ? meta.duration / 1000 : undefined, // mm returns seconds
        bitrate: meta.bitrate ? meta.bitrate * 1000 : undefined, // mm returns bps
        sampleRate: meta.sampleRate,
        codec: 'flac',
      },
    };
  };
}

// =============================================================================
// Filename Sanitization Tests
// =============================================================================

describe('sanitizeFilename', () => {
  test('passes through clean filenames', () => {
    expect(sanitizeFilename('Hello World')).toBe('Hello World');
  });

  test('replaces FAT32-invalid characters with underscore', () => {
    // Consecutive underscore+space sequences collapse (e.g., "_ " -> " ")
    expect(sanitizeFilename('Track: The "Best"')).toBe('Track The Best_');
  });

  test('replaces all invalid FAT32 characters', () => {
    const result = sanitizeFilename('a:b?c"d*e<f>g|h/i\\j');
    expect(result).not.toMatch(/[:"*?<>|/\\]/);
  });

  test('strips emoji characters', () => {
    expect(sanitizeFilename('Hello 🎵 World 🎶')).toBe('Hello World');
  });

  test('trims whitespace', () => {
    expect(sanitizeFilename('  Hello  ')).toBe('Hello');
  });

  test('collapses consecutive underscores', () => {
    expect(sanitizeFilename('a___b')).toBe('a_b');
  });

  test('collapses consecutive spaces', () => {
    expect(sanitizeFilename('a   b')).toBe('a b');
  });

  test('returns "Unknown" for empty result', () => {
    expect(sanitizeFilename('🎵🎶')).toBe('Unknown');
    expect(sanitizeFilename('')).toBe('Unknown');
  });

  test('handles mixed invalid chars and emoji', () => {
    expect(sanitizeFilename('My: Song 🎵 (feat. *Artist*)')).toBe('My Song (feat. Artist_)');
  });
});

// =============================================================================
// Path Generation Tests
// =============================================================================

describe('generateTrackPath', () => {
  test('generates standard path', () => {
    const result = generateTrackPath({
      artist: 'Pink Floyd',
      album: 'The Wall',
      title: 'Comfortably Numb',
      trackNumber: 6,
      extension: '.flac',
    });
    expect(result).toBe('Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
  });

  test('uses defaults for missing artist/album', () => {
    const result = generateTrackPath({
      title: 'Untitled',
      extension: '.mp3',
    });
    expect(result).toBe('Music/Unknown Artist/Unknown Album/Untitled.mp3');
  });

  test('handles track numbers', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      trackNumber: 1,
      extension: '.mp3',
    });
    expect(result).toBe('Music/Artist/Album/01 - Song.mp3');
  });

  test('omits track number when not provided', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      extension: '.mp3',
    });
    expect(result).toBe('Music/Artist/Album/Song.mp3');
  });

  test('appends disc number for multi-disc albums', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      trackNumber: 1,
      discNumber: 2,
      totalDiscs: 3,
      extension: '.flac',
    });
    expect(result).toBe('Music/Artist/Album (disc 2)/01 - Song.flac');
  });

  test('does not append disc number for single-disc albums', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      trackNumber: 1,
      discNumber: 1,
      totalDiscs: 1,
      extension: '.flac',
    });
    expect(result).toBe('Music/Artist/Album/01 - Song.flac');
  });

  test('sanitizes special characters in path components', () => {
    const result = generateTrackPath({
      artist: 'AC/DC',
      album: 'Who Made Who?',
      title: 'For Those About to Rock',
      trackNumber: 1,
      extension: '.mp3',
    });
    expect(result).toBe('Music/AC_DC/Who Made Who_/01 - For Those About to Rock.mp3');
  });

  test('handles extension with or without dot', () => {
    const withDot = generateTrackPath({ title: 'Song', extension: '.flac' });
    const withoutDot = generateTrackPath({ title: 'Song', extension: 'flac' });
    expect(withDot).toBe(withoutDot);
  });

  test('uses albumArtist for directory when provided', () => {
    const result = generateTrackPath({
      artist: 'Dua Lipa',
      albumArtist: 'Various Artists',
      album: 'Now 100',
      title: 'Levitating',
      trackNumber: 3,
      extension: '.flac',
    });
    expect(result).toBe('Music/Various Artists/Now 100/03 - Levitating.flac');
  });

  test('falls back to artist when albumArtist is absent', () => {
    const result = generateTrackPath({
      artist: 'Pink Floyd',
      album: 'The Wall',
      title: 'Comfortably Numb',
      trackNumber: 6,
      extension: '.flac',
    });
    expect(result).toBe('Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
  });

  test('groups compilation tracks under album artist', () => {
    const trackA = generateTrackPath({
      artist: 'Artist A',
      albumArtist: 'Various Artists',
      album: 'Compilation Album',
      title: 'Song A',
      trackNumber: 1,
      extension: '.mp3',
    });
    const trackB = generateTrackPath({
      artist: 'Artist B',
      albumArtist: 'Various Artists',
      album: 'Compilation Album',
      title: 'Song B',
      trackNumber: 2,
      extension: '.mp3',
    });
    // Both tracks should be in the same directory
    expect(path.dirname(trackA)).toBe(path.dirname(trackB));
    expect(path.dirname(trackA)).toBe('Music/Various Artists/Compilation Album');
  });
});

describe('resolvePathTemplate', () => {
  test('default template matches generateTrackPath output', () => {
    const fromTemplate = resolvePathTemplate(
      DEFAULT_MUSIC_PATH_TEMPLATE,
      {
        artist: 'Pink Floyd',
        albumArtist: 'Pink Floyd',
        album: 'The Wall',
        title: 'Comfortably Numb',
        trackNumber: 6,
        ext: '.flac',
      },
      'Music'
    );
    expect(fromTemplate).toBe('Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
  });

  test('custom template with artist instead of albumArtist', () => {
    const result = resolvePathTemplate(
      '{artist}/{album}/{trackNumber} - {title}{ext}',
      {
        artist: 'Dua Lipa',
        albumArtist: 'Various Artists',
        album: 'Now 100',
        title: 'Levitating',
        trackNumber: 3,
        ext: '.flac',
      },
      'Music'
    );
    expect(result).toBe('Music/Dua Lipa/Now 100/03 - Levitating.flac');
  });

  test('custom flat template', () => {
    const result = resolvePathTemplate(
      '{albumArtist} - {title}{ext}',
      {
        artist: 'Pink Floyd',
        albumArtist: 'Pink Floyd',
        album: 'The Wall',
        title: 'Comfortably Numb',
        trackNumber: 6,
        ext: '.flac',
      },
      'Music'
    );
    expect(result).toBe('Music/Pink Floyd - Comfortably Numb.flac');
  });

  test('handles empty musicDir (root level)', () => {
    const result = resolvePathTemplate(
      '{albumArtist}/{album}/{title}{ext}',
      {
        artist: 'Artist',
        album: 'Album',
        title: 'Song',
        ext: '.mp3',
      },
      ''
    );
    expect(result).toBe('Artist/Album/Song.mp3');
  });

  test('template with genre and year variables', () => {
    const result = resolvePathTemplate(
      '{genre}/{albumArtist}/{album} ({year})/{trackNumber} - {title}{ext}',
      {
        artist: 'Pink Floyd',
        albumArtist: 'Pink Floyd',
        album: 'The Wall',
        title: 'Comfortably Numb',
        trackNumber: 6,
        genre: 'Rock',
        year: 1979,
        ext: '.flac',
      },
      'Music'
    );
    expect(result).toBe('Music/Rock/Pink Floyd/The Wall (1979)/06 - Comfortably Numb.flac');
  });

  test('drops empty optional directory segments instead of using "Unknown"', () => {
    const result = resolvePathTemplate(
      '{genre}/{albumArtist}/{album}/{trackNumber} - {title}{ext}',
      {
        artist: 'Pink Floyd',
        album: 'The Wall',
        title: 'Comfortably Numb',
        trackNumber: 6,
        // genre intentionally omitted
        ext: '.flac',
      },
      'Music'
    );
    // {genre} is empty, so that directory segment should be dropped entirely
    expect(result).toBe('Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
  });
});

describe('padTrackNumber', () => {
  test('pads single digit', () => {
    expect(padTrackNumber(1)).toBe('01');
  });

  test('preserves double digit', () => {
    expect(padTrackNumber(12)).toBe('12');
  });

  test('preserves triple digit', () => {
    expect(padTrackNumber(100)).toBe('100');
  });

  test('returns empty string for undefined', () => {
    expect(padTrackNumber(undefined)).toBe('');
  });

  test('returns empty string for zero', () => {
    expect(padTrackNumber(0)).toBe('');
  });
});

describe('deduplicatePath', () => {
  test('returns original path when unique', () => {
    const result = deduplicatePath('Music/Artist/Album/01 - Song.flac', new Set());
    expect(result).toBe('Music/Artist/Album/01 - Song.flac');
  });

  test('appends (2) for first conflict', () => {
    const existing = new Set(['Music/Artist/Album/01 - Song.flac']);
    const result = deduplicatePath('Music/Artist/Album/01 - Song.flac', existing);
    expect(result).toBe('Music/Artist/Album/01 - Song (2).flac');
  });

  test('increments counter for multiple conflicts', () => {
    const existing = new Set([
      'Music/Artist/Album/01 - Song.flac',
      'Music/Artist/Album/01 - Song (2).flac',
    ]);
    const result = deduplicatePath('Music/Artist/Album/01 - Song.flac', existing);
    expect(result).toBe('Music/Artist/Album/01 - Song (3).flac');
  });
});

// =============================================================================
// MassStorageTrack Tests
// =============================================================================

describe('MassStorageTrack', () => {
  let mountPoint: string;

  beforeEach(() => {
    mountPoint = createTempDevice();
  });

  afterEach(() => {
    removeTempDevice(mountPoint);
  });

  function createTestTrack(overrides?: Partial<ConstructorParameters<typeof MassStorageTrack>[0]>) {
    return new MassStorageTrack({
      mountPoint,
      filePath: 'Music/Artist/Album/01 - Song.flac',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      trackNumber: 1,
      duration: 180000,
      bitrate: 320,
      sampleRate: 44100,
      size: 5000000,
      filetype: 'flac',
      hasArtwork: false,
      hasFile: true,
      compilation: false,
      managed: true,
      artworkSink: 'embedded',
      ...overrides,
    });
  }

  test('exposes metadata as readonly properties', () => {
    const track = createTestTrack();
    expect(track.title).toBe('Song');
    expect(track.artist).toBe('Artist');
    expect(track.album).toBe('Album');
    expect(track.trackNumber).toBe(1);
    expect(track.duration).toBe(180000);
    expect(track.mediaType).toBe(1);
  });

  test('update() returns new track with updated fields', () => {
    const track = createTestTrack();
    const updated = track.update({ title: 'New Title', artist: 'New Artist' });

    expect(updated.title).toBe('New Title');
    expect(updated.artist).toBe('New Artist');
    expect(updated.album).toBe('Album'); // Unchanged
    expect(updated).not.toBe(track); // New instance
  });

  test('remove() deletes the file from disk', () => {
    const relPath = 'Music/Artist/Album/01 - Song.flac';
    createFakeAudioFile(mountPoint, relPath);
    expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(true);

    const track = createTestTrack({ filePath: relPath });
    track.remove();

    expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(false);
  });

  test('remove() cleans up empty parent directories', () => {
    const relPath = 'Music/Artist/Album/01 - Song.flac';
    createFakeAudioFile(mountPoint, relPath);

    const track = createTestTrack({ filePath: relPath });
    track.remove();

    // Album and Artist dirs should be removed (empty)
    expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album'))).toBe(false);
    expect(fs.existsSync(path.join(mountPoint, 'Music/Artist'))).toBe(false);
    // Music/ directory should still exist
    expect(fs.existsSync(path.join(mountPoint, 'Music'))).toBe(true);
  });

  test('remove() preserves non-empty parent directories', () => {
    createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');
    createFakeAudioFile(mountPoint, 'Music/Artist/Album/02 - Other.flac');

    const track = createTestTrack({ filePath: 'Music/Artist/Album/01 - Song.flac' });
    track.remove();

    // Album dir should still exist (has another file)
    expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album'))).toBe(true);
    expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album/02 - Other.flac'))).toBe(true);
  });

  test('remove() with keepFile=true does not delete', () => {
    const relPath = 'Music/Artist/Album/01 - Song.flac';
    createFakeAudioFile(mountPoint, relPath);

    const track = createTestTrack({ filePath: relPath });
    track.remove({ keepFile: true });

    expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(true);
  });

  test('remove() handles missing file gracefully', () => {
    const track = createTestTrack({ filePath: 'Music/Artist/Album/nonexistent.flac' });
    // Should not throw
    expect(() => track.remove()).not.toThrow();
  });

  test('copyFile() copies source to device path', () => {
    // Create a source file
    const sourceDir = createTempDevice();
    const sourcePath = path.join(sourceDir, 'source.flac');
    fs.writeFileSync(sourcePath, 'source audio content');

    const track = createTestTrack({ hasFile: false });
    const copied = track.copyFile(sourcePath);

    const destPath = path.join(mountPoint, track.filePath);
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('source audio content');
    expect(copied.hasFile).toBe(true);
    expect(copied.size).toBe(fs.statSync(destPath).size);

    removeTempDevice(sourceDir);
  });

  test('copyFile() creates parent directories', () => {
    const sourceDir = createTempDevice();
    const sourcePath = path.join(sourceDir, 'source.flac');
    fs.writeFileSync(sourcePath, 'audio data');

    const track = createTestTrack({
      filePath: 'Music/Deep/Nested/Path/01 - Song.flac',
      hasFile: false,
    });
    track.copyFile(sourcePath);

    expect(fs.existsSync(path.join(mountPoint, 'Music/Deep/Nested/Path/01 - Song.flac'))).toBe(
      true
    );

    removeTempDevice(sourceDir);
  });

  // Artwork operations live on the adapter (see MassStorageAdapter.setTrackArtwork /
  // removeTrackArtwork). The behavioural coverage lives in the adapter suite —
  // MassStorageTrack itself no longer carries those methods.
});

// =============================================================================
// MassStorageAdapter Tests
// =============================================================================

describe('MassStorageAdapter', () => {
  let mountPoint: string;

  beforeEach(() => {
    mountPoint = createTempDevice();
  });

  afterEach(() => {
    removeTempDevice(mountPoint);
  });

  describe('open() and getTracks()', () => {
    test('returns empty list when Music/ does not exist', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(adapter.getTracks()).toEqual([]);
    });

    test('scans audio files from Music/ directory', async () => {
      createFakeAudioFile(mountPoint, 'Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
      createFakeAudioFile(mountPoint, 'Music/Pink Floyd/The Wall/01 - In the Flesh.flac');

      const reader = createMockMetadataReader({
        '06 - Comfortably Numb.flac': {
          title: 'Comfortably Numb',
          artist: 'Pink Floyd',
          album: 'The Wall',
          trackNumber: 6,
          duration: 382000,
          bitrate: 900,
          sampleRate: 44100,
        },
        '01 - In the Flesh.flac': {
          title: 'In the Flesh?',
          artist: 'Pink Floyd',
          album: 'The Wall',
          trackNumber: 1,
          duration: 199000,
          bitrate: 850,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(2);

      const titles = tracks.map((t) => t.title).sort();
      expect(titles).toEqual(['Comfortably Numb', 'In the Flesh?']);
    });

    test('ignores non-audio files', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/song.flac');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/cover.jpg');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/notes.txt');

      const reader = createMockMetadataReader({
        'song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      expect(adapter.getTracks()).toHaveLength(1);
    });

    test('reads metadata fields correctly', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          albumartist: 'Test Album Artist',
          genre: 'Rock',
          trackNumber: 3,
          discNumber: 1,
          year: 2024,
          duration: 240000,
          bitrate: 320,
          sampleRate: 44100,
          compilation: true,
          hasPicture: true,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(1);

      const track = tracks[0]!;
      expect(track.title).toBe('Test Song');
      expect(track.artist).toBe('Test Artist');
      expect(track.album).toBe('Test Album');
      expect(track.albumArtist).toBe('Test Album Artist');
      expect(track.genre).toBe('Rock');
      expect(track.trackNumber).toBe(3);
      expect(track.discNumber).toBe(1);
      expect(track.year).toBe(2024);
      expect(track.duration).toBe(240000);
      expect(track.bitrate).toBe(320);
      expect(track.sampleRate).toBe(44100);
      expect(track.compilation).toBe(true);
      expect(track.hasArtwork).toBe(true);
      expect(track.hasFile).toBe(true);
    });

    test('uses filename as title when tag is missing', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/My Song.flac');

      const reader = createMockMetadataReader({
        'My Song.flac': { artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const tracks = adapter.getTracks();
      expect(tracks[0]!.title).toBe('My Song');
    });

    test('skips files that fail to parse', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/good.flac');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/bad.flac');

      const reader: MetadataReader = async (filePath) => {
        if (filePath.includes('bad.flac')) {
          throw new Error('corrupt file');
        }
        return {
          common: { title: 'Good Song', artist: 'Artist', album: 'Album' },
          format: { duration: 180, bitrate: 320000, sampleRate: 44100 },
        };
      };

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      expect(adapter.getTracks()).toHaveLength(1);
      expect(adapter.getTracks()[0]!.title).toBe('Good Song');
    });
  });

  describe('addTrack()', () => {
    test('creates a track with correct path', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const track = adapter.addTrack({
        title: 'Comfortably Numb',
        artist: 'Pink Floyd',
        album: 'The Wall',
        trackNumber: 6,
        filetype: 'flac',
      });

      expect(track.filePath).toBe('Music/Pink Floyd/The Wall/06 - Comfortably Numb.flac');
      expect(track.hasFile).toBe(false);
    });

    test('deduplicates conflicting paths', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const t1 = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        filetype: 'flac',
      });

      const t2 = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        filetype: 'flac',
      });

      expect(t1.filePath).toBe('Music/Artist/Album/01 - Song.flac');
      expect(t2.filePath).toBe('Music/Artist/Album/01 - Song (2).flac');
    });

    test('handles multi-disc albums', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        discNumber: 2,
        totalDiscs: 2,
        filetype: 'mp3',
      });

      expect(track.filePath).toBe('Music/Artist/Album (disc 2)/01 - Song.mp3');
    });

    test('adds track to getTracks() list', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(adapter.getTracks()).toHaveLength(0);

      adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        filetype: 'flac',
      });

      expect(adapter.getTracks()).toHaveLength(1);
    });

    test('uses mp3 extension as default when filetype missing', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const track = adapter.addTrack({ title: 'Song' });
      expect(track.filePath).toEndWith('.mp3');
    });
  });

  describe('checkAddCollisions()', () => {
    test('returns empty array when no collisions', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const collisions = adapter.checkAddCollisions([
        { title: 'New Song', artist: 'New Artist', album: 'New Album', filetype: 'flac' },
      ]);

      expect(collisions).toEqual([]);
    });

    test('detects collision with unmanaged file', async () => {
      // Create an unmanaged file on device (no manifest entry)
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 1 },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      // Verify the file is unmanaged (no manifest)
      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(1);
      expect(tracks[0]!.managed).toBe(false);

      // Check for collision with the same path
      const collisions = adapter.checkAddCollisions([
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          trackNumber: 1,
          filetype: 'flac',
        },
      ]);

      expect(collisions).toHaveLength(1);
      expect(collisions[0]!.path).toBe('Music/Artist/Album/01 - Song.flac');
      expect(collisions[0]!.description).toBe('Artist - Song');
    });

    test('does not flag managed files as collisions', async () => {
      // Create file AND manifest so it's managed
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const manifestDir = path.join(mountPoint, '.podkit');
      fs.mkdirSync(manifestDir, { recursive: true });
      fs.writeFileSync(
        path.join(manifestDir, 'state.json'),
        JSON.stringify({
          version: 1,
          managedFiles: ['Music/Artist/Album/01 - Song.flac'],
          lastSync: new Date().toISOString(),
        })
      );

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 1 },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const collisions = adapter.checkAddCollisions([
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          trackNumber: 1,
          filetype: 'flac',
        },
      ]);

      expect(collisions).toEqual([]);
    });

    test('detects multiple collisions', async () => {
      createFakeAudioFile(mountPoint, 'Music/A1/Album/01 - S1.mp3');
      createFakeAudioFile(mountPoint, 'Music/A2/Album/02 - S2.mp3');

      const reader = createMockMetadataReader({
        '01 - S1.mp3': { title: 'S1', artist: 'A1', album: 'Album', trackNumber: 1 },
        '02 - S2.mp3': { title: 'S2', artist: 'A2', album: 'Album', trackNumber: 2 },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const collisions = adapter.checkAddCollisions([
        { title: 'S1', artist: 'A1', album: 'Album', trackNumber: 1, filetype: '.mp3' },
        { title: 'S2', artist: 'A2', album: 'Album', trackNumber: 2, filetype: '.mp3' },
        { title: 'S3', artist: 'A3', album: 'Other', trackNumber: 3, filetype: '.mp3' },
      ]);

      expect(collisions).toHaveLength(2);
    });

    test('resolves filetype label to extension', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.m4a');

      const reader = createMockMetadataReader({
        '01 - Song.m4a': { title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 1 },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      // Use filetype label (what the transcode pipeline passes)
      const collisions = adapter.checkAddCollisions([
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          trackNumber: 1,
          filetype: 'AAC audio file',
        },
      ]);

      expect(collisions).toHaveLength(1);
      expect(collisions[0]!.path).toBe('Music/Artist/Album/01 - Song.m4a');
    });
  });

  describe('updateTrack()', () => {
    test('updates track metadata in place', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const original = adapter.getTracks()[0]!;
      const updated = adapter.updateTrack(original, { title: 'New Title' });

      expect(updated.title).toBe('New Title');
      expect(updated.artist).toBe('Artist'); // Unchanged

      // The track list should be updated
      expect(adapter.getTracks()[0]!.title).toBe('New Title');
    });
  });

  describe('relocateTrack()', () => {
    test('moves file to new path and updates bookkeeping', async () => {
      const relPath = 'Music/Old Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      // Create manifest with managed file
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({ version: 1, managedFiles: [relPath], lastSync: new Date().toISOString() })
      );

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Song',
          artist: 'Old Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const track = adapter.getTracks()[0]!;
      expect(track.filePath).toBe(relPath);
      expect(track.managed).toBe(true);

      const newPath = 'Music/New Artist/Album/01 - Song.flac';
      const relocated = adapter.relocateTrack(track, newPath);

      // Track instance should have new path
      expect(relocated.filePath).toBe(newPath);

      // Track list should be updated
      expect(adapter.getTracks()[0]!.filePath).toBe(newPath);

      // Save should rename the file on disk
      await adapter.save();

      expect(fs.existsSync(path.join(mountPoint, newPath))).toBe(true);
      expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(false);

      // Old empty directories should be cleaned up
      expect(fs.existsSync(path.join(mountPoint, 'Music/Old Artist'))).toBe(false);
    });

    test('deduplicates when target path is already taken', async () => {
      const path1 = 'Music/Artist/Album/01 - Song A.flac';
      const path2 = 'Music/Other/Album/01 - Song B.flac';
      createFakeAudioFile(mountPoint, path1);
      createFakeAudioFile(mountPoint, path2);

      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          managedFiles: [path1, path2],
          lastSync: new Date().toISOString(),
        })
      );

      const reader = createMockMetadataReader({
        '01 - Song A.flac': {
          title: 'Song A',
          artist: 'Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
        '01 - Song B.flac': {
          title: 'Song B',
          artist: 'Other',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const tracks = adapter.getTracks();
      const trackA = tracks.find((t) => t.title === 'Song A')!;
      const trackB = tracks.find((t) => t.title === 'Song B')!;

      // Relocate both to the same target path
      const targetPath = 'Music/Same/Album/01 - Song.flac';
      const relocatedA = adapter.relocateTrack(trackA, targetPath);
      const relocatedB = adapter.relocateTrack(trackB, targetPath);

      // Second should be deduplicated
      expect(relocatedA.filePath).toBe(targetPath);
      expect(relocatedB.filePath).not.toBe(targetPath);
      expect(relocatedB.filePath).toContain('Song (2)');
    });

    test('skips move gracefully when source file is missing', async () => {
      const relPath = 'Music/Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({ version: 1, managedFiles: [relPath], lastSync: new Date().toISOString() })
      );

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const track = adapter.getTracks()[0]!;
      adapter.relocateTrack(track, 'Music/New/Album/01 - Song.flac');

      // Delete the source file before save
      fs.unlinkSync(path.join(mountPoint, relPath));

      // save() should not throw
      await adapter.save();
    });
  });

  describe('removeTrack()', () => {
    test('deletes managed file and removes from track list', async () => {
      const relPath = 'Music/Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      // Create a manifest that marks the file as managed
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          managedFiles: [relPath],
          lastSync: new Date().toISOString(),
        })
      );

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      expect(adapter.getTracks()).toHaveLength(1);

      const track = adapter.getTracks()[0]!;
      adapter.removeTrack(track);

      expect(adapter.getTracks()).toHaveLength(0);
      expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(false);
    });

    test('does not delete unmanaged files', async () => {
      const relPath = 'Music/Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      // No manifest — file is unmanaged
      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const track = adapter.getTracks()[0]!;
      adapter.removeTrack(track);

      // File should still exist
      expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(true);
      // But track should be removed from the list
      expect(adapter.getTracks()).toHaveLength(0);
    });

    test('respects deleteFile=false option', async () => {
      const relPath = 'Music/Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          managedFiles: [relPath],
          lastSync: new Date().toISOString(),
        })
      );

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const track = adapter.getTracks()[0]!;
      adapter.removeTrack(track, { deleteFile: false });

      expect(fs.existsSync(path.join(mountPoint, relPath))).toBe(true);
      expect(adapter.getTracks()).toHaveLength(0);
    });
  });

  describe('save() — manifest persistence', () => {
    test('writes manifest with managed files', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      adapter.addTrack({
        title: 'Song A',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        filetype: 'flac',
      });

      adapter.addTrack({
        title: 'Song B',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 2,
        filetype: 'flac',
      });

      await adapter.save();

      const manifestPath = path.join(mountPoint, PODKIT_DIR, MANIFEST_FILE);
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.version).toBe(1);
      expect(manifest.managedFiles).toHaveLength(2);
      expect(manifest.managedFiles).toContain('Music/Artist/Album/01 - Song A.flac');
      expect(manifest.managedFiles).toContain('Music/Artist/Album/02 - Song B.flac');
      expect(manifest.lastSync).toBeDefined();
    });

    test('manifest survives round-trip (save + reopen)', async () => {
      // First session: add tracks and save
      const adapter1 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      const track = adapter1.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        filetype: 'flac',
      });

      // Create the actual file so the scanner finds it
      createFakeAudioFile(mountPoint, track.filePath);
      await adapter1.save();

      // Second session: reopen and verify managed status
      const reader = createMockMetadataReader({
        'Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter2 = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const tracks = adapter2.getTracks();
      expect(tracks).toHaveLength(1);

      // The track should be recognized as managed
      const msTrack = tracks[0] as MassStorageTrack;
      expect(msTrack.managed).toBe(true);
    });
  });

  describe('save() — WarningSink emit sites', () => {
    test('emits a warning when a relocate hits ENOENT (source file vanished between plan and save)', async () => {
      const relPath = 'Music/Old Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Song',
          artist: 'Old Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const emitted: import('../sync/engine/types.js').Warning[] = [];
      adapter.setWarningSink({
        emit: (w) => {
          emitted.push(w);
        },
      });

      const track = adapter.getTracks()[0]!;
      const newPath = 'Music/New Artist/Album/01 - Song.flac';
      adapter.relocateTrack(track, newPath);

      // Simulate external deletion between plan and save.
      fs.unlinkSync(path.join(mountPoint, relPath));

      // save() must not reject — vanished source is a soft signal.
      await expect(adapter.save()).resolves.toBeUndefined();

      expect(emitted).toHaveLength(1);
      const w = emitted[0]!;
      expect(w.phase).toBe('execute');
      expect(w.type).toBe('metadata');
      expect(w.message).toContain('source file disappeared');
      expect(w.tracks).toHaveLength(1);
      expect(w.tracks[0]!.artist).toBe('Old Artist');
      expect(w.tracks[0]!.title).toBe('Song');
      expect(w.tracks[0]!.album).toBe('Album');
    });

    test('memoizes track lookup to avoid O(N²) scans when multiple relocates vanish', async () => {
      const relocationCount = 10;
      const metadata: Record<string, any> = {};
      const origPaths: string[] = [];

      for (let i = 0; i < relocationCount; i++) {
        const filename = `Song${i}.flac`;
        const relPath = `Music/Album/${filename}`;
        origPaths.push(relPath);
        createFakeAudioFile(mountPoint, relPath);
        metadata[filename] = {
          title: `Song${i}`,
          artist: `Artist${i}`,
          album: `Album`,
          trackNumber: i,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        };
      }

      const reader = createMockMetadataReader(metadata);
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const emitted: import('../sync/engine/types.js').Warning[] = [];
      adapter.setWarningSink({
        emit: (w) => {
          emitted.push(w);
        },
      });

      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(relocationCount);

      const trackTitles = new Set(tracks.map((t) => t.title));

      for (let i = 0; i < relocationCount; i++) {
        const track = tracks[i]!;
        const newPath = `Music/Moved/relocated-${i}.flac`;
        adapter.relocateTrack(track, newPath);
      }

      for (let i = 0; i < relocationCount; i++) {
        const origPath = origPaths[i]!;
        const absPath = path.join(mountPoint, origPath);
        fs.unlinkSync(absPath);
      }

      // Spy on the legacy linear-scan path. Memoisation routes every vanish
      // through the per-save() map; a regression to per-iteration linear
      // scans would re-fire this spy and the assertion below would catch it.
      const adapterAny = adapter as unknown as {
        lookupTrackRef: (p: string) => unknown;
      };
      const origLookup = adapterAny.lookupTrackRef.bind(adapter);
      let lookupCalls = 0;
      adapterAny.lookupTrackRef = (p: string) => {
        lookupCalls++;
        return origLookup(p);
      };

      await expect(adapter.save()).resolves.toBeUndefined();

      // O(1) shape: zero linear scans across N vanishes. The map covers
      // every queued path, so the fallback in `??` is unreachable here.
      expect(lookupCalls).toBe(0);
      expect(emitted).toHaveLength(1);
      const w = emitted[0]!;
      expect(w.type).toBe('metadata');
      expect(w.tracks).toHaveLength(relocationCount);
      const warnedTitles = new Set(w.tracks.map((t) => t.title));
      expect(warnedTitles).toEqual(trackTitles);
    });

    test('does not emit when relocate succeeds normally', async () => {
      const relPath = 'Music/Old Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Song',
          artist: 'Old Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const emitted: import('../sync/engine/types.js').Warning[] = [];
      adapter.setWarningSink({
        emit: (w) => {
          emitted.push(w);
        },
      });

      const track = adapter.getTracks()[0]!;
      adapter.relocateTrack(track, 'Music/New Artist/Album/01 - Song.flac');
      await adapter.save();

      expect(emitted).toHaveLength(0);
    });

    test('default no-op sink is safe — adapter saves without setWarningSink', async () => {
      // The pipeline injects a sink at execute start; doctor/manual callers
      // may not. The default no-op sink must not crash and must not
      // regress save() success.
      const relPath = 'Music/Old Artist/Album/01 - Song.flac';
      createFakeAudioFile(mountPoint, relPath);

      const reader = createMockMetadataReader({
        '01 - Song.flac': {
          title: 'Song',
          artist: 'Old Artist',
          album: 'Album',
          trackNumber: 1,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const track = adapter.getTracks()[0]!;
      adapter.relocateTrack(track, 'Music/New Artist/Album/01 - Song.flac');
      fs.unlinkSync(path.join(mountPoint, relPath));
      await expect(adapter.save()).resolves.toBeUndefined();
    });
  });

  describe('close()', () => {
    test('does not throw', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(() => adapter.close()).not.toThrow();
    });
  });

  describe('capabilities and mountPoint', () => {
    test('exposes capabilities (filtered through MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS)', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      // The adapter applies the codec filter (drops wav/aiff) and so a
      // strict reference-equality check against the input no longer holds.
      // The values must still match for every field — only the codec list
      // is potentially narrowed.
      expect(adapter.capabilities).toEqual({
        ...TEST_CAPABILITIES,
        supportedAudioCodecs: TEST_CAPABILITIES.supportedAudioCodecs.filter(
          (c) => c !== 'wav' && c !== 'aiff'
        ),
      });
    });

    test('exposes mountPoint', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(adapter.mountPoint).toBe(mountPoint);
    });
  });

  describe('podkit-output codec filter', () => {
    // The preset/raw capability data may list wav/aiff as "device can play
    // these natively". The MassStorageAdapter's `capabilities` represents
    // what podkit will actually USE as device-output and must strip the
    // codecs podkit can't reliably manage (tag-writing). The classifier
    // consults `device.capabilities.supportedAudioCodecs` for direct-copy
    // decisions — filtering here means WAV sources transcode rather than
    // being placed on the device as WAV with stale tags.
    test('strips wav and aiff from supportedAudioCodecs', async () => {
      createFakeAudioFile(mountPoint, 'Music/A/B/01 - Song.flac');
      const adapter = await MassStorageAdapter.open(
        mountPoint,
        {
          ...TEST_CAPABILITIES,
          supportedAudioCodecs: ['aac', 'mp3', 'flac', 'wav', 'aiff'],
        },
        {
          metadataReader: createMockMetadataReader({
            '01 - Song.flac': { title: 'Song', artist: 'A', album: 'B' },
          }),
        }
      );
      expect(adapter.capabilities.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac']);
    });

    test('leaves a wav/aiff-free codec list untouched', async () => {
      createFakeAudioFile(mountPoint, 'Music/A/B/01 - Song.flac');
      const adapter = await MassStorageAdapter.open(
        mountPoint,
        {
          ...TEST_CAPABILITIES,
          supportedAudioCodecs: ['aac', 'mp3', 'flac', 'opus'],
        },
        {
          metadataReader: createMockMetadataReader({
            '01 - Song.flac': { title: 'Song', artist: 'A', album: 'B' },
          }),
        }
      );
      expect(adapter.capabilities.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac', 'opus']);
    });
  });

  describe('sync tag persistence (comment tag writes)', () => {
    /** Mock tag writer that records all writeTags calls */
    function createMockTagWriter(): TagWriter & {
      calls: Array<{ filePath: string; fields: TagFields }>;
    } {
      const calls: Array<{ filePath: string; fields: TagFields }> = [];
      return {
        calls,
        async writeTags(filePath: string, fields: TagFields) {
          calls.push({ filePath, fields });
        },
        async writePicture(_filePath: string, _imageData: Buffer) {},
      };
    }

    test('updateTrack with changed comment queues a pending write', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, { comment: '[podkit:v1 quality=high encoding=vbr]' });

      // No writes yet — pending until save()
      expect(tagWriter.calls).toHaveLength(0);

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.filePath).toBe(
        path.join(mountPoint, 'Music/Artist/Album/01 - Song.flac')
      );
      expect(tagWriter.calls[0]!.fields.comment).toBe('[podkit:v1 quality=high encoding=vbr]');
    });

    test('updateTrack with changed title queues a tag write', async () => {
      // Was previously locked-in as "no write when only title changes" —
      // inverted to assert the new convergence behaviour.
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, { title: 'New Title' });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields).toEqual({ title: 'New Title' });
    });

    test('updateTrack with no actual changes does not queue a write', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      // Passing the same values back is a no-op at the disk layer.
      adapter.updateTrack(track, { title: 'Song', artist: 'Artist', album: 'Album' });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(0);
    });

    test('updateTrack queues every metadata field whose value differs', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': {
            title: 'Song',
            artist: 'Artist',
            album: 'Album',
            albumartist: 'Album Artist',
            genre: 'Rock',
            year: 2020,
            trackNumber: 1,
            discNumber: 1,
            compilation: false,
          },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, {
        title: 'New Title',
        artist: 'New Artist',
        albumArtist: 'New Album Artist',
        album: 'New Album',
        genre: 'Jazz',
        year: 2025,
        trackNumber: 7,
        discNumber: 2,
        compilation: true,
      });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields).toEqual({
        title: 'New Title',
        artist: 'New Artist',
        albumArtist: 'New Album Artist',
        album: 'New Album',
        genre: 'Jazz',
        year: 2025,
        trackNumber: 7,
        discNumber: 2,
        compilation: true,
      });
    });

    test('multiple updates to same track coalesce into one writeTags call', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      const updated = adapter.updateTrack(track, { title: 'New Title' });
      adapter.updateTrack(updated, { albumArtist: 'New AA' });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields).toEqual({
        title: 'New Title',
        albumArtist: 'New AA',
      });
    });

    test('multiple comment updates to same track coalesce to latest value', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      const updated = adapter.updateTrack(track, { comment: '[podkit:v1 quality=high]' });
      adapter.updateTrack(updated, { comment: '[podkit:v1 quality=high art=a1b2c3d4]' });

      await adapter.save();

      // Only one write with the final value
      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.comment).toBe('[podkit:v1 quality=high art=a1b2c3d4]');
    });

    test('pending writes for multiple tracks are flushed in save()', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song A.flac');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/02 - Song B.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song A.flac': { title: 'Song A', artist: 'Artist', album: 'Album' },
          '02 - Song B.flac': { title: 'Song B', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const tracks = adapter.getTracks();
      adapter.updateTrack(tracks[0]!, { comment: 'tag-a' });
      adapter.updateTrack(tracks[1]!, { comment: 'tag-b' });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(2);
      const comments = tagWriter.calls.map((c) => c.fields.comment).sort();
      expect(comments).toEqual(['tag-a', 'tag-b']);
    });

    test('save() clears pending writes after flushing', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, { comment: 'sync-tag' });

      await adapter.save();
      expect(tagWriter.calls).toHaveLength(1);

      // Second save should not re-write
      await adapter.save();
      expect(tagWriter.calls).toHaveLength(1);
    });

    test('save() with no pending writes does not call tagWriter', async () => {
      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        tagWriter,
      });

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(0);
    });

    test('tag write error propagates from save()', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const failingWriter: TagWriter = {
        async writeTags() {
          throw new Error('FFmpeg exploded');
        },
        async writePicture() {
          throw new Error('FFmpeg exploded');
        },
      };

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter: failingWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, { comment: 'sync-tag' });

      // The save() aggregates per-file failures into a typed TagWriteError
      // — categorization uses instanceof, not message keywords. Per-file
      // context is preserved on `err.causes`.
      const { TagWriteError } = await import('./mass-storage-tag-writer.js');
      let caught: unknown;
      try {
        await adapter.save();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TagWriteError);
      const tagErr = caught as InstanceType<typeof TagWriteError>;
      expect(tagErr.causes.length).toBeGreaterThan(0);
      expect(tagErr.message).toContain('FFmpeg exploded');
      expect(tagErr.name).toBe('TagWriteError');
    });

    test('comment set during addTrack is queued for persistence', async () => {
      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        tagWriter,
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        filetype: 'flac',
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });

      // Create the file so the tag writer has something to write to
      createFakeAudioFile(mountPoint, track.filePath);

      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.comment).toBe('[podkit:v1 quality=high encoding=vbr]');
    });

    test('replaceTrackFile queues comment write for the new file', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      // Set a sync tag on the track
      const track = adapter.getTracks()[0]!;
      const tagged = adapter.updateTrack(track, {
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });

      // Replace the file (simulating an upgrade — new file won't have the sync tag)
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'new-file.flac');
      fs.writeFileSync(sourcePath, 'new audio data');

      adapter.replaceTrackFile(tagged, sourcePath);

      // Clear the mock to isolate replaceTrackFile's queued write
      tagWriter.calls.length = 0;

      await adapter.save();

      // The old sync tag should be re-queued for the new file
      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.comment).toBe('[podkit:v1 quality=high encoding=vbr]');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('replaceTrackFile comment write is overwritten by subsequent updateTrack', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      // Set initial sync tag
      const track = adapter.getTracks()[0]!;
      const tagged = adapter.updateTrack(track, {
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });

      // Replace the file
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'new-file.flac');
      fs.writeFileSync(sourcePath, 'new audio data');

      const replaced = adapter.replaceTrackFile(tagged, sourcePath);

      // Executor sets a NEW sync tag after replacement
      adapter.updateTrack(replaced, {
        comment: '[podkit:v1 quality=medium encoding=cbr]',
      });

      tagWriter.calls.length = 0;
      await adapter.save();

      // Only the final sync tag should be written
      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.comment).toBe('[podkit:v1 quality=medium encoding=cbr]');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('replaceTrackFile with same extension replaces in place', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      expect(track.filePath).toBe('Music/Artist/Album/01 - Song.flac');

      // Replace with same extension
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'new-file.flac');
      fs.writeFileSync(sourcePath, 'new audio data');

      const replaced = adapter.replaceTrackFile(track, sourcePath);

      // Path should be unchanged
      expect(replaced.filePath).toBe('Music/Artist/Album/01 - Song.flac');
      expect(replaced.filetype).toBe('flac');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('replaceTrackFile with different extension renames path and cleans up old file', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.m4a');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.m4a': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      expect(track.filePath).toBe('Music/Artist/Album/01 - Song.m4a');

      // Replace with different extension (codec change: AAC → Opus)
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'transcoded.opus');
      fs.writeFileSync(sourcePath, 'opus audio data');

      const replaced = adapter.replaceTrackFile(track, sourcePath);

      // Path should have new extension
      expect(replaced.filePath).toBe('Music/Artist/Album/01 - Song.opus');
      expect(replaced.filetype).toBe('opus');

      // Old file should be deleted
      expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album/01 - Song.m4a'))).toBe(false);

      // New file should exist
      expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album/01 - Song.opus'))).toBe(true);

      // Track list should be updated
      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(1);
      expect(tracks[0]!.filePath).toBe('Music/Artist/Album/01 - Song.opus');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('replaceTrackFile with different extension updates bookkeeping sets', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.m4a');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.m4a': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      // First set a sync tag so there's a pending comment write
      const track = adapter.getTracks()[0]!;
      const tagged = adapter.updateTrack(track, {
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });

      // Replace with different extension
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'transcoded.opus');
      fs.writeFileSync(sourcePath, 'opus audio data');

      adapter.replaceTrackFile(tagged, sourcePath);

      // Save should write comment to the new path
      tagWriter.calls.length = 0;
      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      // The comment should be written to the new .opus file path
      expect(tagWriter.calls[0]!.filePath).toContain('01 - Song.opus');

      // Verify the manifest includes the new path, not the old
      const manifestPath = path.join(mountPoint, '.podkit', 'state.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.managedFiles).not.toContain('Music/Artist/Album/01 - Song.m4a');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('replaceTrackFile deduplicates when new path collides', async () => {
      // Create two files that would collide after extension change
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.m4a');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.opus');

      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.m4a': { title: 'Song', artist: 'Artist', album: 'Album' },
          '01 - Song.opus': { title: 'Song 2', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const tracks = adapter.getTracks();
      const m4aTrack = tracks.find((t) => t.filePath.endsWith('.m4a'))!;

      // Replace m4a with opus — but 01 - Song.opus already exists
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'transcoded.opus');
      fs.writeFileSync(sourcePath, 'opus audio data');

      const replaced = adapter.replaceTrackFile(m4aTrack, sourcePath);

      // Should be deduplicated (e.g., "01 - Song-1.opus")
      expect(replaced.filePath).not.toBe('Music/Artist/Album/01 - Song.opus');
      expect(replaced.filePath).toMatch(/01 - Song-\d+\.opus$/);

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    test('copyTrackFile updates track list with new instance', async () => {
      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        tagWriter,
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        filetype: 'flac',
      });

      expect(adapter.getTracks()[0]!.hasFile).toBe(false);

      // Create a source file
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'source.flac');
      fs.writeFileSync(sourcePath, 'audio data');

      const copied = adapter.copyTrackFile(track, sourcePath);

      // The track list should reflect the updated state
      expect(copied.hasFile).toBe(true);
      expect(adapter.getTracks()[0]!.hasFile).toBe(true);
      expect(adapter.getTracks()[0]!.size).toBe(copied.size);

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });
  });

  describe('ReplayGain coalescing', () => {
    /**
     * The refactor folded `pendingReplayGainWrites` into `pendingTagWrites`.
     * These tests pin the adapter-level queueing behaviour: when does a
     * `replaygain`-normalisation device queue a ReplayGain tag write, and
     * does it ride on the same writeTags call as a co-occurring textual
     * tag change?
     */
    const REPLAYGAIN_CAPABILITIES: DeviceCapabilities = {
      ...TEST_CAPABILITIES,
      audioNormalization: 'replaygain',
    };

    function createMockTagWriter(): TagWriter & {
      calls: Array<{ filePath: string; fields: TagFields }>;
    } {
      const calls: Array<{ filePath: string; fields: TagFields }> = [];
      return {
        calls,
        async writeTags(filePath: string, fields: TagFields) {
          calls.push({ filePath, fields });
        },
        async writePicture(_filePath: string, _imageData: Buffer) {},
      };
    }

    test('writeReplayGainTags=true with a normalization update queues a replayGain entry on a replaygain device', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');
      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, REPLAYGAIN_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, {
        writeReplayGainTags: true,
        normalization: { source: 'replaygain-track', trackGain: -7.42, trackPeak: 0.987 },
      });
      await adapter.save();

      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.replayGain).toBeDefined();
      expect(tagWriter.calls[0]!.fields.replayGain!.trackGain).toBeCloseTo(-7.42, 2);
    });

    test('textual + ReplayGain ride on a single writeTags call (one taglib roundtrip)', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');
      const tagWriter = createMockTagWriter();
      const adapter = await MassStorageAdapter.open(mountPoint, REPLAYGAIN_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, {
        title: 'New Title',
        writeReplayGainTags: true,
        normalization: { source: 'replaygain-track', trackGain: -5.0 },
      });
      await adapter.save();

      // One call, both kinds of update on it — the core claim of the refactor.
      expect(tagWriter.calls).toHaveLength(1);
      expect(tagWriter.calls[0]!.fields.title).toBe('New Title');
      expect(tagWriter.calls[0]!.fields.replayGain!.trackGain).toBeCloseTo(-5.0, 2);
    });

    test('does NOT queue ReplayGain on a non-replaygain device', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.flac');
      const tagWriter = createMockTagWriter();
      // Default TEST_CAPABILITIES has audioNormalization: 'none'.
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      adapter.updateTrack(track, {
        writeReplayGainTags: true,
        normalization: { source: 'replaygain-track', trackGain: -7.0 },
      });
      await adapter.save();

      // The replaygain gate refuses to queue when the device doesn't read RG.
      expect(tagWriter.calls).toHaveLength(0);
    });
  });

  describe('embedded picture writes', () => {
    function createMockTagWriterWithPicture(): TagWriter & {
      commentCalls: Array<{ filePath: string; comment: string }>;
      pictureCalls: Array<{ filePath: string; imageData: Buffer }>;
    } {
      const commentCalls: Array<{ filePath: string; comment: string }> = [];
      const pictureCalls: Array<{ filePath: string; imageData: Buffer }> = [];
      return {
        commentCalls,
        pictureCalls,
        async writeTags(filePath: string, fields: TagFields) {
          if (fields.comment !== undefined) {
            commentCalls.push({ filePath, comment: fields.comment });
          }
        },
        async writePicture(filePath: string, imageData: Buffer) {
          pictureCalls.push({ filePath, imageData });
        },
      };
    }

    test('updateTrack with embeddedPictureData queues a pending write', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.opus');

      const tagWriter = createMockTagWriterWithPicture();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.opus': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      const imageData = Buffer.from('fake-jpeg-data');
      adapter.updateTrack(track, { embeddedPictureData: imageData });

      // No writes yet — pending until save()
      expect(tagWriter.pictureCalls).toHaveLength(0);

      await adapter.save();

      expect(tagWriter.pictureCalls).toHaveLength(1);
      expect(tagWriter.pictureCalls[0]!.filePath).toBe(
        path.join(mountPoint, 'Music/Artist/Album/01 - Song.opus')
      );
      expect(tagWriter.pictureCalls[0]!.imageData).toBe(imageData);
    });

    test('save() with no pending picture writes does not call writePicture', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.opus');

      const tagWriter = createMockTagWriterWithPicture();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.opus': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      await adapter.save();

      expect(tagWriter.pictureCalls).toHaveLength(0);
    });

    test('replaceTrackFile updates pending picture write path', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - Song.m4a');

      const tagWriter = createMockTagWriterWithPicture();
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - Song.m4a': { title: 'Song', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const track = adapter.getTracks()[0]!;
      const imageData = Buffer.from('fake-jpeg-data');
      adapter.updateTrack(track, { embeddedPictureData: imageData });

      // Replace with a new file that has a different extension
      const sourceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podkit-test-'));
      const sourcePath = path.join(sourceDir, 'transcoded.opus');
      fs.writeFileSync(sourcePath, 'opus audio data');

      adapter.replaceTrackFile(track, sourcePath);

      await adapter.save();

      // Should write to the new path (.opus), not the old path (.m4a)
      expect(tagWriter.pictureCalls).toHaveLength(1);
      expect(tagWriter.pictureCalls[0]!.filePath).toContain('.opus');

      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // ---------------------------------------------------------------------
    // Save-failure behaviour pinning (doc-041 §4.2)
    //
    // Picture-write stage is collect-and-aggregate (mirrors the tag-write
    // stage). Closes doc-041 §3.1 / §3.5 picture-write inconsistencies.
    //
    // Current behaviour:
    //   - runWithConcurrency over all pending writes (no fail-fast)
    //   - all writes settle before failure check
    //   - pendingPictureWrites map IS cleared before throw
    //   - aggregate failure surfaces as `PictureWriteError`; per-file
    //     causes preserved on `err.causes`
    //   - next save() does NOT retry: rescan-driven re-queue is the
    //     retry path (matches the documented convention for tag writes)
    // ---------------------------------------------------------------------

    test('save() aggregates per-file picture-write failures into PictureWriteError', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01.opus');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/02.opus');

      const failingTagWriter: TagWriter = {
        async writeTags() {},
        async writePicture(filePath: string) {
          if (filePath.endsWith('01.opus')) {
            throw new Error('simulated picture-write failure for 01.opus');
          }
        },
      };

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01.opus': { title: 'One', artist: 'Artist', album: 'Album' },
          '02.opus': { title: 'Two', artist: 'Artist', album: 'Album' },
        }),
        tagWriter: failingTagWriter,
      });

      const [t1, t2] = adapter.getTracks();
      adapter.updateTrack(t1!, { embeddedPictureData: Buffer.from('one-bytes') });
      adapter.updateTrack(t2!, { embeddedPictureData: Buffer.from('two-bytes') });

      const { PictureWriteError } = await import('./mass-storage-tag-writer.js');
      let thrown: unknown;
      try {
        await adapter.save();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(PictureWriteError);
      const causes = (thrown as InstanceType<typeof PictureWriteError>).causes;
      expect(causes).toHaveLength(1);
      expect(causes[0]).toContain('01.opus');
      expect(causes[0]).toContain('simulated picture-write failure');
    });

    test('save() clears pendingPictureWrites before throw — rescan drives retry, not in-adapter', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01.opus');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/02.opus');

      const tagWriter: TagWriter & { pictureCalls: string[] } = {
        pictureCalls: [],
        async writeTags() {},
        async writePicture(filePath: string) {
          this.pictureCalls.push(filePath);
          if (filePath.endsWith('01.opus')) {
            throw new Error(`first attempt fails: ${filePath}`);
          }
        },
      };

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01.opus': { title: 'One', artist: 'Artist', album: 'Album' },
          '02.opus': { title: 'Two', artist: 'Artist', album: 'Album' },
        }),
        tagWriter,
      });

      const [t1, t2] = adapter.getTracks();
      adapter.updateTrack(t1!, { embeddedPictureData: Buffer.from('one-bytes') });
      adapter.updateTrack(t2!, { embeddedPictureData: Buffer.from('two-bytes') });

      await expect(adapter.save()).rejects.toThrow(/picture write failed/);
      // All writes were attempted before the failure was reported.
      expect(tagWriter.pictureCalls.length).toBe(2);
      const callsAfterFirst = tagWriter.pictureCalls.length;

      // Second save(): map was cleared, so no entries re-fire. The next sync's
      // rescan would re-detect the gap and re-queue — that's the retry path.
      await adapter.save();
      expect(tagWriter.pictureCalls.length).toBe(callsAfterFirst);
    });
  });

  // ---------------------------------------------------------------------------
  // Sidecar (peer cover.jpg) writes — sidecar-primary devices (rockbox)
  // ---------------------------------------------------------------------------
  //
  // The contract:
  //   - writeSidecar(track, bytes) queues by album dir (parent of filePath).
  //   - N siblings on one album collapse to a single queue entry.
  //   - save() Stage 4 writes <albumDir>/cover.jpg atomically (tmp + rename).
  //   - On rename failure, the typed SidecarWriteError aggregates per-album
  //     failures so the executor's error categorizer (instanceof check) can
  //     classify the failure as `copy` regardless of path-keyword heuristics.
  //   - The cover.jpg is registered in `managedFiles` so the manifest tracks
  //     it across sessions and a future doctor walk can recognise it as
  //     podkit-owned (rather than treating it as an unmanaged orphan).
  describe('sidecar artwork writes (TASK-370)', () => {
    const SIDECAR_CAPABILITIES: DeviceCapabilities = {
      artworkSources: ['sidecar', 'embedded'],
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['flac', 'mp3', 'aac', 'vorbis'],
      supportsVideo: false,
      audioNormalization: 'replaygain',
      supportsAlbumArtistBrowsing: true,
    };

    test('writeSidecar queues by album dir and flushes a single cover.jpg per album', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01 - One.flac');
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/02 - Two.flac');

      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01 - One.flac': { title: 'One', artist: 'Artist', album: 'Album' },
          '02 - Two.flac': { title: 'Two', artist: 'Artist', album: 'Album' },
        }),
      });

      const [t1, t2] = adapter.getTracks();
      const bytes = Buffer.from('jpeg-data');
      adapter.writeSidecar(t1!, bytes);
      // Sibling on the same album dir — should NOT produce a second write
      // (last write wins on the album-keyed map; same bytes by contract).
      adapter.writeSidecar(t2!, bytes);

      const coverPath = path.join(mountPoint, 'Music/Artist/Album/cover.jpg');
      // No write until save()
      expect(fs.existsSync(coverPath)).toBe(false);

      await adapter.save();

      expect(fs.existsSync(coverPath)).toBe(true);
      const written = fs.readFileSync(coverPath);
      expect(written.equals(bytes)).toBe(true);
      // The tmp file is renamed-away → no orphan tmp survives a clean save.
      expect(fs.existsSync(coverPath + '.podkit-tmp')).toBe(false);
    });

    test('writeSidecar adds cover.jpg to the manifest so doctor recognises it as podkit-managed', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01.flac');
      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01.flac': { title: 'One', artist: 'Artist', album: 'Album' },
        }),
      });

      adapter.writeSidecar(adapter.getTracks()[0]!, Buffer.from('jpeg'));
      await adapter.save();

      // Manifest must include the sidecar so a future scan does not flag it
      // as orphan and so cleanup can later remove it as a podkit artefact.
      const manifest = JSON.parse(
        fs.readFileSync(path.join(mountPoint, PODKIT_DIR, MANIFEST_FILE), 'utf-8')
      ) as { managedFiles: string[] };
      expect(manifest.managedFiles).toContain('Music/Artist/Album/cover.jpg');
    });

    test('save() throws typed SidecarWriteError on rename failure (other albums still wrote)', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/AlbumA/01.flac');
      createFakeAudioFile(mountPoint, 'Music/Artist/AlbumB/01.flac');

      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          // findByBasename: both files match '01.flac' (last wins) — replace
          // with per-path metadata via the full key.
          [path.join(mountPoint, 'Music/Artist/AlbumA/01.flac')]: {
            title: 'A1',
            artist: 'Artist',
            album: 'AlbumA',
          },
          [path.join(mountPoint, 'Music/Artist/AlbumB/01.flac')]: {
            title: 'B1',
            artist: 'Artist',
            album: 'AlbumB',
          },
        }),
      });

      const tracks = adapter.getTracks();
      const trackA = tracks.find((t) => t.album === 'AlbumA')!;
      const trackB = tracks.find((t) => t.album === 'AlbumB')!;
      adapter.writeSidecar(trackA, Buffer.from('A-bytes'));
      adapter.writeSidecar(trackB, Buffer.from('B-bytes'));

      // Mock fs.promises.rename to fail for AlbumA only. AlbumB's rename
      // succeeds, so we can assert the partial-success shape.
      const realRename = fs.promises.rename;
      const renameSpy = (oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> => {
        if (String(newPath).includes('AlbumA')) {
          return Promise.reject(new Error('simulated rename failure for AlbumA'));
        }
        return realRename(oldPath, newPath);
      };
      (fs.promises as { rename: typeof fs.promises.rename }).rename = renameSpy;

      try {
        const { SidecarWriteError } = await import('./mass-storage-tag-writer.js');
        let caught: unknown;
        try {
          await adapter.save();
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(SidecarWriteError);
        const sidecarErr = caught as InstanceType<typeof SidecarWriteError>;
        expect(sidecarErr.causes).toHaveLength(1);
        // Per-album context is preserved on `causes` for diagnostics.
        expect(sidecarErr.causes[0]).toContain('AlbumA');
        // AlbumB still landed despite AlbumA's failure — runWithConcurrency
        // settles all writes before inspecting failures, so a single album's
        // failure shouldn't black-hole the rest of the library.
        expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/AlbumB/cover.jpg'))).toBe(true);
        expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/AlbumA/cover.jpg'))).toBe(false);
      } finally {
        (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
      }
    });

    test('atomic write: rename failure cleans up its own .podkit-tmp (no orphan)', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01.flac');
      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01.flac': { title: 'One', artist: 'Artist', album: 'Album' },
        }),
      });
      adapter.writeSidecar(adapter.getTracks()[0]!, Buffer.from('jpeg'));

      const realRename = fs.promises.rename;
      (fs.promises as { rename: typeof fs.promises.rename }).rename = () =>
        Promise.reject(new Error('rename failure'));
      try {
        await expect(adapter.save()).rejects.toThrow();
        // The destination is untouched — never a torn write.
        const coverPath = path.join(mountPoint, 'Music/Artist/Album/cover.jpg');
        expect(fs.existsSync(coverPath)).toBe(false);
        // The tmp is cleaned up on failure so the next sync doesn't see an
        // orphan .podkit-tmp file (which would later become doctor noise).
        expect(fs.existsSync(coverPath + '.podkit-tmp')).toBe(false);
      } finally {
        (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
      }
    });

    test('sidecar flush respects DEFAULT_TAG_WRITE_CONCURRENCY cap (max-in-flight ≤ 16)', async () => {
      const { DEFAULT_TAG_WRITE_CONCURRENCY } = await import('./mass-storage-tag-writer.js');
      const ALBUM_COUNT = 50;

      // Create 50 albums each with one track so the adapter has 50 sidecar
      // entries to flush. Unique basenames avoid metadata-reader collisions.
      const metaMap: Record<string, { title: string; artist: string; album: string }> = {};
      for (let i = 0; i < ALBUM_COUNT; i++) {
        const relPath = `Music/Artist/Album${i}/01.flac`;
        createFakeAudioFile(mountPoint, relPath);
        metaMap[`Music/Artist/Album${i}/01.flac`] = {
          title: `Track ${i}`,
          artist: 'Artist',
          album: `Album ${i}`,
        };
      }

      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: async (filePath: string) => {
          const rel = path.relative(mountPoint, filePath);
          const meta = metaMap[rel] ?? { title: 'T', artist: 'A', album: 'X' };
          return {
            common: {
              title: meta.title,
              artist: meta.artist,
              album: meta.album,
              track: { no: null, of: null },
              disk: { no: null, of: null },
            },
            format: { duration: 180, bitrate: 320000, sampleRate: 44100, codec: 'flac' },
          };
        },
      });

      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(ALBUM_COUNT);
      const bytes = Buffer.from('jpeg-data');
      for (const track of tracks) {
        adapter.writeSidecar(track, bytes);
      }

      // Instrument fs.promises.rename to track max simultaneous in-flight
      // writes. rename() is the last step of each atomicWriteFileWithSync
      // call, so peak concurrency measured here reflects the true cap.
      let inFlight = 0;
      let maxInFlight = 0;
      const realRename = fs.promises.rename;
      (fs.promises as { rename: typeof fs.promises.rename }).rename = async (
        oldPath: fs.PathLike,
        newPath: fs.PathLike
      ): Promise<void> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so concurrently-running renames also reach the counter before
        // any of them finishes — this gives the most accurate peak reading.
        await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight--;
        return realRename(oldPath, newPath);
      };

      try {
        await adapter.save();
      } finally {
        (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
      }

      // All covers must have landed
      for (let i = 0; i < ALBUM_COUNT; i++) {
        expect(fs.existsSync(path.join(mountPoint, `Music/Artist/Album${i}/cover.jpg`))).toBe(true);
      }

      // Peak concurrency must not exceed the cap
      expect(maxInFlight).toBeGreaterThan(0);
      expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_TAG_WRITE_CONCURRENCY);
    });

    test('save() with no pending sidecar writes does not write a cover.jpg', async () => {
      createFakeAudioFile(mountPoint, 'Music/Artist/Album/01.flac');
      const adapter = await MassStorageAdapter.open(mountPoint, SIDECAR_CAPABILITIES, {
        metadataReader: createMockMetadataReader({
          '01.flac': { title: 'One', artist: 'Artist', album: 'Album' },
        }),
      });
      await adapter.save();
      expect(fs.existsSync(path.join(mountPoint, 'Music/Artist/Album/cover.jpg'))).toBe(false);
    });
  });

  describe('prunePhantomManifest()', () => {
    /**
     * Write a v1 manifest with the requested rows.
     */
    function seedManifest(rows: string[]): void {
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          managedFiles: rows,
          lastSync: new Date().toISOString(),
        })
      );
    }

    test('removes phantom rows + persists atomically + updates in-memory state', async () => {
      const present = 'Music/Artist/Album/01 - Song.flac';
      const phantomA = 'Music/Artist/Album/02 - Gone.flac';
      const phantomB = 'Music/Other/Solo/01 - Missing.mp3';

      // Only the present file actually exists on disk.
      createFakeAudioFile(mountPoint, present);
      seedManifest([present, phantomA, phantomB]);

      const reader = createMockMetadataReader({
        '01 - Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      const result = await adapter.prunePhantomManifest([phantomA, phantomB]);
      expect(result.pruned).toBe(2);
      expect(result.errors).toEqual([]);

      const manifestPath = path.join(mountPoint, PODKIT_DIR, MANIFEST_FILE);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.version).toBe(1);
      expect(manifest.managedFiles).toEqual([present]);

      // A subsequent save() must not regress the phantoms — in-memory state
      // was updated in lock-step with the rewrite.
      await adapter.save();
      const afterSave = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(afterSave.managedFiles).toEqual([present]);
    });

    test('empty paths list is a no-op', async () => {
      seedManifest([]);
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });
      const result = await adapter.prunePhantomManifest([]);
      expect(result).toEqual({ pruned: 0, errors: [] });
    });

    test('missing manifest file surfaces an error per requested path', async () => {
      // No seed — manifest doesn't exist.
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });
      const result = await adapter.prunePhantomManifest(['Music/ghost.m4a']);
      expect(result.pruned).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.path).toBe('Music/ghost.m4a');
    });

    test('preserves original manifest when rewrite fails (atomic semantics)', async () => {
      // Seed with two phantoms.
      const phantom = 'Music/ghost.m4a';
      const original = [phantom, 'Music/keep.m4a'];
      seedManifest(original);

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      // Replace the manifest file with a directory of the same name to make
      // the temp+rename step fail (rename would clobber a directory). The
      // original tree must remain intact afterwards.
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      const manifestPath = path.join(stateDir, MANIFEST_FILE);
      const savedRaw = fs.readFileSync(manifestPath, 'utf-8');

      // Make the parent directory read-only to force the atomic-write to fail
      // at the tmp-write step. The original `state.json` file inside must be
      // unchanged afterwards.
      fs.chmodSync(stateDir, 0o500);
      try {
        const result = await adapter.prunePhantomManifest([phantom]);
        expect(result.pruned).toBe(0);
        expect(result.errors.length).toBeGreaterThan(0);
      } finally {
        fs.chmodSync(stateDir, 0o755);
      }

      // Original manifest is intact.
      const afterRaw = fs.readFileSync(manifestPath, 'utf-8');
      expect(afterRaw).toBe(savedRaw);
    });

    test('refuses to rewrite an unrecognised manifest shape', async () => {
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, MANIFEST_FILE), JSON.stringify({ version: 99 }));

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });
      const result = await adapter.prunePhantomManifest(['Music/ghost.m4a']);
      expect(result.pruned).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error.message).toMatch(/Unrecognised manifest shape/);

      // File untouched.
      const raw = fs.readFileSync(path.join(stateDir, MANIFEST_FILE), 'utf-8');
      expect(JSON.parse(raw)).toEqual({ version: 99 });
    });
  });

  describe('v1 manifest', () => {
    test('v1 manifest recognizes managed files', async () => {
      // Write a v1 manifest with managed files
      const relPath = 'Music/Artist/Album/Song.flac';
      const stateDir = path.join(mountPoint, PODKIT_DIR);
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          managedFiles: [relPath],
          lastSync: new Date().toISOString(),
        })
      );

      // Create the audio file on disk
      createFakeAudioFile(mountPoint, relPath);

      const reader = createMockMetadataReader({
        'Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
      });

      // Track should be recognized as managed
      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(1);
      expect((tracks[0] as MassStorageTrack).managed).toBe(true);

      // Save should remain v1
      await adapter.save();

      const manifestPath = path.join(stateDir, MANIFEST_FILE);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.version).toBe(1);
      expect(manifest.managedFiles).toContain(relPath);
    });
  });

  describe('content path validation', () => {
    test('conflicting content paths rejected at open', async () => {
      await expect(
        MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
          metadataReader: createMockMetadataReader({}),
          contentPaths: { musicDir: 'Music', moviesDir: 'Music' },
        })
      ).rejects.toThrow(/conflict/);
    });
  });

  describe('content paths', () => {
    test('custom musicDir generates paths under custom prefix', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        contentPaths: { musicDir: 'MyMusic' },
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        filetype: 'flac',
      });

      expect(track.filePath).toBe('MyMusic/Artist/Album/01 - Song.flac');
    });

    test('empty musicDir (root) generates paths without prefix', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        contentPaths: { musicDir: '' },
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        trackNumber: 1,
        filetype: 'flac',
      });

      expect(track.filePath).toBe('Artist/Album/01 - Song.flac');
    });

    test('custom video dirs generate correct paths', async () => {
      const caps = { ...TEST_CAPABILITIES, supportsVideo: true };
      const adapter = await MassStorageAdapter.open(mountPoint, caps, {
        metadataReader: createMockMetadataReader({}),
        contentPaths: { moviesDir: 'Films', tvShowsDir: 'TV' },
      });

      const movie = adapter.addTrack({
        title: 'The Matrix',
        year: 1999,
        filetype: 'm4v',
        mediaType: 0x0002, // Movie
      });

      const tvShow = adapter.addTrack({
        title: 'Pilot',
        tvShow: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
        filetype: 'm4v',
        mediaType: 0x0040, // TVShow
      });

      expect(movie.filePath).toBe('Films/The Matrix (1999).m4v');
      expect(tvShow.filePath).toBe('TV/Breaking Bad/Season 1/S01E01 - Pilot.m4v');
    });

    test('legacy musicDir option still works', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
        musicDir: 'LegacyMusic',
      });

      const track = adapter.addTrack({
        title: 'Song',
        artist: 'Artist',
        filetype: 'flac',
      });

      expect(track.filePath).toStartWith('LegacyMusic/');
    });

    test('scans music from root when musicDir is empty', async () => {
      // Create audio file at root
      createFakeAudioFile(mountPoint, 'Artist/Album/Song.flac');

      const reader = createMockMetadataReader({
        'Song.flac': { title: 'Song', artist: 'Artist', album: 'Album' },
      });

      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: reader,
        contentPaths: { musicDir: '' },
      });

      const tracks = adapter.getTracks();
      expect(tracks).toHaveLength(1);
      expect(tracks[0]!.filePath).toBe('Artist/Album/Song.flac');
    });
  });
});

// =============================================================================
// Content Path Utility Tests
// =============================================================================

describe('normalizeContentDir', () => {
  test('strips leading slashes', () => {
    expect(normalizeContentDir('/Music')).toBe('Music');
    expect(normalizeContentDir('//Music')).toBe('Music');
  });

  test('strips trailing slashes', () => {
    expect(normalizeContentDir('Music/')).toBe('Music');
    expect(normalizeContentDir('Music//')).toBe('Music');
  });

  test('strips both leading and trailing slashes', () => {
    expect(normalizeContentDir('/Music/')).toBe('Music');
  });

  test('treats "." as root (empty string)', () => {
    expect(normalizeContentDir('.')).toBe('');
  });

  test('treats "/" as root (empty string)', () => {
    expect(normalizeContentDir('/')).toBe('');
  });

  test('treats empty string as root', () => {
    expect(normalizeContentDir('')).toBe('');
  });

  test('preserves nested paths', () => {
    expect(normalizeContentDir('Video/Movies')).toBe('Video/Movies');
  });
});

describe('normalizeContentPaths', () => {
  test('applies defaults for missing fields', () => {
    const result = normalizeContentPaths({});
    expect(result).toEqual(DEFAULT_CONTENT_PATHS);
  });

  test('overrides specific fields', () => {
    const result = normalizeContentPaths({ musicDir: 'MyMusic' });
    expect(result.musicDir).toBe('MyMusic');
    expect(result.moviesDir).toBe('Video/Movies');
    expect(result.tvShowsDir).toBe('Video/Shows');
  });

  test('normalizes provided values', () => {
    const result = normalizeContentPaths({ musicDir: '/Music/' });
    expect(result.musicDir).toBe('Music');
  });
});

describe('validateContentPaths', () => {
  test('accepts valid paths', () => {
    expect(() =>
      validateContentPaths({
        musicDir: 'Music',
        moviesDir: 'Video/Movies',
        tvShowsDir: 'Video/Shows',
      })
    ).not.toThrow();
  });

  test('rejects duplicate paths', () => {
    expect(() =>
      validateContentPaths({ musicDir: 'Music', moviesDir: 'Music', tvShowsDir: 'Video/Shows' })
    ).toThrow(/conflict/);
  });

  test('rejects when all resolve to root', () => {
    expect(() =>
      validateContentPaths({ musicDir: '', moviesDir: '', tvShowsDir: 'Shows' })
    ).toThrow(/conflict/);
  });
});

describe('generateTrackPath with custom musicDir', () => {
  test('uses custom musicDir prefix', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      trackNumber: 1,
      extension: '.flac',
      musicDir: 'MyMusic',
    });
    expect(result).toBe('MyMusic/Artist/Album/01 - Song.flac');
  });

  test('uses empty musicDir for root', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      trackNumber: 1,
      extension: '.flac',
      musicDir: '',
    });
    expect(result).toBe('Artist/Album/01 - Song.flac');
  });

  test('defaults to Music/ when musicDir not provided', () => {
    const result = generateTrackPath({
      artist: 'Artist',
      album: 'Album',
      title: 'Song',
      extension: '.flac',
    });
    expect(result).toBe('Music/Artist/Album/Song.flac');
  });
});

describe('generateVideoPath with custom dirs', () => {
  test('uses custom moviesDir for movies', () => {
    const result = generateVideoPath({
      title: 'The Matrix',
      contentType: 'movie',
      year: 1999,
      extension: '.m4v',
      moviesDir: 'Films',
    });
    expect(result).toBe('Films/The Matrix (1999).m4v');
  });

  test('uses custom tvShowsDir for TV shows', () => {
    const result = generateVideoPath({
      title: 'Pilot',
      contentType: 'tvshow',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
      extension: '.m4v',
      tvShowsDir: 'TV',
    });
    expect(result).toBe('TV/Breaking Bad/Season 1/S01E01 - Pilot.m4v');
  });

  test('empty moviesDir puts movies at root', () => {
    const result = generateVideoPath({
      title: 'Movie',
      contentType: 'movie',
      extension: '.m4v',
      moviesDir: '',
    });
    expect(result).toBe('Movie.m4v');
  });

  test('empty tvShowsDir puts shows at root', () => {
    const result = generateVideoPath({
      title: 'Pilot',
      contentType: 'tvshow',
      seriesTitle: 'Show',
      seasonNumber: 1,
      episodeNumber: 1,
      extension: '.m4v',
      tvShowsDir: '',
    });
    expect(result).toBe('Show/Season 1/S01E01 - Pilot.m4v');
  });

  test('defaults to Video/Movies and Video/Shows', () => {
    const movie = generateVideoPath({
      title: 'Movie',
      contentType: 'movie',
      extension: '.m4v',
    });
    expect(movie).toBe('Video/Movies/Movie.m4v');

    const tv = generateVideoPath({
      title: 'Pilot',
      contentType: 'tvshow',
      seriesTitle: 'Show',
      seasonNumber: 1,
      episodeNumber: 1,
      extension: '.m4v',
    });
    expect(tv).toBe('Video/Shows/Show/Season 1/S01E01 - Pilot.m4v');
  });
});
