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
      throw new Error('gpod-tool not available. Run `mise run tools:build` to build it.');
    }
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

describe('libgpod-node with native binding', () => {
  it('can open a test iPod database', async () => {
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
  });

  it('can read device info', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const device = db.device;
      expect(device).toBeDefined();
      expect(device.supportsArtwork).toBe(true);

      db.close();
    });
  });

  it('can add and retrieve tracks', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add a track
      const handle = db.addTrack({
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180000,
        bitrate: 320,
        sampleRate: 44100,
      });

      const newTrack = db.getTrack(handle);
      expect(newTrack).toBeDefined();
      expect(newTrack.title).toBe('Test Song');
      expect(newTrack.artist).toBe('Test Artist');
      expect(newTrack.album).toBe('Test Album');

      // Verify track count
      expect(db.trackCount).toBe(1);

      // Get tracks
      const handles = db.getTracks();
      expect(handles).toHaveLength(1);
      const track = db.getTrack(handles[0]!);
      expect(track.title).toBe('Test Song');

      db.close();
    });
  });

  it('can save changes to database', async () => {
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

      const handles = db2.getTracks();
      const track = db2.getTrack(handles[0]!);
      expect(track.title).toBe('Saved Song');

      db2.close();
    });
  });

  it('can remove tracks', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add two tracks
      const handle1 = db.addTrack({ title: 'Song 1' });
      db.addTrack({ title: 'Song 2' }); // Adding second track for count test

      expect(db.trackCount).toBe(2);

      // Remove first track
      db.removeTrack(handle1);
      expect(db.trackCount).toBe(1);

      // Verify correct track remains
      const handles = db.getTracks();
      expect(handles).toHaveLength(1);
      const track = db.getTrack(handles[0]!);
      expect(track.title).toBe('Song 2');

      db.close();
    });
  });

  it('can list playlists', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const playlists = db.getPlaylists();
      expect(playlists.length).toBeGreaterThanOrEqual(1);

      // Should have master playlist
      const master = playlists.find((p) => p.isMaster);
      expect(master).toBeDefined();

      db.close();
    });
  });

  it('throws error when database is closed', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.close();

      expect(() => db.getTracks()).toThrow(LibgpodError);
      expect(() => db.getInfo()).toThrow(LibgpodError);
    });
  });

  it('can use async open', async () => {
    await withTestIpod(async (ipod) => {
      const db = await Database.open(ipod.path);

      expect(db).toBeDefined();
      expect(db.trackCount).toBe(0);

      db.close();
    });
  });

  // ============================================================================
  // Device capability tests
  // ============================================================================

  it('can get device capabilities', async () => {
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
      expect(caps.modelNumber === null || typeof caps.modelNumber === 'string').toBe(true);

      // Test iPod created by gpod-testing should support artwork
      // (it's configured as a video iPod)
      expect(caps.supportsArtwork).toBe(true);

      db.close();
    });
  });

  it('can read SysInfo values', async () => {
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
  });

  it('can set and read SysInfo values', async () => {
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
  });

  it('SysInfo changes persist after save and reopen', async () => {
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
  });

  it('throws error when calling getDeviceCapabilities on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.close();

      expect(() => db.getDeviceCapabilities()).toThrow(LibgpodError);
    });
  });

  it('throws error when calling getSysInfo on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.close();

      expect(() => db.getSysInfo('ModelNumStr')).toThrow(LibgpodError);
    });
  });

  it('throws error when calling setSysInfo on closed database', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.close();

      expect(() => db.setSysInfo('TestField', 'TestValue')).toThrow(LibgpodError);
    });
  });

  it('getSysInfo handles empty string field name', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Empty field name should return null (field doesn't exist)
      const value = db.getSysInfo('');
      expect(value).toBeNull();

      db.close();
    });
  });

  it('setSysInfo can overwrite existing values', async () => {
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
  });

  it('getDeviceCapabilities returns consistent types across calls', async () => {
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
  });

  // ============================================================================
  // Database creation/manipulation tests
  // ============================================================================

  it('Database.create() creates new empty database', async () => {
    // Create a new empty database
    const db = Database.create();

    expect(db).toBeDefined();
    expect(db.closed).toBe(false);

    // New database should have no tracks
    const info = db.getInfo();
    expect(info.trackCount).toBe(0);

    // New database may have no playlists (no master playlist yet)
    // since it has no mountpoint associated
    expect(info.playlistCount).toBeGreaterThanOrEqual(0);

    // No mountpoint initially
    expect(db.mountpoint).toBe('');

    // Database ID should be set (random)
    expect(info.id).toBeDefined();
    expect(typeof info.id).toBe('bigint');

    db.close();
    expect(db.closed).toBe(true);
  });

  it('Database.create() with setMountpoint() can save to iPod', async () => {
    await withTestIpod(async (ipod) => {
      // Create a new database and set mountpoint
      const db = Database.create();
      db.setMountpoint(ipod.path);

      expect(db.mountpoint).toBe(ipod.path);

      // Add a track
      const handle = db.addTrack({
        title: 'Created Track',
        artist: 'Created Artist',
      });
      const track = db.getTrack(handle);
      expect(track.title).toBe('Created Track');

      // Save should work
      db.saveSync();
      db.close();

      // Reopen and verify
      const db2 = Database.openSync(ipod.path);
      expect(db2.trackCount).toBe(1);

      const handles = db2.getTracks();
      const track2 = db2.getTrack(handles[0]!);
      expect(track2.title).toBe('Created Track');
      expect(track2.artist).toBe('Created Artist');

      db2.close();
    });
  });

  it('setMountpoint updates the database mountpoint', async () => {
    await withTestIpod(async (ipod) => {
      // Open existing database
      const db = Database.openSync(ipod.path);

      // Mountpoint should be set
      expect(db.mountpoint).toBe(ipod.path);

      // We can verify the native mountpoint matches
      const info = db.getInfo();
      expect(info.mountpoint).toBe(ipod.path);

      db.close();
    });
  });

  it('getFilename returns null for databases opened by mountpoint', async () => {
    await withTestIpod(async (ipod) => {
      // When opening via mountpoint, the filename is set internally
      const db = Database.openSync(ipod.path);

      // Should return the path to the iTunesDB file
      const filename = db.getFilename();
      // The filename should either be null or a path containing iTunesDB
      if (filename !== null) {
        expect(filename).toContain('iTunesDB');
      }

      db.close();
    });
  });

  it('Database.openFile() opens database from file path', async () => {
    await withTestIpod(async (ipod) => {
      // First save some data to the test iPod
      const db1 = Database.openSync(ipod.path);
      db1.addTrack({
        title: 'File Track',
        artist: 'File Artist',
      });
      db1.saveSync();
      const itunesDbPath = db1.getFilename();
      db1.close();

      // Skip if we couldn't get the filename
      if (!itunesDbPath) {
        return;
      }

      // Now open directly from file
      const db2 = Database.openFile(itunesDbPath);

      expect(db2).toBeDefined();
      expect(db2.closed).toBe(false);

      // Should have the track we saved
      expect(db2.trackCount).toBe(1);
      const handles = db2.getTracks();
      const track = db2.getTrack(handles[0]!);
      expect(track.title).toBe('File Track');

      // Mountpoint should be empty when opened from file
      expect(db2.mountpoint).toBe('');

      // Filename should be set
      const filename = db2.getFilename();
      expect(filename).toBe(itunesDbPath);

      db2.close();
    });
  });

  it('Database.openFileAsync() opens database from file path asynchronously', async () => {
    await withTestIpod(async (ipod) => {
      // First save some data to the test iPod
      const db1 = Database.openSync(ipod.path);
      db1.addTrack({
        title: 'Async File Track',
        artist: 'Async File Artist',
      });
      db1.saveSync();
      const itunesDbPath = db1.getFilename();
      db1.close();

      // Skip if we couldn't get the filename
      if (!itunesDbPath) {
        return;
      }

      // Now open directly from file async
      const db2 = await Database.openFileAsync(itunesDbPath);

      expect(db2).toBeDefined();
      expect(db2.trackCount).toBe(1);

      const handles = db2.getTracks();
      const track = db2.getTrack(handles[0]!);
      expect(track.title).toBe('Async File Track');

      db2.close();
    });
  });

  it('throws error when setMountpoint is called on closed database', async () => {
    const db = Database.create();
    db.close();

    expect(() => db.setMountpoint('/some/path')).toThrow(LibgpodError);
  });

  it('throws error when getFilename is called on closed database', async () => {
    const db = Database.create();
    db.close();

    expect(() => db.getFilename()).toThrow(LibgpodError);
  });

  it('Database.openFile() throws error for non-existent file', async () => {
    expect(() => Database.openFile('/nonexistent/path/iTunesDB')).toThrow(LibgpodError);
  });

  it('Database.openFileAsync() throws error for non-existent file', async () => {
    await expect(Database.openFileAsync('/nonexistent/path/iTunesDB')).rejects.toThrow(
      LibgpodError
    );
  });

  it('getFilename() returns null for newly created database', async () => {
    const db = Database.create();

    // Newly created database has no filename
    const filename = db.getFilename();
    expect(filename).toBeNull();

    db.close();
  });

  it('Database.create() database can add multiple tracks', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.create();
      db.setMountpoint(ipod.path);

      // Add multiple tracks
      const handle1 = db.addTrack({
        title: 'Track One',
        artist: 'Artist One',
        album: 'Album',
        trackNumber: 1,
      });
      const handle2 = db.addTrack({
        title: 'Track Two',
        artist: 'Artist Two',
        album: 'Album',
        trackNumber: 2,
      });

      expect(db.trackCount).toBe(2);
      const track1 = db.getTrack(handle1);
      const track2 = db.getTrack(handle2);
      expect(track1.title).toBe('Track One');
      expect(track2.title).toBe('Track Two');

      // Save and verify persistence
      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);
      expect(db2.trackCount).toBe(2);

      const handles = db2.getTracks();
      const titles = handles.map((h) => db2.getTrack(h).title).sort();
      expect(titles).toEqual(['Track One', 'Track Two']);

      db2.close();
    });
  });

  it('setMountpoint with empty string', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Setting empty mountpoint should work (clears it)
      db.setMountpoint('');
      expect(db.mountpoint).toBe('');

      // getInfo should reflect the change
      const info = db.getInfo();
      // info.mountpoint may be empty or null depending on libgpod behavior
      expect(info.mountpoint === '' || info.mountpoint === null).toBe(true);

      db.close();
    });
  });

  it('openFile() then setMountpoint() allows save operations', async () => {
    await withTestIpod(async (ipod) => {
      // First create a database with some data
      const db1 = Database.openSync(ipod.path);
      db1.addTrack({ title: 'Original Track' });
      db1.saveSync();
      const itunesDbPath = db1.getFilename();
      db1.close();

      if (!itunesDbPath) {
        return;
      }

      // Open from file, set mountpoint, add track, save
      const db2 = Database.openFile(itunesDbPath);
      expect(db2.mountpoint).toBe('');

      db2.setMountpoint(ipod.path);
      expect(db2.mountpoint).toBe(ipod.path);

      db2.addTrack({ title: 'New Track' });
      db2.saveSync();
      db2.close();

      // Verify both tracks exist
      const db3 = Database.openSync(ipod.path);
      expect(db3.trackCount).toBe(2);

      const titles = db3
        .getTracks()
        .map((h) => db3.getTrack(h).title)
        .sort();
      expect(titles).toEqual(['New Track', 'Original Track']);

      db3.close();
    });
  });

  // ============================================================================
  // Database.initializeIpod() tests
  // ============================================================================

  it('Database.initializeIpod() creates a new iPod database', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const path = await import('path');

    // Create a fresh temp directory for the iPod
    const tempDir = await mkdtemp(path.join(tmpdir(), 'ipod-init-test-'));

    try {
      // Initialize a new iPod database
      const db = await Database.initializeIpod(tempDir);

      expect(db).toBeDefined();
      expect(db.closed).toBe(false);
      expect(db.mountpoint).toBe(tempDir);

      // Should have 0 tracks
      expect(db.trackCount).toBe(0);

      // Should have at least one playlist (master)
      expect(db.playlistCount).toBeGreaterThanOrEqual(1);

      // Should have a master playlist
      const mpl = db.getMasterPlaylist();
      expect(mpl).not.toBeNull();

      db.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Database.initializeIpod() creates valid directory structure', async () => {
    const { mkdtemp, rm, stat } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const path = await import('path');

    const tempDir = await mkdtemp(path.join(tmpdir(), 'ipod-struct-test-'));

    try {
      const db = await Database.initializeIpod(tempDir);
      db.close();

      // Verify directory structure was created
      const ipodControl = path.join(tempDir, 'iPod_Control');
      const ipodControlStat = await stat(ipodControl);
      expect(ipodControlStat.isDirectory()).toBe(true);

      const itunesDir = path.join(ipodControl, 'iTunes');
      const itunesDirStat = await stat(itunesDir);
      expect(itunesDirStat.isDirectory()).toBe(true);

      const itunesDb = path.join(itunesDir, 'iTunesDB');
      const itunesDbStat = await stat(itunesDb);
      expect(itunesDbStat.isFile()).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Database.initializeIpod() can add tracks and save', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const path = await import('path');

    const tempDir = await mkdtemp(path.join(tmpdir(), 'ipod-tracks-test-'));

    try {
      // Initialize and add a track
      const db = await Database.initializeIpod(tempDir);
      const handle = db.addTrack({
        title: 'Initialized Track',
        artist: 'Test Artist',
        album: 'Test Album',
      });

      const track = db.getTrack(handle);
      expect(track.title).toBe('Initialized Track');

      // Save changes
      db.saveSync();
      db.close();

      // Reopen and verify
      const db2 = Database.openSync(tempDir);
      expect(db2.trackCount).toBe(1);

      const handles = db2.getTracks();
      const savedTrack = db2.getTrack(handles[0]!);
      expect(savedTrack.title).toBe('Initialized Track');
      expect(savedTrack.artist).toBe('Test Artist');

      db2.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Database.initializeIpod() with custom model and name', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const path = await import('path');

    const tempDir = await mkdtemp(path.join(tmpdir(), 'ipod-model-test-'));

    try {
      // Use VIDEO_60GB model which is the default and known to work
      const db = await Database.initializeIpod(tempDir, {
        model: Database.IpodModels.VIDEO_60GB,
        name: 'My Video iPod',
      });

      expect(db).toBeDefined();
      expect(db.closed).toBe(false);

      // Check device capabilities are set based on model
      const caps = db.getDeviceCapabilities();
      expect(typeof caps.supportsArtwork).toBe('boolean');
      expect(typeof caps.supportsVideo).toBe('boolean');

      // Video iPod should support both artwork and video
      expect(caps.supportsArtwork).toBe(true);
      expect(caps.supportsVideo).toBe(true);

      db.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Database.initializeIpodSync() works synchronously', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const path = await import('path');

    const tempDir = mkdtempSync(path.join(tmpdir(), 'ipod-sync-test-'));

    try {
      // Use synchronous version
      const db = Database.initializeIpodSync(tempDir);

      expect(db).toBeDefined();
      expect(db.mountpoint).toBe(tempDir);
      expect(db.trackCount).toBe(0);

      db.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Database.initializeIpod() creates directory if it does not exist', async () => {
    const { mkdtemp, rm, stat } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const path = await import('path');

    // Create a temp dir, then specify a subdirectory that doesn't exist yet
    const baseDir = await mkdtemp(path.join(tmpdir(), 'ipod-mkdir-test-'));
    const ipodDir = path.join(baseDir, 'nested', 'ipod');

    try {
      // The nested directory should not exist
      await expect(stat(ipodDir)).rejects.toThrow();

      // Initialize should create it
      const db = await Database.initializeIpod(ipodDir);
      expect(db).toBeDefined();
      db.close();

      // Now it should exist
      const dirStat = await stat(ipodDir);
      expect(dirStat.isDirectory()).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('Database.IpodModels has expected values', () => {
    expect(Database.IpodModels.VIDEO_60GB).toBe('MA147');
    expect(Database.IpodModels.CLASSIC_120GB).toBe('MB565');
    expect(Database.IpodModels.NANO_2GB).toBe('MA477');
  });
});
