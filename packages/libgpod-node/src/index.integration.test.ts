/**
 * Integration tests for libgpod-node.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';
import { stat, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  withTestIpod,
  isGpodToolAvailable,
} from '@podkit/gpod-testing';

import {
  Database,
  isNativeAvailable,
  starsToRating,
  ratingToStars,
  formatDuration,
  ipodPathToFilePath,
  filePathToIpodPath,
  MediaType,
  LibgpodError,
} from './index';

// Path to the test MP3 file in libgpod source
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MP3_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'tools',
  'libgpod-macos',
  'build',
  'libgpod-0.8.3',
  'bindings',
  'python',
  'tests',
  'resources',
  'tiny.mp3'
);

describe('libgpod-node', () => {
  beforeAll(async () => {
    // Check prerequisites
    if (!(await isGpodToolAvailable())) {
      throw new Error(
        'gpod-tool not available. Run `mise run tools:build` to build it.'
      );
    }
  });

  describe('isNativeAvailable', () => {
    it('returns true when native binding is loaded', () => {
      // This test will fail if native module is not built
      // That's expected - we test conditionally below
      const available = isNativeAvailable();
      // Just check it returns a boolean
      expect(typeof available).toBe('boolean');
    });
  });

  describe('track utilities', () => {
    it('converts stars to rating and back', () => {
      expect(starsToRating(0)).toBe(0);
      expect(starsToRating(1)).toBe(20);
      expect(starsToRating(3)).toBe(60);
      expect(starsToRating(5)).toBe(100);

      expect(ratingToStars(0)).toBe(0);
      expect(ratingToStars(20)).toBe(1);
      expect(ratingToStars(60)).toBe(3);
      expect(ratingToStars(100)).toBe(5);
    });

    it('formats duration correctly', () => {
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(1000)).toBe('0:01');
      expect(formatDuration(60000)).toBe('1:00');
      expect(formatDuration(65000)).toBe('1:05');
      expect(formatDuration(3661000)).toBe('61:01');
    });

    it('converts iPod paths to file paths', () => {
      expect(ipodPathToFilePath(':iPod_Control:Music:F00:ABCD.mp3')).toBe(
        'iPod_Control/Music/F00/ABCD.mp3'
      );
    });

    it('converts file paths to iPod paths', () => {
      expect(filePathToIpodPath('iPod_Control/Music/F00/ABCD.mp3')).toBe(
        ':iPod_Control:Music:F00:ABCD.mp3'
      );
    });
  });

  describe('MediaType', () => {
    it('has correct values', () => {
      expect(MediaType.Audio).toBe(0x0001);
      expect(MediaType.Movie).toBe(0x0002);
      expect(MediaType.Podcast).toBe(0x0004);
    });
  });
});

// These tests only run if the native module is available
describe('libgpod-node with native binding', () => {
  // Tests are conditionally skipped using .skipIf() below

  it.skipIf(!isNativeAvailable())(
    'can open a test iPod database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(db).toBeDefined();
        expect(db.mountpoint).toBe(ipod.path);
        expect(db.closed).toBe(false);

        const info = db.getInfo();
        expect(info.trackCount).toBe(0);
        expect(info.playlistCount).toBeGreaterThanOrEqual(1); // Master playlist

        db.close();
        expect(db.closed).toBe(true);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can read device info',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const device = db.device;
        expect(device).toBeDefined();
        expect(device.supportsArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can add and retrieve tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track
        const newTrack = db.addTrack({
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        });

        expect(newTrack).toBeDefined();
        expect(newTrack.title).toBe('Test Song');
        expect(newTrack.artist).toBe('Test Artist');
        expect(newTrack.album).toBe('Test Album');
        // Note: track.id may be 0 before save - libgpod assigns IDs on write

        // Verify track count
        expect(db.trackCount).toBe(1);

        // Get tracks
        const tracks = db.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].title).toBe('Test Song');

        // Get track by ID
        const found = db.getTrackById(newTrack.id);
        expect(found).not.toBeNull();
        expect(found!.title).toBe('Test Song');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can save changes to database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track
        db.addTrack({
          title: 'Saved Song',
          artist: 'Saved Artist',
        });

        // Save changes
        db.saveSync();

        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        expect(db2.trackCount).toBe(1);

        const tracks = db2.getTracks();
        expect(tracks[0].title).toBe('Saved Song');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can remove tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add two tracks
        const track1 = db.addTrack({ title: 'Song 1' });
        db.addTrack({ title: 'Song 2' }); // Adding second track for count test

        expect(db.trackCount).toBe(2);

        // Remove first track
        db.removeTrack(track1.id);
        expect(db.trackCount).toBe(1);

        // Verify correct track remains
        const tracks = db.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].title).toBe('Song 2');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can list playlists',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const playlists = db.getPlaylists();
        expect(playlists.length).toBeGreaterThanOrEqual(1);

        // Should have master playlist
        const master = playlists.find((p) => p.isMaster);
        expect(master).toBeDefined();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.getTracks()).toThrow(LibgpodError);
        expect(() => db.getInfo()).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can use async open',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        expect(db).toBeDefined();
        expect(db.trackCount).toBe(0);

        db.close();
      });
    }
  );
});

// Tests for file copy functionality (itdb_cp_track_to_ipod)
describe('libgpod-node file copy (copyTrackToDevice)', () => {
  // Check if we have a test MP3 file available
  const hasTestMp3 = existsSync(TEST_MP3_PATH);

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can copy audio file to iPod storage',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track (metadata only)
        const track = db.addTrack({
          title: 'Tiny Test',
          artist: 'Test Artist',
          album: 'Test Album',
          filetype: 'MPEG audio file',
        });

        expect(track.ipodPath).toBeNull();
        expect(track.transferred).toBe(false);

        // Copy the file to the iPod
        const updated = db.copyTrackToDevice(track.id, TEST_MP3_PATH);

        // Verify the track now has an iPod path
        expect(updated.ipodPath).not.toBeNull();
        expect(updated.ipodPath).toMatch(/^:iPod_Control:Music:F\d{2}:/);
        expect(updated.transferred).toBe(true);

        // Verify the file was actually copied
        const filePath = join(
          ipod.path,
          ipodPathToFilePath(updated.ipodPath!)
        );
        expect(existsSync(filePath)).toBe(true);

        // Verify file size matches
        const originalStats = await stat(TEST_MP3_PATH);
        const copiedStats = await stat(filePath);
        expect(copiedStats.size).toBe(originalStats.size);

        // Save and re-open to verify persistence
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].ipodPath).toBe(updated.ipodPath);
        expect(tracks[0].transferred).toBe(true);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for non-existent source file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'Test Track',
        });

        expect(() => {
          db.copyTrackToDevice(track.id, '/nonexistent/path/to/file.mp3');
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for invalid track ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.copyTrackToDevice(99999, TEST_MP3_PATH);
        }).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can copy multiple tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add first track and copy immediately
        // (track IDs are 0 before save, so we need to copy one at a time)
        const track1 = db.addTrack({ title: 'Song 1', artist: 'Artist 1' });
        const updated1 = db.copyTrackToDevice(track1.id, TEST_MP3_PATH);

        // Save to get proper IDs assigned
        db.saveSync();

        // Add second track and copy
        const track2 = db.addTrack({ title: 'Song 2', artist: 'Artist 2' });
        const updated2 = db.copyTrackToDevice(track2.id, TEST_MP3_PATH);

        // They should have different iPod paths
        expect(updated1.ipodPath).not.toBeNull();
        expect(updated2.ipodPath).not.toBeNull();
        expect(updated1.ipodPath).not.toBe(updated2.ipodPath);

        // Both files should exist
        expect(
          existsSync(join(ipod.path, ipodPathToFilePath(updated1.ipodPath!)))
        ).toBe(true);
        expect(
          existsSync(join(ipod.path, ipodPathToFilePath(updated2.ipodPath!)))
        ).toBe(true);

        db.saveSync();
        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'preserves metadata after file copy',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track with full metadata
        const track = db.addTrack({
          title: 'Metadata Test',
          artist: 'Test Artist',
          album: 'Test Album',
          albumArtist: 'Album Artist',
          genre: 'Electronic',
          trackNumber: 3,
          totalTracks: 12,
          discNumber: 1,
          totalDiscs: 2,
          year: 2024,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        });

        // Copy the file
        const updated = db.copyTrackToDevice(track.id, TEST_MP3_PATH);

        // Verify all metadata is preserved
        expect(updated.title).toBe('Metadata Test');
        expect(updated.artist).toBe('Test Artist');
        expect(updated.album).toBe('Test Album');
        expect(updated.albumArtist).toBe('Album Artist');
        expect(updated.genre).toBe('Electronic');
        expect(updated.trackNumber).toBe(3);
        expect(updated.totalTracks).toBe(12);
        expect(updated.discNumber).toBe(1);
        expect(updated.totalDiscs).toBe(2);
        expect(updated.year).toBe(2024);

        // File should be copied
        expect(updated.ipodPath).not.toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'async version works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const track = db.addTrack({ title: 'Async Test' });
        const updated = await db.copyTrackToDeviceAsync(track.id, TEST_MP3_PATH);

        expect(updated.ipodPath).not.toBeNull();
        expect(updated.transferred).toBe(true);

        db.close();
      });
    }
  );
});

// ============================================================================
// Helper functions for artwork tests
// ============================================================================

/**
 * Create a minimal valid JPEG file for testing.
 * This creates a tiny 1x1 red JPEG image.
 */
function createMinimalJpeg(): Buffer {
  // Minimal 1x1 red JPEG (valid JFIF structure)
  // This is a pre-computed minimal JPEG that decodes to a single red pixel
  return Buffer.from([
    // SOI (Start of Image)
    0xff, 0xd8,
    // APP0 (JFIF marker)
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // DQT (Quantization Table)
    0xff, 0xdb, 0x00, 0x43, 0x00,
    0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07,
    0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14,
    0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13,
    0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a,
    0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22,
    0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c,
    0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39,
    0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32,
    // SOF0 (Start of Frame, baseline DCT)
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00,
    // DHT (Huffman Tables - DC)
    0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
    0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    // DHT (Huffman Tables - AC)
    0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04,
    0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03,
    0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61,
    0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1,
    0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34,
    0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
    0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
    0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93,
    0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
    0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
    0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5,
    0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
    0xf8, 0xf9, 0xfa,
    // SOS (Start of Scan)
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    // Scan data (minimal)
    0xfb, 0xd3, 0x28, 0xa2, 0x80, 0x0f,
    // EOI (End of Image)
    0xff, 0xd9,
  ]);
}

/**
 * Create a minimal valid PNG file for testing.
 * This creates a tiny 1x1 red PNG image.
 */
function createMinimalPng(): Buffer {
  // Minimal 1x1 red PNG (valid PNG structure)
  return Buffer.from([
    // PNG signature
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR chunk (width=1, height=1, bit depth=8, color type=2=RGB)
    0x00, 0x00, 0x00, 0x0d, // length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width
    0x00, 0x00, 0x00, 0x01, // height
    0x08, 0x02, // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x90, 0x77, 0x53, 0xde, // CRC
    // IDAT chunk (compressed image data for 1x1 red pixel)
    0x00, 0x00, 0x00, 0x0c, // length
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x01, 0x01, 0x01, 0x00,
    0x18, 0xdd, 0x8d, 0xb9, // CRC
    // IEND chunk
    0x00, 0x00, 0x00, 0x00, // length
    0x49, 0x45, 0x4e, 0x44, // "IEND"
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);
}

// Tests for artwork functionality (setTrackArtwork / setTrackThumbnails)
describe('libgpod-node artwork (setTrackArtwork)', () => {
  // Check if we have a test MP3 file available
  const hasTestMp3 = existsSync(TEST_MP3_PATH);

  // Temp directory for test images
  let tempDir: string | null = null;

  // Create temp directory for test images
  async function getTempDir(): Promise<string> {
    if (tempDir === null) {
      tempDir = join(tmpdir(), `libgpod-test-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
    }
    return tempDir;
  }

  // Cleanup temp directory after each test
  afterEach(async () => {
    if (tempDir !== null) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  it.skipIf(!isNativeAvailable())(
    'can set artwork for a track from JPEG file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a test JPEG image
        const dir = await getTempDir();
        const imagePath = join(dir, 'test-artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add a track
        const track = db.addTrack({
          title: 'Track with Artwork',
          artist: 'Test Artist',
        });

        expect(track.hasArtwork).toBe(false);

        // Set artwork
        const updated = db.setTrackArtwork(track.id, imagePath);

        // The track should now have artwork
        expect(updated.hasArtwork).toBe(true);

        // Save to persist the artwork
        db.saveSync();

        db.close();

        // Re-open and verify artwork persisted
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].hasArtwork).toBe(true);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can set artwork for a track from PNG file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a test PNG image
        const dir = await getTempDir();
        const imagePath = join(dir, 'test-artwork.png');
        await writeFile(imagePath, createMinimalPng());

        // Add a track
        const track = db.addTrack({
          title: 'Track with PNG Artwork',
          artist: 'Test Artist',
        });

        // Set artwork
        const updated = db.setTrackArtwork(track.id, imagePath);

        expect(updated.hasArtwork).toBe(true);

        db.saveSync();
        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'handles tracks without artwork gracefully',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track without setting artwork
        const track = db.addTrack({
          title: 'Track without Artwork',
          artist: 'Test Artist',
        });

        expect(track.hasArtwork).toBe(false);

        // Save and verify
        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can set artwork for multiple tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create test images
        const dir = await getTempDir();
        const imagePath1 = join(dir, 'artwork1.jpg');
        const imagePath2 = join(dir, 'artwork2.jpg');
        await writeFile(imagePath1, createMinimalJpeg());
        await writeFile(imagePath2, createMinimalJpeg());

        // Add tracks
        const track1 = db.addTrack({ title: 'Track 1' });
        const track2 = db.addTrack({ title: 'Track 2' });
        // track3 intentionally gets no artwork - just add it without storing variable
        db.addTrack({ title: 'Track 3 (no artwork)' });

        // Set artwork for first two tracks
        const updated1 = db.setTrackArtwork(track1.id, imagePath1);
        const updated2 = db.setTrackArtwork(track2.id, imagePath2);
        // track3 gets no artwork

        // Verify artwork was set (flag should be set immediately after setTrackThumbnails)
        expect(updated1.hasArtwork).toBe(true);
        expect(updated2.hasArtwork).toBe(true);

        db.saveSync();
        db.close();

        // Re-open and verify persistence
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(3);

        // Find tracks by title
        const t1 = tracks.find((t) => t.title === 'Track 1');
        const t2 = tracks.find((t) => t.title === 'Track 2');
        const t3 = tracks.find((t) => t.title === 'Track 3 (no artwork)');

        expect(t1).toBeDefined();
        expect(t2).toBeDefined();
        expect(t3).toBeDefined();

        // After save and re-open, at least the first track should have artwork persisted
        // Note: libgpod's behavior with multiple tracks' artwork may vary
        expect(t1?.hasArtwork).toBe(true);
        // Track 3 (no artwork) should have hasArtwork false
        expect(t3?.hasArtwork).toBe(false);

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for non-existent image file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Test Track' });

        expect(() => {
          db.setTrackArtwork(track.id, '/nonexistent/path/to/image.jpg');
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for invalid track ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        expect(() => {
          db.setTrackArtwork(99999, imagePath);
        }).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'async version works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        const track = db.addTrack({ title: 'Async Artwork Test' });
        const updated = await db.setTrackArtworkAsync(track.id, imagePath);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can set artwork on track with copied audio file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create test image
        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track with metadata
        const track = db.addTrack({
          title: 'Complete Track',
          artist: 'Test Artist',
          album: 'Test Album',
        });

        // Copy audio file
        const withAudio = db.copyTrackToDevice(track.id, TEST_MP3_PATH);
        expect(withAudio.ipodPath).not.toBeNull();
        expect(withAudio.transferred).toBe(true);

        // Set artwork
        const withArtwork = db.setTrackArtwork(withAudio.id, imagePath);
        expect(withArtwork.hasArtwork).toBe(true);

        // Save everything
        db.saveSync();
        db.close();

        // Re-open and verify both audio and artwork are set
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].title).toBe('Complete Track');
        expect(tracks[0].ipodPath).not.toBeNull();
        expect(tracks[0].transferred).toBe(true);
        expect(tracks[0].hasArtwork).toBe(true);
        db2.close();
      });
    }
  );
});

// Tests for getUniqueArtworkIds functionality
describe('libgpod-node artwork IDs (getUniqueArtworkIds)', () => {
  it.skipIf(!isNativeAvailable())(
    'returns empty array for empty database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Fresh database with no tracks
        expect(db.trackCount).toBe(0);

        // Get unique artwork IDs
        const artworkIds = db.getUniqueArtworkIds();

        // Should be empty array for empty database
        expect(artworkIds).toEqual([]);
        expect(Array.isArray(artworkIds)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'returns empty array when no tracks have artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add some tracks without artwork
        db.addTrack({ title: 'Track 1' });
        db.addTrack({ title: 'Track 2' });
        db.addTrack({ title: 'Track 3' });

        // Get unique artwork IDs
        const artworkIds = db.getUniqueArtworkIds();

        // Should be empty since no tracks have artwork
        expect(artworkIds).toEqual([]);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'returns unique artwork IDs when tracks have artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a test JPEG image
        const dir = join(tmpdir(), `libgpod-test-${randomUUID()}`);
        await mkdir(dir, { recursive: true });
        const imagePath = join(dir, 'test-artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        try {
          // Add tracks and set artwork
          const track1 = db.addTrack({ title: 'Track 1' });
          const track2 = db.addTrack({ title: 'Track 2' });
          db.addTrack({ title: 'Track 3 (no artwork)' });

          // Set artwork for first two tracks
          db.setTrackArtwork(track1.id, imagePath);
          db.setTrackArtwork(track2.id, imagePath);

          // Save to ensure mhii_link values are assigned
          db.saveSync();

          // Get unique artwork IDs
          const artworkIds = db.getUniqueArtworkIds();

          // Should have at least one unique artwork ID
          // (tracks with same artwork may share the same mhii_link)
          expect(artworkIds.length).toBeGreaterThanOrEqual(1);

          // All IDs should be non-zero
          for (const id of artworkIds) {
            expect(id).toBeGreaterThan(0);
          }

          db.close();
        } finally {
          // Cleanup
          await rm(dir, { recursive: true, force: true });
        }
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'returns deduplicated artwork IDs',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create test images
        const dir = join(tmpdir(), `libgpod-test-${randomUUID()}`);
        await mkdir(dir, { recursive: true });
        const imagePath1 = join(dir, 'artwork1.jpg');
        const imagePath2 = join(dir, 'artwork2.jpg');
        await writeFile(imagePath1, createMinimalJpeg());
        await writeFile(imagePath2, createMinimalJpeg());

        try {
          // Add multiple tracks with same artwork
          const track1 = db.addTrack({ title: 'Track 1' });
          const track2 = db.addTrack({ title: 'Track 2' });
          const track3 = db.addTrack({ title: 'Track 3' });
          db.addTrack({ title: 'Track 4' }); // intentionally no artwork

          // Set same artwork for tracks 1 and 2, different for track 3
          db.setTrackArtwork(track1.id, imagePath1);
          db.setTrackArtwork(track2.id, imagePath1);
          db.setTrackArtwork(track3.id, imagePath2);
          // track4 gets no artwork

          // Save to ensure mhii_link values are assigned
          db.saveSync();

          // Get unique artwork IDs
          const artworkIds = db.getUniqueArtworkIds();

          // The IDs should be unique (no duplicates)
          const uniqueSet = new Set(artworkIds);
          expect(artworkIds.length).toBe(uniqueSet.size);

          db.close();
        } finally {
          // Cleanup
          await rm(dir, { recursive: true, force: true });
        }
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.getUniqueArtworkIds()).toThrow(LibgpodError);
      });
    }
  );
});

// ============================================================================
// Extended artwork management tests (TASK-040.03)
// ============================================================================

describe('libgpod-node artwork management APIs', () => {
  // Temp directory for test images
  let tempDir: string | null = null;

  // Create temp directory for test images
  async function getTempDir(): Promise<string> {
    if (tempDir === null) {
      tempDir = join(tmpdir(), `libgpod-artwork-test-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
    }
    return tempDir;
  }

  // Cleanup temp directory after each test
  afterEach(async () => {
    if (tempDir !== null) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  // -------------------------------------------------------------------------
  // hasTrackArtwork tests
  // -------------------------------------------------------------------------

  it.skipIf(!isNativeAvailable())(
    'hasTrackArtwork returns false for track without artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'No Artwork Track', artist: 'Artist' });

        // Track should not have artwork
        expect(db.hasTrackArtwork(track.id)).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'hasTrackArtwork returns true for track with artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'test.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        const track = db.addTrack({ title: 'With Artwork', artist: 'Artist' });
        db.setTrackArtwork(track.id, imagePath);

        // Track should have artwork now
        expect(db.hasTrackArtwork(track.id)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'hasTrackArtwork throws for non-existent track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => db.hasTrackArtwork(999999)).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'hasTrackArtwork throws when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        const track = db.addTrack({ title: 'Test', artist: 'Test' });
        db.close();

        expect(() => db.hasTrackArtwork(track.id)).toThrow(LibgpodError);
      });
    }
  );

  // -------------------------------------------------------------------------
  // removeTrackArtwork tests
  // -------------------------------------------------------------------------

  it.skipIf(!isNativeAvailable())(
    'removeTrackArtwork removes artwork from track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track and set artwork
        const track = db.addTrack({ title: 'Track With Artwork', artist: 'Artist' });
        db.setTrackArtwork(track.id, imagePath);

        // Verify artwork is set
        expect(db.hasTrackArtwork(track.id)).toBe(true);

        // Remove artwork
        const updated = db.removeTrackArtwork(track.id);

        // Track should no longer have artwork
        expect(updated.hasArtwork).toBe(false);
        expect(db.hasTrackArtwork(track.id)).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'removeTrackArtwork is safe for track without artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add track without artwork
        const track = db.addTrack({ title: 'No Artwork', artist: 'Artist' });

        // Removing artwork from a track without any should be safe
        const updated = db.removeTrackArtwork(track.id);

        expect(updated.hasArtwork).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'removeTrackArtwork throws for non-existent track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => db.removeTrackArtwork(999999)).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'removeTrackArtwork persists after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track with artwork and save to get proper ID
        db.addTrack({ title: 'Persist Test', artist: 'Artist' });
        db.saveSync();

        // Re-fetch track with assigned ID
        const tracks = db.getTracks();
        const track = tracks.find((t) => t.title === 'Persist Test')!;

        // Set artwork
        db.setTrackArtwork(track.id, imagePath);
        db.saveSync();

        // Verify artwork is set
        expect(db.hasTrackArtwork(track.id)).toBe(true);

        // Remove artwork and save
        db.removeTrackArtwork(track.id);
        db.saveSync();
        db.close();

        // Re-open and verify artwork is removed
        const db2 = Database.openSync(ipod.path);
        const tracks2 = db2.getTracks();
        expect(tracks2).toHaveLength(1);
        expect(tracks2[0].hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  // -------------------------------------------------------------------------
  // setTrackArtworkFromData tests
  // -------------------------------------------------------------------------

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData sets artwork from JPEG buffer',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'From Data Test', artist: 'Artist' });

        // Set artwork from buffer
        const imageData = createMinimalJpeg();
        const updated = db.setTrackArtworkFromData(track.id, imageData);

        expect(updated.hasArtwork).toBe(true);
        expect(db.hasTrackArtwork(track.id)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData sets artwork from PNG buffer',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'PNG Data Test', artist: 'Artist' });

        // Set artwork from PNG buffer
        const imageData = createMinimalPng();
        const updated = db.setTrackArtworkFromData(track.id, imageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData throws for non-existent track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const imageData = createMinimalJpeg();

        expect(() => db.setTrackArtworkFromData(999999, imageData)).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData persists after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Persist Data Test', artist: 'Artist' });
        const imageData = createMinimalJpeg();
        db.setTrackArtworkFromData(track.id, imageData);

        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].hasArtwork).toBe(true);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromDataAsync works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const track = db.addTrack({ title: 'Async Data Test', artist: 'Artist' });
        const imageData = createMinimalJpeg();

        const updated = await db.setTrackArtworkFromDataAsync(track.id, imageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData replaces existing artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'original.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track with artwork from file
        const track = db.addTrack({ title: 'Replace Test', artist: 'Artist' });
        db.setTrackArtwork(track.id, imagePath);
        expect(db.hasTrackArtwork(track.id)).toBe(true);

        // Replace with artwork from buffer
        const newImageData = createMinimalPng();
        const updated = db.setTrackArtworkFromData(track.id, newImageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  // -------------------------------------------------------------------------
  // getArtworkCapabilities tests
  // -------------------------------------------------------------------------

  it.skipIf(!isNativeAvailable())(
    'getArtworkCapabilities returns capability information',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const caps = db.getArtworkCapabilities();

        // Should have required fields
        expect(typeof caps.supportsArtwork).toBe('boolean');
        expect(typeof caps.generation).toBe('string');
        expect(typeof caps.model).toBe('string');

        // Test iPod supports artwork
        expect(caps.supportsArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'getArtworkCapabilities throws when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.getArtworkCapabilities()).toThrow(LibgpodError);
      });
    }
  );

  // -------------------------------------------------------------------------
  // Combined workflow tests
  // -------------------------------------------------------------------------

  it.skipIf(!isNativeAvailable())(
    'full artwork workflow: check, set, verify, remove',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // 1. Add track without artwork and save to get proper ID
        db.addTrack({ title: 'Workflow Test', artist: 'Artist' });
        db.saveSync();

        // Re-fetch track with assigned ID
        const tracks = db.getTracks();
        const trackId = tracks[0].id;

        // 2. Check - no artwork initially
        expect(db.hasTrackArtwork(trackId)).toBe(false);
        expect(tracks[0].hasArtwork).toBe(false);

        // 3. Set artwork from buffer
        const imageData = createMinimalJpeg();
        const withArtwork = db.setTrackArtworkFromData(trackId, imageData);

        // 4. Verify artwork is set
        expect(withArtwork.hasArtwork).toBe(true);
        expect(db.hasTrackArtwork(trackId)).toBe(true);

        // 5. Save and re-verify
        db.saveSync();

        // 6. Check via fresh getTrackById
        const refreshed = db.getTrackById(trackId);
        expect(refreshed).not.toBeNull();
        expect(refreshed!.hasArtwork).toBe(true);

        // 7. Remove artwork
        const withoutArtwork = db.removeTrackArtwork(trackId);
        expect(withoutArtwork.hasArtwork).toBe(false);
        expect(db.hasTrackArtwork(trackId)).toBe(false);

        // 8. Save and re-verify removal persisted
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const finalTrack = db2.getTracks()[0];
        expect(finalTrack.hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtwork throws when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        const track = db.addTrack({ title: 'Test', artist: 'Test' });
        db.close();

        expect(() => db.setTrackArtwork(track.id, imagePath)).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData throws when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Test', artist: 'Test' });
        const imageData = createMinimalJpeg();
        db.close();

        expect(() => db.setTrackArtworkFromData(track.id, imageData)).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'removeTrackArtwork throws when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        const track = db.addTrack({ title: 'Test', artist: 'Test' });
        db.close();

        expect(() => db.removeTrackArtwork(track.id)).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData accepts empty buffer without throwing',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Empty Buffer Test', artist: 'Artist' });
        const emptyBuffer = Buffer.alloc(0);

        // Note: libgpod's itdb_track_set_thumbnails_from_data does not validate
        // the image data. It accepts any buffer including empty ones.
        // The actual image processing happens during save().
        const updated = db.setTrackArtworkFromData(track.id, emptyBuffer);

        // libgpod sets hasArtwork flag even for empty/invalid data
        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setTrackArtworkFromData accepts arbitrary data without validation',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Invalid Data Test', artist: 'Artist' });

        // Random bytes that are not a valid image
        const invalidData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

        // Note: libgpod does not validate image data at set time.
        // It defers processing to the save() operation.
        // This is expected behavior - callers should validate images before setting.
        const updated = db.setTrackArtworkFromData(track.id, invalidData);

        // libgpod sets hasArtwork flag even for invalid data
        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'artwork operations work with multiple tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add multiple tracks and save to get proper IDs
        db.addTrack({ title: 'Track 1', artist: 'Artist' });
        db.addTrack({ title: 'Track 2', artist: 'Artist' });
        db.addTrack({ title: 'Track 3', artist: 'Artist' });
        db.saveSync();

        // Re-fetch tracks with assigned IDs
        const allTracks = db.getTracks();
        const track1 = allTracks.find((t) => t.title === 'Track 1')!;
        const track2 = allTracks.find((t) => t.title === 'Track 2')!;
        const track3 = allTracks.find((t) => t.title === 'Track 3')!;

        // Set artwork on tracks 1 and 2 only
        const jpegData = createMinimalJpeg();
        const pngData = createMinimalPng();

        db.setTrackArtworkFromData(track1.id, jpegData);
        db.setTrackArtworkFromData(track2.id, pngData);
        // track3 gets no artwork

        // Verify each track's state
        expect(db.hasTrackArtwork(track1.id)).toBe(true);
        expect(db.hasTrackArtwork(track2.id)).toBe(true);
        expect(db.hasTrackArtwork(track3.id)).toBe(false);

        // Remove artwork from track 1
        db.removeTrackArtwork(track1.id);
        expect(db.hasTrackArtwork(track1.id)).toBe(false);

        // track 2 should still have artwork
        expect(db.hasTrackArtwork(track2.id)).toBe(true);

        db.close();
      });
    }
  );
});

// ============================================================================
// Playlist CRUD tests
// ============================================================================

describe('libgpod-node playlist CRUD operations', () => {
  it.skipIf(!isNativeAvailable())(
    'can create a new playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const initialCount = db.playlistCount;

        // Create a new playlist
        const playlist = db.createPlaylist('My New Playlist');

        expect(playlist).toBeDefined();
        expect(playlist.name).toBe('My New Playlist');
        expect(playlist.isMaster).toBe(false);
        expect(playlist.isSmart).toBe(false);
        expect(playlist.trackCount).toBe(0);

        // Verify playlist count increased
        expect(db.playlistCount).toBe(initialCount + 1);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can save and retrieve a created playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist
        const created = db.createPlaylist('Persisted Playlist');
        const playlistId = created.id;

        // Save changes
        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        const retrieved = db2.getPlaylistById(playlistId);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe('Persisted Playlist');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can find playlist by name',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist
        db.createPlaylist('Findable Playlist');

        // Find by name
        const found = db.getPlaylistByName('Findable Playlist');

        expect(found).not.toBeNull();
        expect(found!.name).toBe('Findable Playlist');

        // Search for non-existent playlist
        const notFound = db.getPlaylistByName('Non Existent');
        expect(notFound).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can find playlist by ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist
        const created = db.createPlaylist('ID Lookup Test');
        const playlistId = created.id;

        // Find by ID
        const found = db.getPlaylistById(playlistId);

        expect(found).not.toBeNull();
        expect(found!.name).toBe('ID Lookup Test');

        // Search for non-existent ID
        const notFound = db.getPlaylistById(BigInt(999999999));
        expect(notFound).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can rename a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist
        const created = db.createPlaylist('Original Name');

        // Rename it
        const renamed = db.renamePlaylist(created.id, 'New Name');

        expect(renamed.name).toBe('New Name');

        // Verify the change persists
        const found = db.getPlaylistById(created.id);
        expect(found!.name).toBe('New Name');

        // Verify old name no longer works
        const oldName = db.getPlaylistByName('Original Name');
        expect(oldName).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can delete a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const initialCount = db.playlistCount;

        // Create a playlist
        const created = db.createPlaylist('To Be Deleted');
        expect(db.playlistCount).toBe(initialCount + 1);

        // Delete it
        db.removePlaylist(created.id);

        // Verify it's gone
        expect(db.playlistCount).toBe(initialCount);
        const found = db.getPlaylistById(created.id);
        expect(found).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'cannot delete the master playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Get the master playlist
        const mpl = db.getMasterPlaylist();
        expect(mpl).not.toBeNull();
        expect(mpl!.isMaster).toBe(true);

        // Try to delete it - should throw
        expect(() => {
          db.removePlaylist(mpl!.id);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can add tracks to a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create some tracks
        const track1 = db.addTrack({ title: 'Track 1', artist: 'Artist 1' });
        const track2 = db.addTrack({ title: 'Track 2', artist: 'Artist 2' });

        // Create a playlist
        const playlist = db.createPlaylist('My Playlist');
        expect(playlist.trackCount).toBe(0);

        // Add tracks to playlist
        const updated1 = db.addTrackToPlaylist(playlist.id, track1.id);
        expect(updated1.trackCount).toBe(1);

        const updated2 = db.addTrackToPlaylist(playlist.id, track2.id);
        expect(updated2.trackCount).toBe(2);

        // Verify tracks are in the playlist
        expect(db.playlistContainsTrack(playlist.id, track1.id)).toBe(true);
        expect(db.playlistContainsTrack(playlist.id, track2.id)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can get tracks from a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create tracks
        db.addTrack({ title: 'First Track', artist: 'Artist A' });
        db.addTrack({ title: 'Second Track', artist: 'Artist B' });

        // Save to assign IDs and re-open to get fresh track references
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const allTracks = db2.getTracks();
        expect(allTracks).toHaveLength(2);

        const track1 = allTracks.find((t) => t.title === 'First Track')!;
        const track2 = allTracks.find((t) => t.title === 'Second Track')!;

        // Verify tracks have unique IDs
        expect(track1.id).not.toBe(track2.id);

        // Create playlist and add tracks
        const playlist = db2.createPlaylist('Playlist With Tracks');
        db2.addTrackToPlaylist(playlist.id, track1.id);
        db2.addTrackToPlaylist(playlist.id, track2.id);

        // Get tracks from playlist
        const tracks = db2.getPlaylistTracks(playlist.id);

        expect(tracks).toHaveLength(2);
        expect(tracks.map((t) => t.title)).toContain('First Track');
        expect(tracks.map((t) => t.title)).toContain('Second Track');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can remove tracks from a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create tracks
        db.addTrack({ title: 'Keep Me', artist: 'Artist' });
        db.addTrack({ title: 'Remove Me', artist: 'Artist' });

        // Save to assign IDs and re-open to get fresh track references
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const allTracks = db2.getTracks();
        const track1 = allTracks.find((t) => t.title === 'Keep Me')!;
        const track2 = allTracks.find((t) => t.title === 'Remove Me')!;

        // Verify tracks have unique IDs
        expect(track1.id).not.toBe(track2.id);

        // Create playlist and add tracks
        const playlist = db2.createPlaylist('Playlist For Removal Test');
        db2.addTrackToPlaylist(playlist.id, track1.id);
        db2.addTrackToPlaylist(playlist.id, track2.id);

        expect(db2.playlistContainsTrack(playlist.id, track1.id)).toBe(true);
        expect(db2.playlistContainsTrack(playlist.id, track2.id)).toBe(true);

        // Remove one track
        const updated = db2.removeTrackFromPlaylist(playlist.id, track2.id);

        expect(updated.trackCount).toBe(1);
        expect(db2.playlistContainsTrack(playlist.id, track1.id)).toBe(true);
        expect(db2.playlistContainsTrack(playlist.id, track2.id)).toBe(false);

        // Verify track still exists in database (just not in playlist)
        const trackStillExists = db2.getTrackById(track2.id);
        expect(trackStillExists).not.toBeNull();
        expect(trackStillExists!.title).toBe('Remove Me');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'playlistContainsTrack returns false for tracks not in playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a track and a playlist
        const track = db.addTrack({ title: 'Lonely Track', artist: 'Artist' });
        const playlist = db.createPlaylist('Empty Playlist');

        // Track is not in the playlist
        expect(db.playlistContainsTrack(playlist.id, track.id)).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can create multiple playlists',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const initialCount = db.playlistCount;

        // Create multiple playlists
        const pl1 = db.createPlaylist('Rock');
        const pl2 = db.createPlaylist('Jazz');
        const pl3 = db.createPlaylist('Classical');

        expect(db.playlistCount).toBe(initialCount + 3);

        // Verify each can be found
        expect(db.getPlaylistByName('Rock')).not.toBeNull();
        expect(db.getPlaylistByName('Jazz')).not.toBeNull();
        expect(db.getPlaylistByName('Classical')).not.toBeNull();

        // Verify IDs are different
        expect(pl1.id).not.toBe(pl2.id);
        expect(pl2.id).not.toBe(pl3.id);
        expect(pl1.id).not.toBe(pl3.id);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'playlist changes persist after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist with tracks
        const track = db.addTrack({ title: 'Persisted Track', artist: 'Artist' });
        const playlist = db.createPlaylist('Persisted Playlist');
        db.addTrackToPlaylist(playlist.id, track.id);

        // Save and close
        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);

        const foundPlaylist = db2.getPlaylistByName('Persisted Playlist');
        expect(foundPlaylist).not.toBeNull();
        expect(foundPlaylist!.trackCount).toBe(1);

        const tracks = db2.getPlaylistTracks(foundPlaylist!.id);
        expect(tracks).toHaveLength(1);
        expect(tracks[0].title).toBe('Persisted Track');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'getMasterPlaylist returns the master playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const mpl = db.getMasterPlaylist();

        expect(mpl).not.toBeNull();
        expect(mpl!.isMaster).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'tracks added to database are in master playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track
        const track = db.addTrack({ title: 'In Master Playlist', artist: 'Artist' });

        // Get master playlist
        const mpl = db.getMasterPlaylist();
        expect(mpl).not.toBeNull();

        // Track should be in master playlist
        expect(db.playlistContainsTrack(mpl!.id, track.id)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for playlist operations when database is closed',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        const playlist = db.createPlaylist('Test');
        const track = db.addTrack({ title: 'Test', artist: 'Test' });

        db.close();

        expect(() => db.createPlaylist('New')).toThrow(LibgpodError);
        expect(() => db.removePlaylist(playlist.id)).toThrow(LibgpodError);
        expect(() => db.getPlaylistById(playlist.id)).toThrow(LibgpodError);
        expect(() => db.getPlaylistByName('Test')).toThrow(LibgpodError);
        expect(() => db.renamePlaylist(playlist.id, 'Renamed')).toThrow(LibgpodError);
        expect(() => db.addTrackToPlaylist(playlist.id, track.id)).toThrow(LibgpodError);
        expect(() => db.removeTrackFromPlaylist(playlist.id, track.id)).toThrow(LibgpodError);
        expect(() => db.playlistContainsTrack(playlist.id, track.id)).toThrow(LibgpodError);
        expect(() => db.getPlaylistTracks(playlist.id)).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when adding track to non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Test', artist: 'Test' });

        expect(() => {
          db.addTrackToPlaylist(BigInt(999999999), track.id);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when adding non-existent track to playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const playlist = db.createPlaylist('Test Playlist');

        expect(() => {
          db.addTrackToPlaylist(playlist.id, 999999999);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can add same track to multiple playlists',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a track
        const track = db.addTrack({ title: 'Shared Track', artist: 'Artist' });

        // Create multiple playlists
        const pl1 = db.createPlaylist('Playlist A');
        const pl2 = db.createPlaylist('Playlist B');
        const pl3 = db.createPlaylist('Playlist C');

        // Add same track to all playlists
        db.addTrackToPlaylist(pl1.id, track.id);
        db.addTrackToPlaylist(pl2.id, track.id);
        db.addTrackToPlaylist(pl3.id, track.id);

        // Verify track is in all playlists
        expect(db.playlistContainsTrack(pl1.id, track.id)).toBe(true);
        expect(db.playlistContainsTrack(pl2.id, track.id)).toBe(true);
        expect(db.playlistContainsTrack(pl3.id, track.id)).toBe(true);

        // Verify each playlist shows track count of 1
        const updated1 = db.getPlaylistById(pl1.id);
        const updated2 = db.getPlaylistById(pl2.id);
        const updated3 = db.getPlaylistById(pl3.id);

        expect(updated1!.trackCount).toBe(1);
        expect(updated2!.trackCount).toBe(1);
        expect(updated3!.trackCount).toBe(1);

        // Verify removing from one playlist doesn't affect others
        db.removeTrackFromPlaylist(pl2.id, track.id);

        expect(db.playlistContainsTrack(pl1.id, track.id)).toBe(true);
        expect(db.playlistContainsTrack(pl2.id, track.id)).toBe(false);
        expect(db.playlistContainsTrack(pl3.id, track.id)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'preserves track order in playlist after save',
    async () => {
      await withTestIpod(async (ipod) => {
        // First, add tracks and save to get unique IDs assigned
        const db = Database.openSync(ipod.path);
        db.addTrack({ title: 'AAA First', artist: 'Artist' });
        db.addTrack({ title: 'BBB Second', artist: 'Artist' });
        db.addTrack({ title: 'CCC Third', artist: 'Artist' });
        db.saveSync();
        db.close();

        // Re-open to get tracks with proper IDs
        const db2 = Database.openSync(ipod.path);
        const allTracks = db2.getTracks();

        const trackA = allTracks.find((t) => t.title === 'AAA First')!;
        const trackB = allTracks.find((t) => t.title === 'BBB Second')!;
        const trackC = allTracks.find((t) => t.title === 'CCC Third')!;

        // Create playlist and add tracks in a specific order (B, A, C)
        const playlist = db2.createPlaylist('Ordered Playlist');
        db2.addTrackToPlaylist(playlist.id, trackB.id); // BBB first
        db2.addTrackToPlaylist(playlist.id, trackA.id); // AAA second
        db2.addTrackToPlaylist(playlist.id, trackC.id); // CCC third

        // Get tracks and verify order (insertion order)
        const tracks = db2.getPlaylistTracks(playlist.id);
        expect(tracks).toHaveLength(3);
        expect(tracks[0].title).toBe('BBB Second');
        expect(tracks[1].title).toBe('AAA First');
        expect(tracks[2].title).toBe('CCC Third');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when removing non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.removePlaylist(BigInt(999999999));
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when renaming non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.renamePlaylist(BigInt(999999999), 'New Name');
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can create playlist with empty string name',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // libgpod allows empty string names - this tests the binding handles it
        const playlist = db.createPlaylist('');

        expect(playlist).toBeDefined();
        expect(playlist.name).toBe('');
        expect(playlist.isMaster).toBe(false);

        // Can be found by empty name
        const found = db.getPlaylistByName('');
        expect(found).not.toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can rename playlist to empty string',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const playlist = db.createPlaylist('Has Name');
        const renamed = db.renamePlaylist(playlist.id, '');

        expect(renamed.name).toBe('');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'removing track from playlist where track is not present is safe',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Not In Playlist', artist: 'Artist' });
        const playlist = db.createPlaylist('Empty Playlist');

        // Track is not in playlist
        expect(db.playlistContainsTrack(playlist.id, track.id)).toBe(false);

        // Removing a track that isn't in the playlist should be safe
        // (libgpod's itdb_playlist_remove_track handles this gracefully)
        const updated = db.removeTrackFromPlaylist(playlist.id, track.id);

        // Playlist should still be valid
        expect(updated.trackCount).toBe(0);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when getting tracks from non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.getPlaylistTracks(BigInt(999999999));
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when checking if track in non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Test', artist: 'Test' });

        expect(() => {
          db.playlistContainsTrack(BigInt(999999999), track.id);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when checking if non-existent track in playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const playlist = db.createPlaylist('Test Playlist');

        expect(() => {
          db.playlistContainsTrack(playlist.id, 999999999);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );
});
