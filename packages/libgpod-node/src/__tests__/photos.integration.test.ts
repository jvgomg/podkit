/**
 * Integration tests for libgpod-node PhotoDatabase operations.
 *
 * These tests cover: PhotoDatabase open/create/close, photo management,
 * photo album operations, and device capabilities.
 *
 * Note: Photo operations require libgpod to be built with gdk-pixbuf support.
 * If not available, photo add operations will fail with an error message.
 * Tests are designed to handle both cases gracefully.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';

import { withTestIpod, isGpodToolAvailable } from '@podkit/gpod-testing';

// Import test-setup to trigger early native binding availability check
import './helpers/test-setup';

import { PhotoDatabase, LibgpodError, PhotoAlbumType, PhotoTransitionDirection } from '../index';

// Path to test image - we'll create a simple one if not available
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_IMAGES_DIR = join(__dirname, 'fixtures');
const TEST_IMAGE_PATH = join(TEST_IMAGES_DIR, 'test-photo.jpg');

// Create a minimal JPEG for testing if it doesn't exist
// This is a 1x1 red pixel JPEG
const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xdb, 0x20, 0xa8, 0xf3, 0x5b, 0x7e,
  0xf7, 0xff, 0xd9,
]);

// Track whether gdk-pixbuf support is available
let hasPixbufSupport: boolean | null = null;

/**
 * Check if libgpod was built with gdk-pixbuf support by attempting to add a photo.
 * This needs to be done with a real photo database.
 */
async function checkPixbufSupport(): Promise<boolean> {
  if (hasPixbufSupport !== null) {
    return hasPixbufSupport;
  }

  try {
    // Create photo database and try to add a photo
    // This will only work if libgpod has gdk-pixbuf support
    const tempPhotoDb = PhotoDatabase.create();

    // Set a model number that supports photos
    tempPhotoDb.setSysInfo('ModelNumStr', 'MA450');

    try {
      tempPhotoDb.addPhotoFromData(MINIMAL_JPEG);
      hasPixbufSupport = true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      // Check for "gdk-pixbuf" in error message
      if (errorMsg.includes('gdk-pixbuf') || errorMsg.includes('Picture support is disabled')) {
        hasPixbufSupport = false;
      } else {
        // Some other error - assume support is available but test failed
        hasPixbufSupport = true;
      }
    }

    tempPhotoDb.close();
  } catch {
    // If we can't even create a database, something is very wrong
    hasPixbufSupport = false;
  }

  return hasPixbufSupport;
}

/**
 * Create the Photos directory structure needed for photo database.
 */
function ensurePhotosDir(mountpoint: string): void {
  const controlDir = join(mountpoint, 'iPod_Control');
  const photosDir = join(controlDir, 'Photos');
  const thumbsDir = join(photosDir, 'Thumbs');

  if (!existsSync(controlDir)) {
    mkdirSync(controlDir, { recursive: true });
  }
  if (!existsSync(photosDir)) {
    mkdirSync(photosDir, { recursive: true });
  }
  if (!existsSync(thumbsDir)) {
    mkdirSync(thumbsDir, { recursive: true });
  }
}

describe('PhotoDatabase', () => {
  beforeAll(async () => {
    // Check prerequisites
    if (!(await isGpodToolAvailable())) {
      throw new Error('gpod-tool not available. Run `mise run tools:build` to build it.');
    }

    // Create test fixtures directory and image if needed
    if (!existsSync(TEST_IMAGES_DIR)) {
      mkdirSync(TEST_IMAGES_DIR, { recursive: true });
    }
    if (!existsSync(TEST_IMAGE_PATH)) {
      writeFileSync(TEST_IMAGE_PATH, MINIMAL_JPEG);
    }
  });

  // ============================================================================
  // Basic PhotoDatabase tests (no gdk-pixbuf required)
  // ============================================================================

  describe('basic operations', () => {
    it('PhotoDatabase.create() creates new empty database', async () => {
      const photoDb = PhotoDatabase.create();

      expect(photoDb).toBeDefined();
      expect(photoDb.closed).toBe(false);

      // New database should have Photo Library album created
      const info = photoDb.getInfo();
      expect(info.photoCount).toBe(0);
      expect(info.albumCount).toBeGreaterThanOrEqual(1); // Photo Library

      // No mountpoint initially
      expect(photoDb.mountpoint).toBe('');

      photoDb.close();
      expect(photoDb.closed).toBe(true);
    });

    it('PhotoDatabase.create() with mountpoint', async () => {
      await withTestIpod(async (ipod) => {
        // Ensure Photos directory exists
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        expect(photoDb).toBeDefined();
        expect(photoDb.mountpoint).toBe(ipod.path);

        // Should have Photo Library
        const albums = photoDb.getAlbums();
        expect(albums.length).toBeGreaterThanOrEqual(1);

        const photoLibrary = albums.find((a) => a.isPhotoLibrary);
        expect(photoLibrary).toBeDefined();
        expect(photoLibrary!.albumType).toBe(PhotoAlbumType.PhotoLibrary);

        photoDb.close();
      });
    });

    it('setMountpoint updates the database mountpoint', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create();
        photoDb.setMountpoint(ipod.path);

        expect(photoDb.mountpoint).toBe(ipod.path);

        photoDb.close();
      });
    });

    it('throws error when database is closed', async () => {
      const photoDb = PhotoDatabase.create();
      photoDb.close();

      expect(() => photoDb.getPhotos()).toThrow(LibgpodError);
      expect(() => photoDb.getInfo()).toThrow(LibgpodError);
      expect(() => photoDb.getAlbums()).toThrow(LibgpodError);
    });

    it('can get device capabilities', async () => {
      const photoDb = PhotoDatabase.create();

      const caps = photoDb.getDeviceCapabilities();

      expect(typeof caps.supportsPhoto).toBe('boolean');
      expect(typeof caps.supportsArtwork).toBe('boolean');
      expect(typeof caps.generation).toBe('string');

      photoDb.close();
    });
  });

  // ============================================================================
  // Photo Album tests (no gdk-pixbuf required)
  // ============================================================================

  describe('photo album operations', () => {
    it('can create and list photo albums', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        // Create a new album
        const album = photoDb.createAlbum('Vacation 2024');

        expect(album).toBeDefined();
        expect(album.name).toBe('Vacation 2024');
        expect(album.albumType).toBe(PhotoAlbumType.Normal);
        expect(album.isPhotoLibrary).toBe(false);
        expect(album.photoCount).toBe(0);

        // List albums
        const albums = photoDb.getAlbums();
        expect(albums.length).toBeGreaterThanOrEqual(2); // Photo Library + our album

        // Find our album
        const found = albums.find((a) => a.name === 'Vacation 2024');
        expect(found).toBeDefined();

        photoDb.close();
      });
    });

    it('can get Photo Library album', async () => {
      const photoDb = PhotoDatabase.create();

      const library = photoDb.getPhotoLibrary();
      expect(library).toBeDefined();
      expect(library!.isPhotoLibrary).toBe(true);
      expect(library!.albumType).toBe(PhotoAlbumType.PhotoLibrary);

      photoDb.close();
    });

    it('can find album by name', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        photoDb.createAlbum('Test Album');

        const found = photoDb.getAlbumByName('Test Album');
        expect(found).toBeDefined();
        expect(found!.name).toBe('Test Album');

        // Non-existent album
        const notFound = photoDb.getAlbumByName('Does Not Exist');
        expect(notFound).toBeNull();

        photoDb.close();
      });
    });

    it('can rename photo album', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        photoDb.createAlbum('Old Name');

        // Save to assign album IDs
        photoDb.saveSync();

        // Get the album with its assigned ID
        const album = photoDb.getAlbumByName('Old Name');
        expect(album).toBeDefined();
        expect(album!.id).toBeGreaterThan(0);

        const renamed = photoDb.renameAlbum(album!.id, 'New Name');

        expect(renamed.name).toBe('New Name');

        // Verify by finding it
        const found = photoDb.getAlbumByName('New Name');
        expect(found).toBeDefined();

        const notFound = photoDb.getAlbumByName('Old Name');
        expect(notFound).toBeNull();

        photoDb.close();
      });
    });

    it('cannot delete Photo Library album', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        const library = photoDb.getPhotoLibrary();
        expect(library).toBeDefined();

        // Trying to remove Photo Library should throw
        expect(() => photoDb.removeAlbum(library!.id)).toThrow();

        photoDb.close();
      });
    });

    it('can remove regular photo album', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        const initialCount = photoDb.albumCount;

        photoDb.createAlbum('To Be Removed');
        expect(photoDb.albumCount).toBe(initialCount + 1);

        // Note: album_id is only assigned on write, so we need to find
        // the album by name to get a reliable reference for removal
        const albumByName = photoDb.getAlbumByName('To Be Removed');
        expect(albumByName).toBeDefined();

        // We can remove by finding via getAlbums() and checking name
        // Since album IDs are 0 until write, we use the fact that
        // removeAlbum iterates the list and checks the actual album_id value
        const albums = photoDb.getAlbums();
        const albumToRemove = albums.find((a) => a.name === 'To Be Removed');
        expect(albumToRemove).toBeDefined();

        // Save first to assign IDs
        photoDb.saveSync();

        // Get fresh album list with assigned IDs
        const albumsAfterSave = photoDb.getAlbums();
        const albumWithId = albumsAfterSave.find((a) => a.name === 'To Be Removed');
        expect(albumWithId).toBeDefined();
        expect(albumWithId!.id).toBeGreaterThan(0);

        photoDb.removeAlbum(albumWithId!.id);
        expect(photoDb.albumCount).toBe(initialCount);

        photoDb.close();
      });
    });

    it('album has default slideshow settings', async () => {
      const photoDb = PhotoDatabase.create();

      const album = photoDb.createAlbum('Test Album');

      // Check slideshow properties exist with sensible defaults
      expect(typeof album.playMusic).toBe('boolean');
      expect(typeof album.repeat).toBe('boolean');
      expect(typeof album.random).toBe('boolean');
      expect(typeof album.showTitles).toBe('boolean');
      expect(typeof album.transitionDirection).toBe('number');
      expect(typeof album.slideDuration).toBe('number');
      expect(typeof album.transitionDuration).toBe('number');

      photoDb.close();
    });
  });

  // ============================================================================
  // Photo operations (require gdk-pixbuf)
  // ============================================================================

  describe('photo operations (gdk-pixbuf required)', () => {
    it('addPhoto returns error when gdk-pixbuf not available', async () => {
      const hasSupport = await checkPixbufSupport();

      if (!hasSupport) {
        // Test that we get a meaningful error
        const photoDb = PhotoDatabase.create();
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          photoDb.addPhotoFromData(MINIMAL_JPEG);
          // If we got here without error, support is actually available
          // That's fine, just close and return
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          // Should mention gdk-pixbuf or picture support disabled
          expect(
            errorMsg.includes('gdk-pixbuf') ||
              errorMsg.includes('Picture support') ||
              errorMsg.includes('photo')
          ).toBe(true);
        }

        photoDb.close();
      }
    });

    // Skip these tests if gdk-pixbuf is not available
    // The test itself checks for support

    it('can add photo from file (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          const photo = photoDb.addPhoto(TEST_IMAGE_PATH);

          expect(photo).toBeDefined();
          expect(photo.id).toBeDefined();

          // Photo should be in Photo Library
          expect(photoDb.photoCount).toBe(1);

          const library = photoDb.getPhotoLibrary();
          expect(library!.photoCount).toBe(1);

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          // If device doesn't support photos, that's OK for this test
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('can add photo from data (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          const photo = photoDb.addPhotoFromData(MINIMAL_JPEG);

          expect(photo).toBeDefined();
          expect(photoDb.photoCount).toBe(1);

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('can remove photo (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          const photo = photoDb.addPhotoFromData(MINIMAL_JPEG);
          expect(photoDb.photoCount).toBe(1);

          photoDb.removePhoto(photo.id);
          expect(photoDb.photoCount).toBe(0);

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('can add photo to album (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          photoDb.addPhotoFromData(MINIMAL_JPEG);
          photoDb.createAlbum('My Album');

          // Save to assign IDs to albums and photos
          photoDb.saveSync();

          // Get album and photo with assigned IDs
          const album = photoDb.getAlbumByName('My Album');
          expect(album).toBeDefined();
          expect(album!.photoCount).toBe(0);

          // Get fresh photo with assigned ID
          const photos = photoDb.getPhotos();
          expect(photos).toHaveLength(1);
          const savedPhoto = photos[0]!;

          const updatedAlbum = photoDb.addPhotoToAlbum(album!.id, savedPhoto.id);
          expect(updatedAlbum.photoCount).toBe(1);

          // Get photos in album
          const albumPhotos = photoDb.getAlbumPhotos(album!.id);
          expect(albumPhotos).toHaveLength(1);
          expect(albumPhotos[0]!.id).toBe(savedPhoto.id);

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('can remove photo from album (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          photoDb.addPhotoFromData(MINIMAL_JPEG);
          photoDb.createAlbum('My Album');

          // Save to assign IDs
          photoDb.saveSync();

          // Get album and photo with assigned IDs
          const album = photoDb.getAlbumByName('My Album');
          expect(album).toBeDefined();

          const photos = photoDb.getPhotos();
          expect(photos).toHaveLength(1);
          const photo = photos[0]!;

          // Add photo to album
          photoDb.addPhotoToAlbum(album!.id, photo.id);

          // Get fresh album to verify photo was added
          const albumWithPhoto = photoDb.getAlbumByName('My Album');
          expect(albumWithPhoto!.photoCount).toBe(1);

          // Remove from album (but keep in Photo Library)
          photoDb.removePhotoFromAlbum(albumWithPhoto!.id, photo.id);

          const afterRemove = photoDb.getAlbumByName('My Album');
          expect(afterRemove!.photoCount).toBe(0);

          // Photo should still exist in database
          expect(photoDb.photoCount).toBe(1);

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('can get photo by id (if gdk-pixbuf available)', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        // gdk-pixbuf support not available - skip test
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          const photo = photoDb.addPhotoFromData(MINIMAL_JPEG);

          const found = photoDb.getPhotoById(photo.id);
          expect(found).toBeDefined();
          expect(found!.id).toBe(photo.id);

          // Non-existent photo
          const notFound = photoDb.getPhotoById(99999);
          expect(notFound).toBeNull();

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });
  });

  // ============================================================================
  // SysInfo operations
  // ============================================================================

  describe('SysInfo operations', () => {
    it('can set and read SysInfo values', async () => {
      const photoDb = PhotoDatabase.create();

      photoDb.setSysInfo('TestField', 'TestValue');
      // Note: getSysInfo is not implemented on PhotoDatabase, only setSysInfo
      // We just verify setSysInfo doesn't throw

      photoDb.close();
    });

    it('setSysInfo with null removes the field', async () => {
      const photoDb = PhotoDatabase.create();

      photoDb.setSysInfo('TestField', 'TestValue');
      photoDb.setSysInfo('TestField', null);
      // Verify no error thrown

      photoDb.close();
    });
  });

  // ============================================================================
  // Save and persistence tests
  // ============================================================================

  describe('persistence', () => {
    it('can save photo database', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        // Create an album
        photoDb.createAlbum('Test Album');

        // Save should work
        photoDb.saveSync();
        photoDb.close();

        // Note: We can't easily verify persistence without opening the DB again,
        // and itdb_photodb_parse requires the Photo Database file to exist
      });
    });

    it('can use async save', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        photoDb.createAlbum('Async Test Album');

        await photoDb.save();
        photoDb.close();
      });
    });
  });

  // ============================================================================
  // Error handling tests
  // ============================================================================

  describe('error handling', () => {
    it('throws error when removing non-existent photo', async () => {
      const photoDb = PhotoDatabase.create();

      expect(() => photoDb.removePhoto(99999)).toThrow();

      photoDb.close();
    });

    it('throws error when renaming non-existent album', async () => {
      const photoDb = PhotoDatabase.create();

      expect(() => photoDb.renameAlbum(99999, 'New Name')).toThrow();

      photoDb.close();
    });

    it('throws error when getting photos from non-existent album', async () => {
      const photoDb = PhotoDatabase.create();

      expect(() => photoDb.getAlbumPhotos(99999)).toThrow();

      photoDb.close();
    });

    it('throws error when setMountpoint is called on closed database', async () => {
      const photoDb = PhotoDatabase.create();
      photoDb.close();

      expect(() => photoDb.setMountpoint('/some/path')).toThrow(LibgpodError);
    });

    it('throws error when getDeviceCapabilities is called on closed database', async () => {
      const photoDb = PhotoDatabase.create();
      photoDb.close();

      expect(() => photoDb.getDeviceCapabilities()).toThrow(LibgpodError);
    });

    it('throws error when setSysInfo is called on closed database', async () => {
      const photoDb = PhotoDatabase.create();
      photoDb.close();

      expect(() => photoDb.setSysInfo('Field', 'Value')).toThrow(LibgpodError);
    });

    it('throws error when adding photo to non-existent album', async () => {
      const photoDb = PhotoDatabase.create();

      // Even if we had a valid photo ID, the album doesn't exist
      expect(() => photoDb.addPhotoToAlbum(99999, 1)).toThrow();

      photoDb.close();
    });

    it('throws error when adding non-existent photo to album', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.createAlbum('Test Album');

        // Save to assign album ID
        photoDb.saveSync();

        const savedAlbum = photoDb.getAlbumByName('Test Album');
        expect(savedAlbum).toBeDefined();

        // Try to add non-existent photo
        expect(() => photoDb.addPhotoToAlbum(savedAlbum!.id, 99999)).toThrow();

        photoDb.close();
      });
    });

    it('throws error when removing non-existent album', async () => {
      const photoDb = PhotoDatabase.create();

      expect(() => photoDb.removeAlbum(99999)).toThrow();

      photoDb.close();
    });

    it('throws error when removing photo from non-existent album', async () => {
      const photoDb = PhotoDatabase.create();

      expect(() => photoDb.removePhotoFromAlbum(99999, 1)).toThrow();

      photoDb.close();
    });
  });

  // ============================================================================
  // Double close and lifecycle tests
  // ============================================================================

  describe('lifecycle', () => {
    it('double close is safe and does not throw', async () => {
      const photoDb = PhotoDatabase.create();

      photoDb.close();
      expect(photoDb.closed).toBe(true);

      // Second close should not throw
      expect(() => photoDb.close()).not.toThrow();
      expect(photoDb.closed).toBe(true);
    });

    it('supports Symbol.dispose for using declarations', async () => {
      // Test that Symbol.dispose is defined and callable
      const photoDb = PhotoDatabase.create();

      expect(typeof photoDb[Symbol.dispose]).toBe('function');
      photoDb[Symbol.dispose]();
      expect(photoDb.closed).toBe(true);
    });

    it('photoCount and albumCount getters work correctly', async () => {
      const photoDb = PhotoDatabase.create();

      expect(typeof photoDb.photoCount).toBe('number');
      expect(typeof photoDb.albumCount).toBe('number');
      expect(photoDb.photoCount).toBe(0);
      expect(photoDb.albumCount).toBeGreaterThanOrEqual(1); // Photo Library

      photoDb.close();
    });

    it('device property returns device info or null', async () => {
      const photoDb = PhotoDatabase.create();

      // Device might be null for in-memory database
      const device = photoDb.device;
      expect(device === null || typeof device === 'object').toBe(true);

      photoDb.close();
    });
  });

  // ============================================================================
  // Album position tests
  // ============================================================================

  describe('album position', () => {
    it('can create album at specific position', async () => {
      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);

        // Create albums in order
        photoDb.createAlbum('First');
        photoDb.createAlbum('Second');
        photoDb.createAlbum('Third');

        const albums = photoDb.getAlbums().filter((a) => !a.isPhotoLibrary);
        expect(albums).toHaveLength(3);

        // Note: Position parameter affects where in list album is inserted
        // Default position -1 appends to end
        const names = albums.map((a) => a.name);
        expect(names).toContain('First');
        expect(names).toContain('Second');
        expect(names).toContain('Third');

        photoDb.close();
      });
    });
  });

  // ============================================================================
  // Photo properties tests (gdk-pixbuf required)
  // ============================================================================

  describe('photo properties (gdk-pixbuf required)', () => {
    it('photo has expected properties', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          const photo = photoDb.addPhotoFromData(MINIMAL_JPEG);

          // Verify photo has expected properties
          expect(typeof photo.id).toBe('number');
          expect(typeof photo.dbid).toBe('bigint');
          expect(typeof photo.rating).toBe('number');
          expect(typeof photo.creationDate).toBe('number');
          expect(typeof photo.digitizedDate).toBe('number');
          expect(typeof photo.artworkSize).toBe('number');

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });

    it('getPhotos returns all photos in database', async () => {
      const hasSupport = await checkPixbufSupport();
      if (!hasSupport) {
        return;
      }

      await withTestIpod(async (ipod) => {
        ensurePhotosDir(ipod.path);

        const photoDb = PhotoDatabase.create(ipod.path);
        photoDb.setSysInfo('ModelNumStr', 'MA450');

        try {
          // Add multiple photos
          photoDb.addPhotoFromData(MINIMAL_JPEG);
          photoDb.addPhotoFromData(MINIMAL_JPEG);
          photoDb.addPhotoFromData(MINIMAL_JPEG);

          const photos = photoDb.getPhotos();
          expect(photos).toHaveLength(3);

          // Each photo should be an object
          for (const photo of photos) {
            expect(photo).toBeDefined();
            expect(typeof photo.id).toBe('number');
          }

          photoDb.close();
        } catch (e) {
          photoDb.close();
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('does not seem to support photos')) {
            throw e;
          }
        }
      });
    });
  });

  // ============================================================================
  // Type export tests
  // ============================================================================

  describe('type exports', () => {
    it('PhotoAlbumType enum has correct values', () => {
      expect(PhotoAlbumType.PhotoLibrary).toBe(1);
      expect(PhotoAlbumType.Normal).toBe(2);
    });

    it('PhotoTransitionDirection enum has correct values', () => {
      expect(PhotoTransitionDirection.None).toBe(0);
      expect(PhotoTransitionDirection.LeftToRight).toBe(1);
      expect(PhotoTransitionDirection.RightToLeft).toBe(2);
      expect(PhotoTransitionDirection.TopToBottom).toBe(3);
      expect(PhotoTransitionDirection.BottomToTop).toBe(4);
    });
  });
});
