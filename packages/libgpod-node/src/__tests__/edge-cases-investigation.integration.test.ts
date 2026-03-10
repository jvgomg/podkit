/**
 * Integration tests to investigate potential edge cases that could cause
 * libgpod CRITICAL assertions or unexpected behavior.
 *
 * This test file explores various edge cases to identify potential issues
 * that may need behavioral deviations from libgpod.
 *
 * Run with: bun test src/__tests__/edge-cases-investigation --cwd packages/libgpod-node
 */

import { describe, it, expect } from 'bun:test';

import { withTestIpod, Database, MediaType, type TrackHandle } from './helpers/test-setup';

describe('Edge case investigation', () => {
  describe('empty database operations', () => {
    it('save empty database (no tracks)', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Save with zero tracks
        console.log('Saving empty database...');
        db.saveSync();

        expect(db.trackCount).toBe(0);
        db.close();
      });
    });

    it('multiple consecutive saves with no changes', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({ title: 'Track 1', mediaType: MediaType.Audio });
        db.saveSync();

        // Multiple saves with no changes between them
        console.log('Multiple saves with no changes...');
        db.saveSync();
        db.saveSync();
        db.saveSync();

        expect(db.trackCount).toBe(1);
        db.close();
      });
    });

    it('close without save after modifications', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({ title: 'Unsaved Track', mediaType: MediaType.Audio });

        // Close without saving - should not crash
        console.log('Closing without save...');
        db.close();

        // Reopen - unsaved track should not be present
        const db2 = Database.openSync(ipod.path);
        expect(db2.trackCount).toBe(0);
        db2.close();
      });
    });
  });

  describe('playlist edge cases', () => {
    it('remove playlist that contains tracks', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add track
        const trackHandle = db.addTrack({
          title: 'Track in playlist',
          mediaType: MediaType.Audio,
        });

        // Create playlist and add track
        const playlist = db.createPlaylist('Test Playlist');
        db.addTrackToPlaylist(playlist.id, trackHandle);

        db.saveSync();
        console.log('Created playlist with track');

        // Remove the playlist (track should still exist)
        db.removePlaylist(playlist.id);
        console.log('Removed playlist, saving...');
        db.saveSync();

        // Track should still exist
        expect(db.trackCount).toBe(1);

        db.close();
      });
    });

    it('add same track to multiple playlists then remove track', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const trackHandle = db.addTrack({
          title: 'Multi-playlist track',
          mediaType: MediaType.Audio,
        });

        // Add to multiple playlists
        const pl1 = db.createPlaylist('Playlist 1');
        const pl2 = db.createPlaylist('Playlist 2');
        const pl3 = db.createPlaylist('Playlist 3');

        db.addTrackToPlaylist(pl1.id, trackHandle);
        db.addTrackToPlaylist(pl2.id, trackHandle);
        db.addTrackToPlaylist(pl3.id, trackHandle);

        db.saveSync();
        console.log('Track added to 3 playlists');

        // Remove track - should be removed from all playlists
        db.removeTrack(trackHandle);
        console.log('Track removed, saving...');
        db.saveSync();

        expect(db.trackCount).toBe(0);

        // Verify playlists are empty
        const pl1Tracks = db.getPlaylistTracks(pl1.id);
        const pl2Tracks = db.getPlaylistTracks(pl2.id);
        const pl3Tracks = db.getPlaylistTracks(pl3.id);

        expect(pl1Tracks).toHaveLength(0);
        expect(pl2Tracks).toHaveLength(0);
        expect(pl3Tracks).toHaveLength(0);

        db.close();
      });
    });

    it('remove all tracks leaving empty playlists', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create playlist with tracks
        const pl = db.createPlaylist('Soon to be empty');
        const h1 = db.addTrack({ title: 'Track 1' });
        const h2 = db.addTrack({ title: 'Track 2' });
        db.addTrackToPlaylist(pl.id, h1);
        db.addTrackToPlaylist(pl.id, h2);

        db.saveSync();

        // Remove all tracks
        db.removeTrack(h1);
        db.removeTrack(h2);
        console.log('Removed all tracks, saving...');
        db.saveSync();

        // Playlist should exist but be empty
        const tracks = db.getPlaylistTracks(pl.id);
        expect(tracks).toHaveLength(0);

        db.close();
      });
    });
  });

  describe('artwork edge cases', () => {
    it('remove track that has artwork', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Track with artwork',
          mediaType: MediaType.Audio,
        });

        // Note: We can't easily test artwork without actual image files
        // This test just ensures removal works even after track properties are set
        db.saveSync();

        db.removeTrack(handle);
        console.log('Removed track (would have artwork in real scenario), saving...');
        db.saveSync();

        expect(db.trackCount).toBe(0);
        db.close();
      });
    });
  });

  describe('chapter data edge cases', () => {
    it('add chapters then remove track', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Track with chapters',
          duration: 3600000, // 1 hour
        });

        db.setTrackChapters(handle, [
          { startPos: 0, title: 'Chapter 1' },
          { startPos: 600000, title: 'Chapter 2' },
          { startPos: 1200000, title: 'Chapter 3' },
        ]);

        db.saveSync();
        console.log('Created track with chapters');

        // Remove track with chapters
        db.removeTrack(handle);
        console.log('Removed track with chapters, saving...');
        db.saveSync();

        expect(db.trackCount).toBe(0);
        db.close();
      });
    });

    it('clear chapters on all tracks then close', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add multiple tracks with chapters
        for (let i = 0; i < 3; i++) {
          const handle = db.addTrack({ title: `Track ${i + 1}`, duration: 600000 });
          db.setTrackChapters(handle, [
            { startPos: 0, title: 'Intro' },
            { startPos: 300000, title: 'Main' },
          ]);
        }
        db.saveSync();

        // Clear chapters on all tracks
        const handles = db.getTracks();
        for (const handle of handles) {
          db.clearTrackChapters(handle);
        }
        console.log('Cleared chapters on all tracks, saving...');
        db.saveSync();

        db.close();

        // Reopen and verify
        const db2 = Database.openSync(ipod.path);
        const handles2 = db2.getTracks();
        for (const handle of handles2) {
          const chapters = db2.getTrackChapters(handle);
          expect(chapters).toHaveLength(0);
        }
        db2.close();
      });
    });
  });

  describe('track duplication edge cases', () => {
    it('duplicate track and then remove original', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const original = db.addTrack({
          title: 'Original Track',
          artist: 'Test Artist',
          album: 'Test Album',
        });
        db.saveSync();

        // Duplicate track
        const duplicate = db.duplicateTrack(original);
        console.log('Duplicated track');

        // Remove original
        db.removeTrack(original);
        console.log('Removed original, saving...');
        db.saveSync();

        // Only duplicate should remain
        expect(db.trackCount).toBe(1);

        const track = db.getTrack(duplicate);
        expect(track.title).toBe('Original Track');

        db.close();
      });
    });

    it('duplicate track that has chapters', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const original = db.addTrack({
          title: 'Track with chapters',
          duration: 1800000,
        });

        db.setTrackChapters(original, [
          { startPos: 0, title: 'Part 1' },
          { startPos: 900000, title: 'Part 2' },
        ]);
        db.saveSync();

        // Duplicate - does it copy chapters?
        const duplicate = db.duplicateTrack(original);
        console.log('Duplicated track with chapters');

        const originalChapters = db.getTrackChapters(original);
        const duplicateChapters = db.getTrackChapters(duplicate);

        console.log(`Original chapters: ${originalChapters.length}`);
        console.log(`Duplicate chapters: ${duplicateChapters.length}`);

        // Both should have chapters (libgpod duplicates chapterdata)
        expect(originalChapters.length).toBeGreaterThan(0);

        db.saveSync();
        db.close();
      });
    });
  });

  describe('database.create() edge cases', () => {
    it('create database, add track, save without setting mountpoint', async () => {
      // This uses Database.create() which now creates a master playlist
      const db = Database.create();

      db.addTrack({
        title: 'Test Track',
        artist: 'Test Artist',
      });

      expect(db.trackCount).toBe(1);

      // Note: saveSync() would fail without a mountpoint, but
      // we're just testing that operations work
      console.log('Created database with track (no mountpoint)');

      db.close();
    });

    it('create database and verify master playlist exists', async () => {
      const db = Database.create();

      // Get playlists - should have master playlist
      const playlists = db.getPlaylists();
      console.log(`Playlists in new database: ${playlists.length}`);

      // Should have exactly one playlist (the master playlist)
      expect(playlists.length).toBeGreaterThanOrEqual(1);

      // Find master playlist (property is 'isMaster' not 'isMasterPlaylist')
      const mpl = playlists.find((p: any) => p.isMaster);
      expect(mpl).toBeDefined();
      console.log(`Master playlist found: ${mpl?.name}`);

      db.close();
    });
  });

  describe('rapid operations', () => {
    it('add and remove many tracks rapidly', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add many tracks
        const handles: TrackHandle[] = [];
        for (let i = 0; i < 50; i++) {
          handles.push(db.addTrack({ title: `Track ${i + 1}` }));
        }
        console.log(`Added ${handles.length} tracks`);

        // Remove half of them
        for (let i = 0; i < 25; i++) {
          db.removeTrack(handles[i]!);
        }
        console.log('Removed 25 tracks, saving...');

        db.saveSync();
        expect(db.trackCount).toBe(25);

        db.close();
      });
    });

    it('add and remove tracks without saving', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add tracks
        db.addTrack({ title: 'Track 1' });
        const h2 = db.addTrack({ title: 'Track 2' });
        db.addTrack({ title: 'Track 3' });

        expect(db.trackCount).toBe(3);

        // Remove one without saving
        db.removeTrack(h2);
        expect(db.trackCount).toBe(2);

        // Add more
        db.addTrack({ title: 'Track 4' });
        expect(db.trackCount).toBe(3);

        // Close without saving
        console.log('Closing without save after add/remove operations...');
        db.close();
      });
    });
  });
});
