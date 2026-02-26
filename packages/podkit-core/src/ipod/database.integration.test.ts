/**
 * Integration tests for IpodDatabase class.
 *
 * These tests use @podkit/gpod-testing to create real iPod test environments
 * and verify IpodDatabase operations against actual iTunesDB databases.
 *
 * Prerequisites:
 * - gpod-tool: `mise run tools:build`
 * - libgpod-node native bindings: `bun run build`
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { withTestIpod, isGpodToolAvailable } from '@podkit/gpod-testing';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpodDatabase } from './database.js';
import { IpodError } from './errors.js';
import { requireGpodTool, requireLibgpod } from '../__tests__/helpers/test-setup.js';

// Fail early if dependencies are not available
requireGpodTool();
requireLibgpod();

describe('IpodDatabase integration', () => {
  beforeAll(async () => {
    if (!(await isGpodToolAvailable())) {
      throw new Error('gpod-tool not available. Run `mise run tools:build` first.');
    }
  });

  describe('open()', () => {
    it('opens database from mount point', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.trackCount).toBe(0);
          expect(ipod.playlistCount).toBeGreaterThanOrEqual(1); // At least master playlist
        } finally {
          ipod.close();
        }
      });
    });

    it('throws NOT_FOUND for non-existent path', async () => {
      await expect(IpodDatabase.open('/nonexistent/path')).rejects.toThrow(IpodError);

      try {
        await IpodDatabase.open('/nonexistent/path');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('properties', () => {
    it('provides mountPoint', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.mountPoint).toBe(testIpod.path);
        } finally {
          ipod.close();
        }
      });
    });

    it('provides device info', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const device = ipod.device;
          expect(device).toBeDefined();
          expect(device.modelName).toBeTruthy();
          expect(typeof device.capacity).toBe('number');
          expect(typeof device.supportsArtwork).toBe('boolean');
          expect(typeof device.supportsVideo).toBe('boolean');
          expect(typeof device.supportsPhoto).toBe('boolean');
          expect(typeof device.supportsPodcast).toBe('boolean');
        } finally {
          ipod.close();
        }
      });
    });

    it('provides trackCount', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.trackCount).toBe(0);
        } finally {
          ipod.close();
        }
      });
    });

    it('provides playlistCount', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          // Should have at least the master playlist
          expect(ipod.playlistCount).toBeGreaterThanOrEqual(1);
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('getInfo()', () => {
    it('returns correct structure', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const info = ipod.getInfo();

          expect(info.mountPoint).toBe(testIpod.path);
          expect(info.trackCount).toBe(0);
          expect(info.playlistCount).toBeGreaterThanOrEqual(1);
          expect(info.device).toBeDefined();
          expect(info.device.modelName).toBeTruthy();
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('track operations', () => {
    it('adds a track with metadata', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track = ipod.addTrack({
            title: 'Test Song',
            artist: 'Test Artist',
            album: 'Test Album',
            trackNumber: 1,
            totalTracks: 10,
            year: 2024,
          });

          expect(track.title).toBe('Test Song');
          expect(track.artist).toBe('Test Artist');
          expect(track.album).toBe('Test Album');
          expect(track.trackNumber).toBe(1);
          expect(track.totalTracks).toBe(10);
          expect(track.year).toBe(2024);
          expect(track.hasFile).toBe(false);
          expect(ipod.trackCount).toBe(1);
        } finally {
          ipod.close();
        }
      });
    });

    it('retrieves all tracks', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.addTrack({ title: 'Track 1', artist: 'Artist' });
          ipod.addTrack({ title: 'Track 2', artist: 'Artist' });
          ipod.addTrack({ title: 'Track 3', artist: 'Artist' });

          const tracks = ipod.getTracks();
          expect(tracks).toHaveLength(3);
          expect(tracks.map((t) => t.title).sort()).toEqual(['Track 1', 'Track 2', 'Track 3']);
        } finally {
          ipod.close();
        }
      });
    });

    it('updates track metadata', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track = ipod.addTrack({ title: 'Original Title', artist: 'Artist' });

          const updated = track.update({ title: 'New Title', rating: 80 });

          expect(updated.title).toBe('New Title');
          expect(updated.rating).toBe(80);
          // Original track snapshot is unchanged
          expect(track.title).toBe('Original Title');
        } finally {
          ipod.close();
        }
      });
    });

    it('removes track', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track = ipod.addTrack({ title: 'To Remove', artist: 'Artist' });
          expect(ipod.trackCount).toBe(1);

          track.remove();
          expect(ipod.trackCount).toBe(0);

          // Subsequent operations on removed track should throw
          expect(() => track.update({ title: 'New' })).toThrow(IpodError);
        } finally {
          ipod.close();
        }
      });
    });

    it('chains track operations', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          // Test the fluent API pattern
          const track = ipod.addTrack({ title: 'Song', artist: 'Artist' }).update({ rating: 100 });

          expect(track.title).toBe('Song');
          expect(track.rating).toBe(100);
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('copyFileToTrack', () => {
    it('throws FILE_NOT_FOUND for missing source', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track = ipod.addTrack({ title: 'Test', artist: 'Artist' });

          try {
            track.copyFile('/nonexistent/file.mp3');
            throw new Error('Should have thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(IpodError);
            expect((error as IpodError).code).toBe('FILE_NOT_FOUND');
          }
        } finally {
          ipod.close();
        }
      });
    });

    it('copies audio file to iPod', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);

        // Create a minimal test audio file (empty WAV header)
        const tempDir = await mkdtemp(join(tmpdir(), 'ipod-test-'));
        const audioPath = join(tempDir, 'test.mp3');

        try {
          // Create a minimal MP3-like file (won't play, but tests copy mechanism)
          // In real tests, we'd use a proper audio file
          const mp3Header = Buffer.from([
            0xff, 0xfb, 0x90, 0x00, // MP3 frame header
            0x00, 0x00, 0x00, 0x00, // padding
          ]);
          await writeFile(audioPath, mp3Header);

          const track = ipod.addTrack({
            title: 'Test',
            artist: 'Artist',
            filetype: 'MPEG audio file',
            duration: 1000,
            bitrate: 128,
            sampleRate: 44100,
            size: mp3Header.length,
          });

          expect(track.hasFile).toBe(false);

          const updated = track.copyFile(audioPath);
          expect(updated.hasFile).toBe(true);
          expect(updated.filePath).toBeTruthy();
        } finally {
          ipod.close();
          await rm(tempDir, { recursive: true });
        }
      });
    });
  });

  describe('playlist operations', () => {
    it('gets master playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const master = ipod.getMasterPlaylist();
          expect(master).toBeDefined();
          expect(master.isMaster).toBe(true);
        } finally {
          ipod.close();
        }
      });
    });

    it('creates playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const initialCount = ipod.playlistCount;
          const playlist = ipod.createPlaylist('Test Playlist');

          expect(playlist.name).toBe('Test Playlist');
          expect(playlist.isMaster).toBe(false);
          expect(playlist.trackCount).toBe(0);
          expect(ipod.playlistCount).toBe(initialCount + 1);
        } finally {
          ipod.close();
        }
      });
    });

    it('gets all playlists', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.createPlaylist('Playlist 1');
          ipod.createPlaylist('Playlist 2');

          const playlists = ipod.getPlaylists();
          // Should have master + 2 new playlists
          expect(playlists.length).toBeGreaterThanOrEqual(3);

          const names = playlists.map((p) => p.name);
          expect(names).toContain('Playlist 1');
          expect(names).toContain('Playlist 2');
        } finally {
          ipod.close();
        }
      });
    });

    it('gets playlist by name', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.createPlaylist('Find Me');

          const found = ipod.getPlaylistByName('Find Me');
          expect(found).not.toBeNull();
          expect(found!.name).toBe('Find Me');

          const notFound = ipod.getPlaylistByName('Not Found');
          expect(notFound).toBeNull();
        } finally {
          ipod.close();
        }
      });
    });

    it('renames playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const playlist = ipod.createPlaylist('Original Name');

          const renamed = playlist.rename('New Name');
          expect(renamed.name).toBe('New Name');
          // Original snapshot unchanged
          expect(playlist.name).toBe('Original Name');
        } finally {
          ipod.close();
        }
      });
    });

    it('removes playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const initialCount = ipod.playlistCount;
          const playlist = ipod.createPlaylist('To Remove');
          expect(ipod.playlistCount).toBe(initialCount + 1);

          playlist.remove();
          expect(ipod.playlistCount).toBe(initialCount);

          // Operations on removed playlist should throw
          expect(() => playlist.rename('New')).toThrow(IpodError);
        } finally {
          ipod.close();
        }
      });
    });

    it('cannot remove or rename master playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const master = ipod.getMasterPlaylist();

          expect(() => master.remove()).toThrow(IpodError);
          expect(() => master.rename('New Name')).toThrow(IpodError);
        } finally {
          ipod.close();
        }
      });
    });

    it('adds and removes tracks from playlist', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track1 = ipod.addTrack({ title: 'Track 1', artist: 'Artist' });
          const track2 = ipod.addTrack({ title: 'Track 2', artist: 'Artist' });
          const playlist = ipod.createPlaylist('My Playlist');

          // Add tracks
          let updated = playlist.addTrack(track1);
          expect(updated.trackCount).toBe(1);
          expect(updated.containsTrack(track1)).toBe(true);

          updated = updated.addTrack(track2);
          expect(updated.trackCount).toBe(2);

          // Get tracks from playlist
          const tracks = updated.getTracks();
          expect(tracks).toHaveLength(2);

          // Remove track
          updated = updated.removeTrack(track1);
          expect(updated.trackCount).toBe(1);
          expect(updated.containsTrack(track1)).toBe(false);
          expect(updated.containsTrack(track2)).toBe(true);
        } finally {
          ipod.close();
        }
      });
    });

    it('chains playlist operations', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          const track1 = ipod.addTrack({ title: 'Track 1', artist: 'Artist' });
          const track2 = ipod.addTrack({ title: 'Track 2', artist: 'Artist' });
          const track3 = ipod.addTrack({ title: 'Track 3', artist: 'Artist' });

          // Test fluent API
          const playlist = ipod
            .createPlaylist('Favorites')
            .addTrack(track1)
            .addTrack(track2)
            .addTrack(track3);

          expect(playlist.trackCount).toBe(3);
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('removeAllTracks()', () => {
    it('removes all tracks from the database', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          // Add some tracks
          ipod.addTrack({ title: 'Track 1', artist: 'Artist' });
          ipod.addTrack({ title: 'Track 2', artist: 'Artist' });
          ipod.addTrack({ title: 'Track 3', artist: 'Artist' });
          expect(ipod.trackCount).toBe(3);

          // Remove all tracks
          const removedCount = ipod.removeAllTracks({ deleteFiles: false });
          expect(removedCount).toBe(3);
          expect(ipod.trackCount).toBe(0);
        } finally {
          ipod.close();
        }
      });
    });

    it('returns 0 for empty database', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.trackCount).toBe(0);

          const removedCount = ipod.removeAllTracks();
          expect(removedCount).toBe(0);
        } finally {
          ipod.close();
        }
      });
    });

    it('attempts to delete audio files when deleteFiles is true', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        const tempDir = await mkdtemp(join(tmpdir(), 'ipod-test-'));
        const audioPath = join(tempDir, 'test.mp3');

        try {
          // Create a minimal MP3-like file
          const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
          await writeFile(audioPath, mp3Header);

          // Add track and copy file
          const track = ipod.addTrack({
            title: 'With File',
            artist: 'Artist',
            filetype: 'MPEG audio file',
            size: mp3Header.length,
          });
          const updatedTrack = track.copyFile(audioPath);
          expect(updatedTrack.hasFile).toBe(true);

          // Remove all tracks with deleteFiles: true - should not throw
          // even if the file doesn't exist at the expected path
          const removedCount = ipod.removeAllTracks({ deleteFiles: true });
          expect(removedCount).toBe(1);
          expect(ipod.trackCount).toBe(0);
        } finally {
          ipod.close();
          await rm(tempDir, { recursive: true });
        }
      });
    });

    it('persists empty database after save', async () => {
      await withTestIpod(async (testIpod) => {
        // Session 1: Add tracks, save, then remove all and save
        let ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.addTrack({ title: 'Track 1', artist: 'Artist' });
          ipod.addTrack({ title: 'Track 2', artist: 'Artist' });
          await ipod.save();

          ipod.removeAllTracks({ deleteFiles: false });
          await ipod.save();
        } finally {
          ipod.close();
        }

        // Session 2: Verify database is empty
        ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.trackCount).toBe(0);
          expect(ipod.getTracks()).toHaveLength(0);
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('save()', () => {
    it('saves changes to database', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.addTrack({ title: 'Saved Track', artist: 'Artist' });

          const result = await ipod.save();
          expect(result.warnings).toBeInstanceOf(Array);
        } finally {
          ipod.close();
        }
      });
    });

    it('includes warning for tracks without files', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.addTrack({ title: 'No File', artist: 'Artist' });
          ipod.addTrack({ title: 'Also No File', artist: 'Artist' });

          const result = await ipod.save();
          expect(result.warnings.length).toBeGreaterThan(0);
          expect(result.warnings[0]).toContain('no audio file');
        } finally {
          ipod.close();
        }
      });
    });

    it('persists tracks across sessions', async () => {
      await withTestIpod(async (testIpod) => {
        // Session 1: Add tracks and save
        let ipod = await IpodDatabase.open(testIpod.path);
        try {
          ipod.addTrack({ title: 'Persistent Track', artist: 'Artist' });
          await ipod.save();
        } finally {
          ipod.close();
        }

        // Session 2: Verify tracks persisted
        ipod = await IpodDatabase.open(testIpod.path);
        try {
          expect(ipod.trackCount).toBe(1);
          const tracks = ipod.getTracks();
          expect(tracks).toHaveLength(1);
          expect(tracks[0]!.title).toBe('Persistent Track');
        } finally {
          ipod.close();
        }
      });
    });
  });

  describe('close()', () => {
    it('prevents operations after close', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        ipod.close();

        // All operations should throw DATABASE_CLOSED
        expect(() => ipod.trackCount).toThrow(IpodError);
        expect(() => ipod.getTracks()).toThrow(IpodError);
        expect(() => ipod.addTrack({ title: 'Test' })).toThrow(IpodError);
        expect(() => ipod.getPlaylists()).toThrow(IpodError);
        expect(() => ipod.getInfo()).toThrow(IpodError);

        try {
          const _count = ipod.trackCount;
          throw new Error('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(IpodError);
          expect((error as IpodError).code).toBe('DATABASE_CLOSED');
        }
      });
    });

    it('can be called multiple times safely', async () => {
      await withTestIpod(async (testIpod) => {
        const ipod = await IpodDatabase.open(testIpod.path);
        ipod.close();
        ipod.close();
        ipod.close();
        // Should not throw
      });
    });
  });

  describe('Symbol.dispose', () => {
    it('closes database when disposed', async () => {
      await withTestIpod(async (testIpod) => {
        let ipod: IpodDatabase;
        {
          ipod = await IpodDatabase.open(testIpod.path);
          ipod[Symbol.dispose]();
        }

        // Should be closed
        expect(() => ipod.trackCount).toThrow(IpodError);
      });
    });
  });
});
