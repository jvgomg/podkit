/**
 * Integration tests for libgpod-node playlist functionality.
 *
 * These tests cover: playlist CRUD operations, adding/removing tracks
 * from playlists, and playlist persistence.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';

import {
  withTestIpod,
  Database,
  LibgpodError,
} from './helpers/test-setup';

// ============================================================================
// Playlist CRUD tests
// ============================================================================

describe('libgpod-node playlist CRUD operations', () => {
  it(
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

  it(
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

  it(
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

  it(
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

  it(
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

  it(
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

  it(
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

  it(
    'can add tracks to a playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create some tracks
        const handle1 = db.addTrack({ title: 'Track 1', artist: 'Artist 1' });
        const handle2 = db.addTrack({ title: 'Track 2', artist: 'Artist 2' });

        // Create a playlist
        const playlist = db.createPlaylist('My Playlist');
        expect(playlist.trackCount).toBe(0);

        // Add tracks to playlist
        const updated1 = db.addTrackToPlaylist(playlist.id, handle1);
        expect(updated1.trackCount).toBe(1);

        const updated2 = db.addTrackToPlaylist(playlist.id, handle2);
        expect(updated2.trackCount).toBe(2);

        // Verify tracks are in the playlist
        expect(db.playlistContainsTrack(playlist.id, handle1)).toBe(true);
        expect(db.playlistContainsTrack(playlist.id, handle2)).toBe(true);

        db.close();
      });
    }
  );

  it(
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
        const allHandles = db2.getTracks();
        expect(allHandles).toHaveLength(2);

        const handle1 = allHandles.find((h) => db2.getTrack(h).title === 'First Track')!;
        const handle2 = allHandles.find((h) => db2.getTrack(h).title === 'Second Track')!;

        // Create playlist and add tracks
        const playlist = db2.createPlaylist('Playlist With Tracks');
        db2.addTrackToPlaylist(playlist.id, handle1);
        db2.addTrackToPlaylist(playlist.id, handle2);

        // Get tracks from playlist
        const playlistHandles = db2.getPlaylistTracks(playlist.id);

        expect(playlistHandles).toHaveLength(2);
        const titles = playlistHandles.map((h) => db2.getTrack(h).title);
        expect(titles).toContain('First Track');
        expect(titles).toContain('Second Track');

        db2.close();
      });
    }
  );

  it(
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
        const allHandles = db2.getTracks();
        const handle1 = allHandles.find((h) => db2.getTrack(h).title === 'Keep Me')!;
        const handle2 = allHandles.find((h) => db2.getTrack(h).title === 'Remove Me')!;

        // Create playlist and add tracks
        const playlist = db2.createPlaylist('Playlist For Removal Test');
        db2.addTrackToPlaylist(playlist.id, handle1);
        db2.addTrackToPlaylist(playlist.id, handle2);

        expect(db2.playlistContainsTrack(playlist.id, handle1)).toBe(true);
        expect(db2.playlistContainsTrack(playlist.id, handle2)).toBe(true);

        // Remove one track
        const updated = db2.removeTrackFromPlaylist(playlist.id, handle2);

        expect(updated.trackCount).toBe(1);
        expect(db2.playlistContainsTrack(playlist.id, handle1)).toBe(true);
        expect(db2.playlistContainsTrack(playlist.id, handle2)).toBe(false);

        // Verify track still exists in database (just not in playlist)
        // Re-fetch handle after save to ensure we have the correct reference
        db2.saveSync();
        const allHandles2 = db2.getTracks();
        const trackStillExists = allHandles2.find((h) => db2.getTrack(h).title === 'Remove Me');
        expect(trackStillExists).toBeDefined();

        db2.close();
      });
    }
  );

  it(
    'playlistContainsTrack returns false for tracks not in playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a track and a playlist
        const handle = db.addTrack({ title: 'Lonely Track', artist: 'Artist' });
        const playlist = db.createPlaylist('Empty Playlist');

        // Track is not in the playlist
        expect(db.playlistContainsTrack(playlist.id, handle)).toBe(false);

        db.close();
      });
    }
  );

  it(
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

  it(
    'playlist changes persist after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a playlist with tracks
        const handle = db.addTrack({ title: 'Persisted Track', artist: 'Artist' });
        const playlist = db.createPlaylist('Persisted Playlist');
        db.addTrackToPlaylist(playlist.id, handle);

        // Save and close
        db.saveSync();
        db.close();

        // Re-open and verify
        const db2 = Database.openSync(ipod.path);

        const foundPlaylist = db2.getPlaylistByName('Persisted Playlist');
        expect(foundPlaylist).not.toBeNull();
        expect(foundPlaylist!.trackCount).toBe(1);

        const playlistHandles = db2.getPlaylistTracks(foundPlaylist!.id);
        expect(playlistHandles).toHaveLength(1);
        const track = db2.getTrack(playlistHandles[0]!);
        expect(track.title).toBe('Persisted Track');

        db2.close();
      });
    }
  );

  it(
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

  it(
    'tracks added to database are in master playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track
        const handle = db.addTrack({ title: 'In Master Playlist', artist: 'Artist' });

        // Get master playlist
        const mpl = db.getMasterPlaylist();
        expect(mpl).not.toBeNull();

        // Track should be in master playlist
        expect(db.playlistContainsTrack(mpl!.id, handle)).toBe(true);

        db.close();
      });
    }
  );

  it(
    'throws error when adding track to non-existent playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Test', artist: 'Test' });

        expect(() => {
          db.addTrackToPlaylist(BigInt(999999999), handle);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it(
    'can add same track to multiple playlists',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create a track
        const handle = db.addTrack({ title: 'Shared Track', artist: 'Artist' });

        // Create multiple playlists
        const pl1 = db.createPlaylist('Playlist A');
        const pl2 = db.createPlaylist('Playlist B');
        const pl3 = db.createPlaylist('Playlist C');

        // Add same track to all playlists
        db.addTrackToPlaylist(pl1.id, handle);
        db.addTrackToPlaylist(pl2.id, handle);
        db.addTrackToPlaylist(pl3.id, handle);

        // Verify track is in all playlists
        expect(db.playlistContainsTrack(pl1.id, handle)).toBe(true);
        expect(db.playlistContainsTrack(pl2.id, handle)).toBe(true);
        expect(db.playlistContainsTrack(pl3.id, handle)).toBe(true);

        // Verify each playlist shows track count of 1
        const updated1 = db.getPlaylistById(pl1.id);
        const updated2 = db.getPlaylistById(pl2.id);
        const updated3 = db.getPlaylistById(pl3.id);

        expect(updated1!.trackCount).toBe(1);
        expect(updated2!.trackCount).toBe(1);
        expect(updated3!.trackCount).toBe(1);

        // Verify removing from one playlist doesn't affect others
        db.removeTrackFromPlaylist(pl2.id, handle);

        expect(db.playlistContainsTrack(pl1.id, handle)).toBe(true);
        expect(db.playlistContainsTrack(pl2.id, handle)).toBe(false);
        expect(db.playlistContainsTrack(pl3.id, handle)).toBe(true);

        db.close();
      });
    }
  );

  it(
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
        const allHandles = db2.getTracks();

        const handleA = allHandles.find((h) => db2.getTrack(h).title === 'AAA First')!;
        const handleB = allHandles.find((h) => db2.getTrack(h).title === 'BBB Second')!;
        const handleC = allHandles.find((h) => db2.getTrack(h).title === 'CCC Third')!;

        // Create playlist and add tracks in a specific order (B, A, C)
        const playlist = db2.createPlaylist('Ordered Playlist');
        db2.addTrackToPlaylist(playlist.id, handleB); // BBB first
        db2.addTrackToPlaylist(playlist.id, handleA); // AAA second
        db2.addTrackToPlaylist(playlist.id, handleC); // CCC third

        // Get tracks and verify order (insertion order)
        const playlistHandles = db2.getPlaylistTracks(playlist.id);
        expect(playlistHandles).toHaveLength(3);
        expect(db2.getTrack(playlistHandles[0]!).title).toBe('BBB Second');
        expect(db2.getTrack(playlistHandles[1]!).title).toBe('AAA First');
        expect(db2.getTrack(playlistHandles[2]!).title).toBe('CCC Third');

        db2.close();
      });
    }
  );

  it(
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

  it(
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

  it(
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

  it(
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

  it(
    'removing track from playlist where track is not present is safe',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({ title: 'Not In Playlist', artist: 'Artist' });
        const playlist = db.createPlaylist('Empty Playlist');

        // Track is not in playlist
        expect(db.playlistContainsTrack(playlist.id, handle)).toBe(false);

        // Removing a track that isn't in the playlist should be safe
        // (libgpod's itdb_playlist_remove_track handles this gracefully)
        const updated = db.removeTrackFromPlaylist(playlist.id, handle);

        // Playlist should still be valid
        expect(updated.trackCount).toBe(0);

        db.close();
      });
    }
  );

  it(
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
});
