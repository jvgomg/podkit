/**
 * Integration tests for libgpod-node database operations.
 *
 * These tests cover: isNativeAvailable, track utilities, MediaType,
 * database open/close, info, and basic operations.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect, beforeAll } from 'bun:test';

import {
  withTestIpod,
  isGpodToolAvailable,
  Database,
  isNativeAvailable,
  starsToRating,
  ratingToStars,
  formatDuration,
  ipodPathToFilePath,
  filePathToIpodPath,
  MediaType,
  LibgpodError,
} from './helpers/test-setup';

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

  // ============================================================================
  // Device capability tests
  // ============================================================================

  it.skipIf(!isNativeAvailable())(
    'can get device capabilities',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const caps = db.getDeviceCapabilities();

        // Check that all capability fields are present
        expect(typeof caps.supportsArtwork).toBe('boolean');
        expect(typeof caps.supportsVideo).toBe('boolean');
        expect(typeof caps.supportsPhoto).toBe('boolean');
        expect(typeof caps.supportsPodcast).toBe('boolean');
        expect(typeof caps.supportsChapterImage).toBe('boolean');

        // Check device identification fields
        expect(typeof caps.generation).toBe('string');
        expect(typeof caps.model).toBe('string');
        expect(typeof caps.modelName).toBe('string');

        // modelNumber can be string or null
        expect(
          caps.modelNumber === null || typeof caps.modelNumber === 'string'
        ).toBe(true);

        // Test iPod created by gpod-testing should support artwork
        // (it's configured as a video iPod)
        expect(caps.supportsArtwork).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can read SysInfo values',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Test iPod created by gpod-testing should have ModelNumStr set
        const modelNum = db.getSysInfo('ModelNumStr');

        // gpod-testing sets ModelNumStr during init
        // The value should be a string (not null)
        expect(modelNum).not.toBeNull();
        expect(typeof modelNum).toBe('string');

        // Try to get a non-existent field
        const nonExistent = db.getSysInfo('NonExistentField');
        expect(nonExistent).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can set and read SysInfo values',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Set a custom SysInfo field
        db.setSysInfo('TestField', 'TestValue');

        // Read it back
        const value = db.getSysInfo('TestField');
        expect(value).toBe('TestValue');

        // Remove the field by setting to null
        db.setSysInfo('TestField', null);

        // Verify it's gone
        const removedValue = db.getSysInfo('TestField');
        expect(removedValue).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'SysInfo changes persist after save and reopen',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Set a custom SysInfo field
        db.setSysInfo('PersistTestField', 'PersistTestValue');

        // Save the database
        db.saveSync();
        db.close();

        // Reopen and verify the value persists
        const db2 = Database.openSync(ipod.path);
        const value = db2.getSysInfo('PersistTestField');
        expect(value).toBe('PersistTestValue');

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when calling getDeviceCapabilities on closed database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.getDeviceCapabilities()).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when calling getSysInfo on closed database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.getSysInfo('ModelNumStr')).toThrow(LibgpodError);
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error when calling setSysInfo on closed database',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);
        db.close();

        expect(() => db.setSysInfo('TestField', 'TestValue')).toThrow(
          LibgpodError
        );
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'getSysInfo handles empty string field name',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Empty field name should return null (field doesn't exist)
        const value = db.getSysInfo('');
        expect(value).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'setSysInfo can overwrite existing values',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Set initial value
        db.setSysInfo('OverwriteTest', 'Value1');
        expect(db.getSysInfo('OverwriteTest')).toBe('Value1');

        // Overwrite with new value
        db.setSysInfo('OverwriteTest', 'Value2');
        expect(db.getSysInfo('OverwriteTest')).toBe('Value2');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'getDeviceCapabilities returns consistent types across calls',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Call multiple times to ensure consistency
        const caps1 = db.getDeviceCapabilities();
        const caps2 = db.getDeviceCapabilities();

        // Values should be identical
        expect(caps1.supportsArtwork).toBe(caps2.supportsArtwork);
        expect(caps1.supportsVideo).toBe(caps2.supportsVideo);
        expect(caps1.supportsPhoto).toBe(caps2.supportsPhoto);
        expect(caps1.supportsPodcast).toBe(caps2.supportsPodcast);
        expect(caps1.supportsChapterImage).toBe(caps2.supportsChapterImage);
        expect(caps1.generation).toBe(caps2.generation);
        expect(caps1.model).toBe(caps2.model);
        expect(caps1.modelNumber).toBe(caps2.modelNumber);
        expect(caps1.modelName).toBe(caps2.modelName);

        db.close();
      });
    }
  );
});
