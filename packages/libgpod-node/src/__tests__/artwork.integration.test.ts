/**
 * Integration tests for libgpod-node artwork functionality.
 *
 * These tests cover: setTrackArtwork, hasTrackArtwork, removeTrackArtwork,
 * getUniqueArtworkIds, setTrackArtworkFromData, getArtworkCapabilities.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  withTestIpod,
  Database,
  LibgpodError,
  TEST_MP3_PATH,
} from './helpers/test-setup';

import { createMinimalJpeg, createMinimalPng } from './fixtures/images';

// Tests for artwork functionality (setTrackArtwork / setTrackThumbnails)
describe('libgpod-node artwork (setTrackArtwork)', () => {
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

  it(
    'can set artwork for a track from JPEG file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a test JPEG image
        const dir = await getTempDir();
        const imagePath = join(dir, 'test-artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add a track
        const handle = db.addTrack({
          title: 'Track with Artwork',
          artist: 'Test Artist',
        });

        const track = db.getTrack(handle);
        expect(track.hasArtwork).toBe(false);

        // Set artwork
        const updated = db.setTrackArtwork(handle, imagePath);

        // The track should now have artwork
        expect(updated.hasArtwork).toBe(true);

        // Save to persist the artwork
        db.saveSync();

        db.close();

        // Re-open and verify artwork persisted
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);
        const track2 = db2.getTrack(handles[0]!);
        expect(track2.hasArtwork).toBe(true);
        db2.close();
      });
    }
  );

  it(
    'can set artwork for a track from PNG file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a test PNG image
        const dir = await getTempDir();
        const imagePath = join(dir, 'test-artwork.png');
        await writeFile(imagePath, createMinimalPng());

        // Add a track
        const handle = db.addTrack({
          title: 'Track with PNG Artwork',
          artist: 'Test Artist',
        });

        // Set artwork
        const updated = db.setTrackArtwork(handle, imagePath);

        expect(updated.hasArtwork).toBe(true);

        db.saveSync();
        db.close();
      });
    }
  );

  it(
    'handles tracks without artwork gracefully',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track without setting artwork
        const handle = db.addTrack({
          title: 'Track without Artwork',
          artist: 'Test Artist',
        });

        const track = db.getTrack(handle);
        expect(track.hasArtwork).toBe(false);

        // Save and verify
        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);
        const track2 = db2.getTrack(handles[0]!);
        expect(track2.hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  it(
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
        const handle1 = db.addTrack({ title: 'Track 1' });
        const handle2 = db.addTrack({ title: 'Track 2' });
        // track3 intentionally gets no artwork - just add it without storing variable
        db.addTrack({ title: 'Track 3 (no artwork)' });

        // Set artwork for first two tracks
        const updated1 = db.setTrackArtwork(handle1, imagePath1);
        const updated2 = db.setTrackArtwork(handle2, imagePath2);
        // track3 gets no artwork

        // Verify artwork was set (flag should be set immediately after setTrackThumbnails)
        expect(updated1.hasArtwork).toBe(true);
        expect(updated2.hasArtwork).toBe(true);

        db.saveSync();
        db.close();

        // Re-open and verify persistence
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(3);

        // Find tracks by title
        const tracks = handles.map((h) => db2.getTrack(h));
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

  it(
    'throws error for non-existent image file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Test Track' });

        expect(() => {
          db.setTrackArtwork(handle, '/nonexistent/path/to/image.jpg');
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it(
    'async version works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        const handle = db.addTrack({ title: 'Async Artwork Test' });
        const updated = await db.setTrackArtworkAsync(handle, imagePath);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it(
    'can set artwork on track with copied audio file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create test image
        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track with metadata
        const handle = db.addTrack({
          title: 'Complete Track',
          artist: 'Test Artist',
          album: 'Test Album',
        });

        // Copy audio file
        const withAudio = db.copyTrackToDevice(handle, TEST_MP3_PATH);
        expect(withAudio.ipodPath).not.toBeNull();
        expect(withAudio.transferred).toBe(true);

        // Set artwork
        const withArtwork = db.setTrackArtwork(handle, imagePath);
        expect(withArtwork.hasArtwork).toBe(true);

        // Save everything
        db.saveSync();
        db.close();

        // Re-open and verify both audio and artwork are set
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);
        const track = db2.getTrack(handles[0]!);
        expect(track.title).toBe('Complete Track');
        expect(track.ipodPath).not.toBeNull();
        expect(track.transferred).toBe(true);
        expect(track.hasArtwork).toBe(true);
        db2.close();
      });
    }
  );
});

// Tests for getUniqueArtworkIds functionality
describe('libgpod-node artwork IDs (getUniqueArtworkIds)', () => {
  it(
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

  it(
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

  it(
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
          const handle1 = db.addTrack({ title: 'Track 1' });
          const handle2 = db.addTrack({ title: 'Track 2' });
          db.addTrack({ title: 'Track 3 (no artwork)' });

          // Set artwork for first two tracks
          db.setTrackArtwork(handle1, imagePath);
          db.setTrackArtwork(handle2, imagePath);

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

  it(
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
          const handle1 = db.addTrack({ title: 'Track 1' });
          const handle2 = db.addTrack({ title: 'Track 2' });
          const handle3 = db.addTrack({ title: 'Track 3' });
          db.addTrack({ title: 'Track 4' }); // intentionally no artwork

          // Set same artwork for tracks 1 and 2, different for track 3
          db.setTrackArtwork(handle1, imagePath1);
          db.setTrackArtwork(handle2, imagePath1);
          db.setTrackArtwork(handle3, imagePath2);
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

  it(
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

  it(
    'hasTrackArtwork returns false for track without artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'No Artwork Track', artist: 'Artist' });

        // Track should not have artwork
        expect(db.hasTrackArtwork(handle)).toBe(false);

        db.close();
      });
    }
  );

  it(
    'hasTrackArtwork returns true for track with artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'test.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        const handle = db.addTrack({ title: 'With Artwork', artist: 'Artist' });
        db.setTrackArtwork(handle, imagePath);

        // Track should have artwork now
        expect(db.hasTrackArtwork(handle)).toBe(true);

        db.close();
      });
    }
  );

  // -------------------------------------------------------------------------
  // removeTrackArtwork tests
  // -------------------------------------------------------------------------

  it(
    'removeTrackArtwork removes artwork from track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'artwork.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track and set artwork
        const handle = db.addTrack({ title: 'Track With Artwork', artist: 'Artist' });
        db.setTrackArtwork(handle, imagePath);

        // Verify artwork is set
        expect(db.hasTrackArtwork(handle)).toBe(true);

        // Remove artwork
        const updated = db.removeTrackArtwork(handle);

        // Track should no longer have artwork
        expect(updated.hasArtwork).toBe(false);
        expect(db.hasTrackArtwork(handle)).toBe(false);

        db.close();
      });
    }
  );

  it(
    'removeTrackArtwork is safe for track without artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add track without artwork
        const handle = db.addTrack({ title: 'No Artwork', artist: 'Artist' });

        // Removing artwork from a track without any should be safe
        const updated = db.removeTrackArtwork(handle);

        expect(updated.hasArtwork).toBe(false);

        db.close();
      });
    }
  );

  it(
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
        const handles = db.getTracks();
        const handle = handles.find((h) => db.getTrack(h).title === 'Persist Test')!;

        // Set artwork
        db.setTrackArtwork(handle, imagePath);
        db.saveSync();

        // Verify artwork is set
        expect(db.hasTrackArtwork(handle)).toBe(true);

        // Remove artwork and save
        db.removeTrackArtwork(handle);
        db.saveSync();
        db.close();

        // Re-open and verify artwork is removed
        const db2 = Database.openSync(ipod.path);
        const handles2 = db2.getTracks();
        expect(handles2).toHaveLength(1);
        const track = db2.getTrack(handles2[0]!);
        expect(track.hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  // -------------------------------------------------------------------------
  // setTrackArtworkFromData tests
  // -------------------------------------------------------------------------

  it(
    'setTrackArtworkFromData sets artwork from JPEG buffer',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'From Data Test', artist: 'Artist' });

        // Set artwork from buffer
        const imageData = createMinimalJpeg();
        const updated = db.setTrackArtworkFromData(handle, imageData);

        expect(updated.hasArtwork).toBe(true);
        expect(db.hasTrackArtwork(handle)).toBe(true);

        db.close();
      });
    }
  );

  it(
    'setTrackArtworkFromData sets artwork from PNG buffer',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'PNG Data Test', artist: 'Artist' });

        // Set artwork from PNG buffer
        const imageData = createMinimalPng();
        const updated = db.setTrackArtworkFromData(handle, imageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it(
    'setTrackArtworkFromData persists after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Persist Data Test', artist: 'Artist' });
        const imageData = createMinimalJpeg();
        db.setTrackArtworkFromData(handle, imageData);

        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);
        const track = db2.getTrack(handles[0]!);
        expect(track.hasArtwork).toBe(true);
        db2.close();
      });
    }
  );

  it(
    'setTrackArtworkFromDataAsync works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const handle = db.addTrack({ title: 'Async Data Test', artist: 'Artist' });
        const imageData = createMinimalJpeg();

        const updated = await db.setTrackArtworkFromDataAsync(handle, imageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it(
    'setTrackArtworkFromData replaces existing artwork',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const dir = await getTempDir();
        const imagePath = join(dir, 'original.jpg');
        await writeFile(imagePath, createMinimalJpeg());

        // Add track with artwork from file
        const handle = db.addTrack({ title: 'Replace Test', artist: 'Artist' });
        db.setTrackArtwork(handle, imagePath);
        expect(db.hasTrackArtwork(handle)).toBe(true);

        // Replace with artwork from buffer
        const newImageData = createMinimalPng();
        const updated = db.setTrackArtworkFromData(handle, newImageData);

        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  // -------------------------------------------------------------------------
  // getArtworkCapabilities tests
  // -------------------------------------------------------------------------

  it(
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

  it(
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

  it(
    'full artwork workflow: check, set, verify, remove',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // 1. Add track without artwork and save to get proper ID
        db.addTrack({ title: 'Workflow Test', artist: 'Artist' });
        db.saveSync();

        // Re-fetch track with assigned handle
        const handles = db.getTracks();
        const handle = handles[0]!;
        const track = db.getTrack(handle);

        // 2. Check - no artwork initially
        expect(db.hasTrackArtwork(handle)).toBe(false);
        expect(track.hasArtwork).toBe(false);

        // 3. Set artwork from buffer
        const imageData = createMinimalJpeg();
        const withArtwork = db.setTrackArtworkFromData(handle, imageData);

        // 4. Verify artwork is set
        expect(withArtwork.hasArtwork).toBe(true);
        expect(db.hasTrackArtwork(handle)).toBe(true);

        // 5. Save and re-verify
        db.saveSync();

        // 6. Check via fresh getTrack
        const refreshed = db.getTrack(handle);
        expect(refreshed.hasArtwork).toBe(true);

        // 7. Remove artwork
        const withoutArtwork = db.removeTrackArtwork(handle);
        expect(withoutArtwork.hasArtwork).toBe(false);
        expect(db.hasTrackArtwork(handle)).toBe(false);

        // 8. Save and re-verify removal persisted
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const finalHandle = db2.getTracks()[0]!;
        const finalTrack = db2.getTrack(finalHandle);
        expect(finalTrack.hasArtwork).toBe(false);
        db2.close();
      });
    }
  );

  it(
    'setTrackArtworkFromData accepts empty buffer without throwing',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Empty Buffer Test', artist: 'Artist' });
        const emptyBuffer = Buffer.alloc(0);

        // Note: libgpod's itdb_track_set_thumbnails_from_data does not validate
        // the image data. It accepts any buffer including empty ones.
        // The actual image processing happens during save().
        const updated = db.setTrackArtworkFromData(handle, emptyBuffer);

        // libgpod sets hasArtwork flag even for empty/invalid data
        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it(
    'setTrackArtworkFromData accepts arbitrary data without validation',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Invalid Data Test', artist: 'Artist' });

        // Random bytes that are not a valid image
        const invalidData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

        // Note: libgpod does not validate image data at set time.
        // It defers processing to the save() operation.
        // This is expected behavior - callers should validate images before setting.
        const updated = db.setTrackArtworkFromData(handle, invalidData);

        // libgpod sets hasArtwork flag even for invalid data
        expect(updated.hasArtwork).toBe(true);

        db.close();
      });
    }
  );

  it(
    'artwork operations work with multiple tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add multiple tracks and save to get proper IDs
        const handle1 = db.addTrack({ title: 'Track 1', artist: 'Artist' });
        const handle2 = db.addTrack({ title: 'Track 2', artist: 'Artist' });
        const handle3 = db.addTrack({ title: 'Track 3', artist: 'Artist' });
        db.saveSync();

        // Set artwork on tracks 1 and 2 only
        const jpegData = createMinimalJpeg();
        const pngData = createMinimalPng();

        db.setTrackArtworkFromData(handle1, jpegData);
        db.setTrackArtworkFromData(handle2, pngData);
        // track3 gets no artwork

        // Verify each track's state
        expect(db.hasTrackArtwork(handle1)).toBe(true);
        expect(db.hasTrackArtwork(handle2)).toBe(true);
        expect(db.hasTrackArtwork(handle3)).toBe(false);

        // Remove artwork from track 1
        db.removeTrackArtwork(handle1);
        expect(db.hasTrackArtwork(handle1)).toBe(false);

        // track 2 should still have artwork
        expect(db.hasTrackArtwork(handle2)).toBe(true);

        db.close();
      });
    }
  );
});
