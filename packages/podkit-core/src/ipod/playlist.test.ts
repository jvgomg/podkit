/**
 * Tests for IpodPlaylistImpl class.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { Playlist } from '@podkit/libgpod-node';
import { IpodPlaylistImpl, type PlaylistDatabaseInternal } from './playlist.js';
import { IpodError } from './errors.js';
import type { IpodTrack } from './types.js';

// Helper to create a mock Playlist data object
function createMockPlaylistData(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 12345n,
    name: 'Test Playlist',
    trackCount: 5,
    isMaster: false,
    isSmart: false,
    isPodcasts: false,
    timestamp: 1700000000,
    ...overrides,
  };
}

// Helper to create a mock database interface
function createMockDatabase(): PlaylistDatabaseInternal & {
  renamePlaylist: ReturnType<typeof mock>;
  removePlaylist: ReturnType<typeof mock>;
  getPlaylistTracks: ReturnType<typeof mock>;
  addTrackToPlaylist: ReturnType<typeof mock>;
  removeTrackFromPlaylist: ReturnType<typeof mock>;
  playlistContainsTrack: ReturnType<typeof mock>;
} {
  return {
    renamePlaylist: mock(),
    removePlaylist: mock(),
    getPlaylistTracks: mock(),
    addTrackToPlaylist: mock(),
    removeTrackFromPlaylist: mock(),
    playlistContainsTrack: mock(),
  };
}

// Helper to create a mock track
function createMockTrack(): IpodTrack {
  return {
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    syncTag: null,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath: ':iPod_Control:Music:F00:TEST.mp3',
    timeAdded: 1700000000,
    timeModified: 1700000000,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    update: mock(),
    remove: mock(),
    copyFile: mock(),
    setArtwork: mock(),
    setArtworkFromData: mock(),
    removeArtwork: mock(),
  };
}

describe('IpodPlaylistImpl', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let playlistData: Playlist;
  let playlist: IpodPlaylistImpl;

  beforeEach(() => {
    mockDb = createMockDatabase();
    playlistData = createMockPlaylistData();
    playlist = new IpodPlaylistImpl(mockDb, playlistData.id, playlistData);
  });

  describe('constructor', () => {
    it('correctly copies all fields from Playlist data', () => {
      const data = createMockPlaylistData({
        id: 99999n,
        name: 'Custom Playlist',
        trackCount: 42,
        isMaster: false,
        isSmart: true,
        isPodcasts: false,
        timestamp: 1699999999,
      });

      const pl = new IpodPlaylistImpl(mockDb, data.id, data);

      expect(pl.name).toBe('Custom Playlist');
      expect(pl.trackCount).toBe(42);
      expect(pl.isMaster).toBe(false);
      expect(pl.isSmart).toBe(true);
      expect(pl.isPodcasts).toBe(false);
      expect(pl.timestamp).toBe(1699999999);
    });

    it('handles null name by using empty string', () => {
      const data = createMockPlaylistData({ name: null });
      const pl = new IpodPlaylistImpl(mockDb, data.id, data);
      expect(pl.name).toBe('');
    });

    it('stores internal playlist ID', () => {
      const data = createMockPlaylistData({ id: 54321n });
      const pl = new IpodPlaylistImpl(mockDb, data.id, data);
      expect(pl._internalId).toBe(54321n);
    });

    it('copies master playlist flag', () => {
      const data = createMockPlaylistData({ isMaster: true });
      const pl = new IpodPlaylistImpl(mockDb, data.id, data);
      expect(pl.isMaster).toBe(true);
    });

    it('copies podcasts playlist flag', () => {
      const data = createMockPlaylistData({ isPodcasts: true });
      const pl = new IpodPlaylistImpl(mockDb, data.id, data);
      expect(pl.isPodcasts).toBe(true);
    });
  });

  describe('rename()', () => {
    it('delegates to database and returns result', () => {
      const newPlaylistSnapshot = new IpodPlaylistImpl(
        mockDb,
        playlistData.id,
        createMockPlaylistData({ name: 'New Name' })
      );
      mockDb.renamePlaylist.mockReturnValue(newPlaylistSnapshot);

      const result = playlist.rename('New Name');

      expect(mockDb.renamePlaylist).toHaveBeenCalledWith(playlist, 'New Name');
      expect(result).toBe(newPlaylistSnapshot);
    });

    it('throws IpodError for master playlist', () => {
      const masterData = createMockPlaylistData({ isMaster: true });
      const masterPlaylist = new IpodPlaylistImpl(mockDb, masterData.id, masterData);

      expect(() => masterPlaylist.rename('New Name')).toThrow(IpodError);
      expect(() => masterPlaylist.rename('New Name')).toThrow('Cannot rename master playlist');
      expect(mockDb.renamePlaylist).not.toHaveBeenCalled();
    });

    it('throws IpodError if playlist has been removed', () => {
      playlist._markRemoved();

      expect(() => playlist.rename('New Name')).toThrow(IpodError);
      expect(() => playlist.rename('New Name')).toThrow('Playlist has been removed');
      expect(mockDb.renamePlaylist).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('marks playlist as removed', () => {
      playlist.remove();

      expect(mockDb.removePlaylist).toHaveBeenCalledWith(playlist);
    });

    it('throws IpodError for master playlist', () => {
      const masterData = createMockPlaylistData({ isMaster: true });
      const masterPlaylist = new IpodPlaylistImpl(mockDb, masterData.id, masterData);

      expect(() => masterPlaylist.remove()).toThrow(IpodError);
      expect(() => masterPlaylist.remove()).toThrow('Cannot remove master playlist');
      expect(mockDb.removePlaylist).not.toHaveBeenCalled();
    });

    it('throws IpodError if playlist has already been removed', () => {
      playlist._markRemoved();

      expect(() => playlist.remove()).toThrow(IpodError);
      expect(() => playlist.remove()).toThrow('Playlist has been removed');
      expect(mockDb.removePlaylist).not.toHaveBeenCalled();
    });
  });

  describe('getTracks()', () => {
    it('delegates to database', () => {
      const mockTracks = [createMockTrack(), createMockTrack()];
      mockDb.getPlaylistTracks.mockReturnValue(mockTracks);

      const result = playlist.getTracks();

      expect(mockDb.getPlaylistTracks).toHaveBeenCalledWith(playlist);
      expect(result).toBe(mockTracks);
    });

    it('throws IpodError if playlist has been removed', () => {
      playlist._markRemoved();

      expect(() => playlist.getTracks()).toThrow(IpodError);
      expect(() => playlist.getTracks()).toThrow('Playlist has been removed');
      expect(mockDb.getPlaylistTracks).not.toHaveBeenCalled();
    });
  });

  describe('addTrack()', () => {
    it('delegates to database and returns result', () => {
      const track = createMockTrack();
      const newPlaylistSnapshot = new IpodPlaylistImpl(
        mockDb,
        playlistData.id,
        createMockPlaylistData({ trackCount: 6 })
      );
      mockDb.addTrackToPlaylist.mockReturnValue(newPlaylistSnapshot);

      const result = playlist.addTrack(track);

      expect(mockDb.addTrackToPlaylist).toHaveBeenCalledWith(playlist, track);
      expect(result).toBe(newPlaylistSnapshot);
    });

    it('throws IpodError if playlist has been removed', () => {
      const track = createMockTrack();
      playlist._markRemoved();

      expect(() => playlist.addTrack(track)).toThrow(IpodError);
      expect(() => playlist.addTrack(track)).toThrow('Playlist has been removed');
      expect(mockDb.addTrackToPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('removeTrack()', () => {
    it('delegates to database and returns result', () => {
      const track = createMockTrack();
      const newPlaylistSnapshot = new IpodPlaylistImpl(
        mockDb,
        playlistData.id,
        createMockPlaylistData({ trackCount: 4 })
      );
      mockDb.removeTrackFromPlaylist.mockReturnValue(newPlaylistSnapshot);

      const result = playlist.removeTrack(track);

      expect(mockDb.removeTrackFromPlaylist).toHaveBeenCalledWith(playlist, track);
      expect(result).toBe(newPlaylistSnapshot);
    });

    it('throws IpodError if playlist has been removed', () => {
      const track = createMockTrack();
      playlist._markRemoved();

      expect(() => playlist.removeTrack(track)).toThrow(IpodError);
      expect(() => playlist.removeTrack(track)).toThrow('Playlist has been removed');
      expect(mockDb.removeTrackFromPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('containsTrack()', () => {
    it('delegates to database', () => {
      const track = createMockTrack();
      mockDb.playlistContainsTrack.mockReturnValue(true);

      const result = playlist.containsTrack(track);

      expect(mockDb.playlistContainsTrack).toHaveBeenCalledWith(playlist, track);
      expect(result).toBe(true);
    });

    it('returns false when track is not in playlist', () => {
      const track = createMockTrack();
      mockDb.playlistContainsTrack.mockReturnValue(false);

      const result = playlist.containsTrack(track);

      expect(result).toBe(false);
    });

    it('throws IpodError if playlist has been removed', () => {
      const track = createMockTrack();
      playlist._markRemoved();

      expect(() => playlist.containsTrack(track)).toThrow(IpodError);
      expect(() => playlist.containsTrack(track)).toThrow('Playlist has been removed');
      expect(mockDb.playlistContainsTrack).not.toHaveBeenCalled();
    });
  });

  describe('master playlist protection', () => {
    let masterPlaylist: IpodPlaylistImpl;

    beforeEach(() => {
      const masterData = createMockPlaylistData({
        name: 'iPod',
        isMaster: true,
      });
      masterPlaylist = new IpodPlaylistImpl(mockDb, masterData.id, masterData);
    });

    it('cannot rename master playlist', () => {
      expect(() => masterPlaylist.rename('New Name')).toThrow(IpodError);

      try {
        masterPlaylist.rename('New Name');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('cannot remove master playlist', () => {
      expect(() => masterPlaylist.remove()).toThrow(IpodError);

      try {
        masterPlaylist.remove();
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('can get tracks from master playlist', () => {
      const mockTracks = [createMockTrack()];
      mockDb.getPlaylistTracks.mockReturnValue(mockTracks);

      const result = masterPlaylist.getTracks();

      expect(result).toBe(mockTracks);
    });

    it('can add track to master playlist', () => {
      const track = createMockTrack();
      const newSnapshot = new IpodPlaylistImpl(
        mockDb,
        masterPlaylist._internalId,
        createMockPlaylistData({ isMaster: true, trackCount: 2 })
      );
      mockDb.addTrackToPlaylist.mockReturnValue(newSnapshot);

      const result = masterPlaylist.addTrack(track);

      expect(mockDb.addTrackToPlaylist).toHaveBeenCalledWith(masterPlaylist, track);
      expect(result).toBe(newSnapshot);
    });
  });

  describe('removed playlist operations', () => {
    beforeEach(() => {
      playlist._markRemoved();
    });

    it('rename throws PLAYLIST_REMOVED error', () => {
      try {
        playlist.rename('New Name');
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
        expect((error as IpodError).message).toBe('Playlist has been removed');
      }
    });

    it('remove throws PLAYLIST_REMOVED error', () => {
      try {
        playlist.remove();
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
        expect((error as IpodError).message).toBe('Playlist has been removed');
      }
    });

    it('getTracks throws PLAYLIST_REMOVED error', () => {
      try {
        playlist.getTracks();
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('addTrack throws PLAYLIST_REMOVED error', () => {
      const track = createMockTrack();
      try {
        playlist.addTrack(track);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('removeTrack throws PLAYLIST_REMOVED error', () => {
      const track = createMockTrack();
      try {
        playlist.removeTrack(track);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('containsTrack throws PLAYLIST_REMOVED error', () => {
      const track = createMockTrack();
      try {
        playlist.containsTrack(track);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('PLAYLIST_REMOVED');
      }
    });

    it('all methods check removed status before delegating to database', () => {
      const track = createMockTrack();

      expect(() => playlist.rename('New Name')).toThrow();
      expect(() => playlist.remove()).toThrow();
      expect(() => playlist.getTracks()).toThrow();
      expect(() => playlist.addTrack(track)).toThrow();
      expect(() => playlist.removeTrack(track)).toThrow();
      expect(() => playlist.containsTrack(track)).toThrow();

      // Verify no database methods were called
      expect(mockDb.renamePlaylist).not.toHaveBeenCalled();
      expect(mockDb.removePlaylist).not.toHaveBeenCalled();
      expect(mockDb.getPlaylistTracks).not.toHaveBeenCalled();
      expect(mockDb.addTrackToPlaylist).not.toHaveBeenCalled();
      expect(mockDb.removeTrackFromPlaylist).not.toHaveBeenCalled();
      expect(mockDb.playlistContainsTrack).not.toHaveBeenCalled();
    });
  });

  describe('_markRemoved()', () => {
    it('marks playlist as removed', () => {
      expect(() => playlist.getTracks()).not.toThrow();

      playlist._markRemoved();

      expect(() => playlist.getTracks()).toThrow(IpodError);
    });

    it('can be called multiple times', () => {
      playlist._markRemoved();
      playlist._markRemoved();

      expect(() => playlist.getTracks()).toThrow(IpodError);
    });
  });

  describe('_internalId', () => {
    it('returns the playlist ID', () => {
      const data = createMockPlaylistData({ id: 99887766n });
      const pl = new IpodPlaylistImpl(mockDb, data.id, data);

      expect(pl._internalId).toBe(99887766n);
    });
  });
});
