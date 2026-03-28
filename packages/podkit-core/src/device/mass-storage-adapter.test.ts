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
import type { TagWriter } from './mass-storage-tag-writer.js';
import type { DeviceCapabilities } from './capabilities.js';
import {
  sanitizeFilename,
  generateTrackPath,
  deduplicatePath,
  padTrackNumber,
  PODKIT_DIR,
  MANIFEST_FILE,
} from './mass-storage-utils.js';

// =============================================================================
// Test helpers
// =============================================================================

/** Minimal device capabilities for testing */
const TEST_CAPABILITIES: DeviceCapabilities = {
  artworkSources: ['embedded'],
  artworkMaxResolution: 600,
  supportedAudioCodecs: ['flac', 'mp3', 'aac', 'ogg'],
  supportsVideo: false,
  audioNormalization: 'none',
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

  test('setArtwork() is a no-op', () => {
    const track = createTestTrack();
    const result = track.setArtwork('/some/image.jpg');
    expect(result).toBe(track);
  });

  test('setArtworkFromData() is a no-op', () => {
    const track = createTestTrack();
    const result = track.setArtworkFromData(Buffer.from('image'));
    expect(result).toBe(track);
  });

  test('removeArtwork() is a no-op', () => {
    const track = createTestTrack();
    const result = track.removeArtwork();
    expect(result).toBe(track);
  });
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

  describe('close()', () => {
    test('does not throw', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(() => adapter.close()).not.toThrow();
    });
  });

  describe('capabilities and mountPoint', () => {
    test('exposes capabilities', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(adapter.capabilities).toBe(TEST_CAPABILITIES);
    });

    test('exposes mountPoint', async () => {
      const adapter = await MassStorageAdapter.open(mountPoint, TEST_CAPABILITIES, {
        metadataReader: createMockMetadataReader({}),
      });

      expect(adapter.mountPoint).toBe(mountPoint);
    });
  });

  describe('sync tag persistence (comment tag writes)', () => {
    /** Mock tag writer that records all writeComment calls */
    function createMockTagWriter(): TagWriter & {
      calls: Array<{ filePath: string; comment: string }>;
    } {
      const calls: Array<{ filePath: string; comment: string }> = [];
      return {
        calls,
        async writeComment(filePath: string, comment: string) {
          calls.push({ filePath, comment });
        },
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
      expect(tagWriter.calls[0]!.comment).toBe('[podkit:v1 quality=high encoding=vbr]');
    });

    test('updateTrack without comment change does not queue a write', async () => {
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

      expect(tagWriter.calls).toHaveLength(0);
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
      expect(tagWriter.calls[0]!.comment).toBe('[podkit:v1 quality=high art=a1b2c3d4]');
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
      const comments = tagWriter.calls.map((c) => c.comment).sort();
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
        async writeComment() {
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

      await expect(adapter.save()).rejects.toThrow('FFmpeg exploded');
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
      expect(tagWriter.calls[0]!.comment).toBe('[podkit:v1 quality=high encoding=vbr]');
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
      expect(tagWriter.calls[0]!.comment).toBe('[podkit:v1 quality=high encoding=vbr]');

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
      expect(tagWriter.calls[0]!.comment).toBe('[podkit:v1 quality=medium encoding=cbr]');

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
});
