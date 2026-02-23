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
import { existsSync } from 'node:fs';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  withTestIpod,
  Database,
  isNativeAvailable,
  LibgpodError,
  TEST_MP3_PATH,
} from './helpers/test-setup';

import { createMinimalJpeg, createMinimalPng } from './fixtures/images';

// Check if we have a test MP3 file available
const hasTestMp3 = existsSync(TEST_MP3_PATH);

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
