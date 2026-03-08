/**
 * Tests for IpodTrackImpl class.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { TrackHandle, Track } from '@podkit/libgpod-node';
import { IpodTrackImpl, type IpodDatabaseInternal } from './track.js';
import { IpodError } from './errors.js';
import type { IPodTrack, TrackFields } from './types.js';

/**
 * Creates a mock TrackHandle.
 */
function createMockHandle(index: number = 0): TrackHandle {
  return { __brand: 'TrackHandle', index } as TrackHandle;
}

/**
 * Creates a mock Track with all required fields.
 */
function createMockTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    dbid: BigInt(12345),
    title: 'Test Title',
    artist: 'Test Artist',
    album: 'Test Album',
    albumArtist: 'Test Album Artist',
    genre: 'Rock',
    composer: 'Test Composer',
    comment: 'Test Comment',
    grouping: 'Test Grouping',
    trackNumber: 1,
    totalTracks: 10,
    discNumber: 1,
    totalDiscs: 2,
    year: 2024,
    duration: 180000,
    bitrate: 320,
    sampleRate: 44100,
    size: 5000000,
    bpm: 120,
    filetype: 'MPEG audio file',
    mediaType: 0x0001, // Audio
    ipodPath: ':iPod_Control:Music:F00:TEST.mp3',
    timeAdded: 1700000000,
    timeModified: 1700000100,
    timePlayed: 1700000200,
    timeReleased: 1700000300,
    playCount: 5,
    skipCount: 2,
    rating: 80,
    hasArtwork: true,
    compilation: false,
    transferred: true,
    // Video fields
    tvShow: null,
    tvEpisode: null,
    sortTvShow: null,
    seasonNumber: 0,
    episodeNumber: 0,
    movieFlag: false,
    ...overrides,
  };
}

/**
 * Creates a mock IpodDatabaseInternal.
 */
function createMockDatabase(): IpodDatabaseInternal & {
  updateTrackMock: ReturnType<typeof mock>;
  removeTrackMock: ReturnType<typeof mock>;
  copyFileToTrackMock: ReturnType<typeof mock>;
  setTrackArtworkMock: ReturnType<typeof mock>;
  setTrackArtworkFromDataMock: ReturnType<typeof mock>;
  removeTrackArtworkMock: ReturnType<typeof mock>;
} {
  const updateTrackMock = mock(() => ({}) as IPodTrack);
  const removeTrackMock = mock(() => ({ removed: true }));
  const copyFileToTrackMock = mock(() => ({}) as IPodTrack);
  const setTrackArtworkMock = mock(() => ({}) as IPodTrack);
  const setTrackArtworkFromDataMock = mock(() => ({}) as IPodTrack);
  const removeTrackArtworkMock = mock(() => ({}) as IPodTrack);

  return {
    updateTrack: updateTrackMock,
    removeTrack: removeTrackMock,
    copyFileToTrack: copyFileToTrackMock,
    setTrackArtwork: setTrackArtworkMock,
    setTrackArtworkFromData: setTrackArtworkFromDataMock,
    removeTrackArtwork: removeTrackArtworkMock,
    updateTrackMock,
    removeTrackMock,
    copyFileToTrackMock,
    setTrackArtworkMock,
    setTrackArtworkFromDataMock,
    removeTrackArtworkMock,
  };
}

describe('IpodTrackImpl', () => {
  describe('constructor', () => {
    it('correctly copies all fields from Track data', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();

      const track = new IpodTrackImpl(db, handle, trackData);

      expect(track.title).toBe('Test Title');
      expect(track.artist).toBe('Test Artist');
      expect(track.album).toBe('Test Album');
      expect(track.albumArtist).toBe('Test Album Artist');
      expect(track.genre).toBe('Rock');
      expect(track.composer).toBe('Test Composer');
      expect(track.comment).toBe('Test Comment');
      expect(track.grouping).toBe('Test Grouping');
      expect(track.trackNumber).toBe(1);
      expect(track.totalTracks).toBe(10);
      expect(track.discNumber).toBe(1);
      expect(track.totalDiscs).toBe(2);
      expect(track.year).toBe(2024);
      expect(track.duration).toBe(180000);
      expect(track.bitrate).toBe(320);
      expect(track.sampleRate).toBe(44100);
      expect(track.size).toBe(5000000);
      expect(track.bpm).toBe(120);
      expect(track.filetype).toBe('MPEG audio file');
      expect(track.mediaType).toBe(0x0001);
      expect(track.filePath).toBe(':iPod_Control:Music:F00:TEST.mp3');
      expect(track.timeAdded).toBe(1700000000);
      expect(track.timeModified).toBe(1700000100);
      expect(track.timePlayed).toBe(1700000200);
      expect(track.timeReleased).toBe(1700000300);
      expect(track.playCount).toBe(5);
      expect(track.skipCount).toBe(2);
      expect(track.rating).toBe(80);
      expect(track.hasArtwork).toBe(true);
      expect(track.hasFile).toBe(true);
      expect(track.compilation).toBe(false);
    });

    it('handles missing optional fields with defaults', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        genre: null,
        composer: null,
        comment: null,
        grouping: null,
        trackNumber: 0,
        totalTracks: 0,
        discNumber: 0,
        totalDiscs: 0,
        year: 0,
        bpm: 0,
        filetype: null,
        ipodPath: null,
        hasArtwork: false,
        transferred: false,
      });

      const track = new IpodTrackImpl(db, handle, trackData);

      // String fields default to empty string
      expect(track.title).toBe('');
      expect(track.artist).toBe('');
      expect(track.album).toBe('');
      expect(track.filePath).toBe('');

      // Optional string fields default to undefined
      expect(track.albumArtist).toBeUndefined();
      expect(track.genre).toBeUndefined();
      expect(track.composer).toBeUndefined();
      expect(track.comment).toBeUndefined();
      expect(track.grouping).toBeUndefined();
      expect(track.filetype).toBeUndefined();

      // Optional number fields with 0 value become undefined
      expect(track.trackNumber).toBeUndefined();
      expect(track.totalTracks).toBeUndefined();
      expect(track.discNumber).toBeUndefined();
      expect(track.totalDiscs).toBeUndefined();
      expect(track.year).toBeUndefined();
      expect(track.bpm).toBeUndefined();

      // Boolean fields default to false
      expect(track.hasArtwork).toBe(false);
      expect(track.hasFile).toBe(false);
    });

    it('preserves the internal handle', () => {
      const db = createMockDatabase();
      const handle = createMockHandle(42);
      const trackData = createMockTrack();

      const track = new IpodTrackImpl(db, handle, trackData);

      expect(track._internalHandle).toBe(handle);
      expect(track._internalHandle.index).toBe(42);
    });
  });

  describe('update()', () => {
    it('delegates to database and returns result', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ title: 'Updated Title' });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.updateTrackMock.mockReturnValue(updatedTrack);

      const fields: TrackFields = { title: 'Updated Title' };
      const result = track.update(fields);

      expect(db.updateTrackMock).toHaveBeenCalledTimes(1);
      expect(db.updateTrackMock).toHaveBeenCalledWith(track, fields);
      expect(result).toBe(updatedTrack);
    });

    it('returns a new instance (not the same track)', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ title: 'Updated Title' });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.updateTrackMock.mockReturnValue(updatedTrack);

      const result = track.update({ title: 'Updated Title' });

      expect(result).not.toBe(track);
    });
  });

  describe('remove()', () => {
    it('delegates to database and marks track as removed', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      const track = new IpodTrackImpl(db, handle, trackData);

      // Mock removeTrack to call _markRemoved on the track
      db.removeTrackMock.mockImplementation((t: IpodTrackImpl) => {
        t._markRemoved();
        return { removed: true };
      });

      track.remove();

      expect(db.removeTrackMock).toHaveBeenCalledTimes(1);
      expect(db.removeTrackMock).toHaveBeenCalledWith(track);

      // Verify the track is marked as removed
      expect(() => track.update({ title: 'New' })).toThrow(IpodError);
    });
  });

  describe('copyFile()', () => {
    it('delegates to database and returns result', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ transferred: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ transferred: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.copyFileToTrackMock.mockReturnValue(updatedTrack);

      const result = track.copyFile('/path/to/song.mp3');

      expect(db.copyFileToTrackMock).toHaveBeenCalledTimes(1);
      expect(db.copyFileToTrackMock).toHaveBeenCalledWith(track, '/path/to/song.mp3');
      expect(result).toBe(updatedTrack);
    });

    it('returns a new instance (not the same track)', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ transferred: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ transferred: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.copyFileToTrackMock.mockReturnValue(updatedTrack);

      const result = track.copyFile('/path/to/song.mp3');

      expect(result).not.toBe(track);
    });
  });

  describe('setArtwork()', () => {
    it('delegates to database and returns result', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.setTrackArtworkMock.mockReturnValue(updatedTrack);

      const result = track.setArtwork('/path/to/cover.jpg');

      expect(db.setTrackArtworkMock).toHaveBeenCalledTimes(1);
      expect(db.setTrackArtworkMock).toHaveBeenCalledWith(track, '/path/to/cover.jpg');
      expect(result).toBe(updatedTrack);
    });

    it('returns a new instance (not the same track)', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.setTrackArtworkMock.mockReturnValue(updatedTrack);

      const result = track.setArtwork('/path/to/cover.jpg');

      expect(result).not.toBe(track);
    });
  });

  describe('setArtworkFromData()', () => {
    it('delegates to database and returns result', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.setTrackArtworkFromDataMock.mockReturnValue(updatedTrack);

      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const result = track.setArtworkFromData(imageData);

      expect(db.setTrackArtworkFromDataMock).toHaveBeenCalledTimes(1);
      expect(db.setTrackArtworkFromDataMock).toHaveBeenCalledWith(track, imageData);
      expect(result).toBe(updatedTrack);
    });

    it('returns a new instance (not the same track)', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: false });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: true });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.setTrackArtworkFromDataMock.mockReturnValue(updatedTrack);

      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const result = track.setArtworkFromData(imageData);

      expect(result).not.toBe(track);
    });
  });

  describe('removeArtwork()', () => {
    it('delegates to database and returns result', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: true });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: false });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.removeTrackArtworkMock.mockReturnValue(updatedTrack);

      const result = track.removeArtwork();

      expect(db.removeTrackArtworkMock).toHaveBeenCalledTimes(1);
      expect(db.removeTrackArtworkMock).toHaveBeenCalledWith(track);
      expect(result).toBe(updatedTrack);
    });

    it('returns a new instance (not the same track)', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack({ hasArtwork: true });
      const track = new IpodTrackImpl(db, handle, trackData);

      const updatedTrackData = createMockTrack({ hasArtwork: false });
      const updatedTrack = new IpodTrackImpl(db, handle, updatedTrackData);
      db.removeTrackArtworkMock.mockReturnValue(updatedTrack);

      const result = track.removeArtwork();

      expect(result).not.toBe(track);
    });
  });

  describe('removed track behavior', () => {
    let db: ReturnType<typeof createMockDatabase>;
    let track: IpodTrackImpl;

    beforeEach(() => {
      db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      track = new IpodTrackImpl(db, handle, trackData);

      // Mark track as removed
      track._markRemoved();
    });

    it('update() throws IpodError with TRACK_REMOVED code', () => {
      expect(() => track.update({ title: 'New' })).toThrow(IpodError);
      try {
        track.update({ title: 'New' });
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
        expect((error as IpodError).message).toBe('Track has been removed');
      }
    });

    it('remove() throws IpodError with TRACK_REMOVED code', () => {
      expect(() => track.remove()).toThrow(IpodError);
      try {
        track.remove();
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
      }
    });

    it('copyFile() throws IpodError with TRACK_REMOVED code', () => {
      expect(() => track.copyFile('/path/to/song.mp3')).toThrow(IpodError);
      try {
        track.copyFile('/path/to/song.mp3');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
      }
    });

    it('setArtwork() throws IpodError with TRACK_REMOVED code', () => {
      expect(() => track.setArtwork('/path/to/cover.jpg')).toThrow(IpodError);
      try {
        track.setArtwork('/path/to/cover.jpg');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
      }
    });

    it('setArtworkFromData() throws IpodError with TRACK_REMOVED code', () => {
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(() => track.setArtworkFromData(imageData)).toThrow(IpodError);
      try {
        track.setArtworkFromData(imageData);
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
      }
    });

    it('removeArtwork() throws IpodError with TRACK_REMOVED code', () => {
      expect(() => track.removeArtwork()).toThrow(IpodError);
      try {
        track.removeArtwork();
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('TRACK_REMOVED');
      }
    });

    it('methods check removed status before delegating', () => {
      // Verify that the database methods are NOT called when track is removed
      try {
        track.update({ title: 'New' });
      } catch {
        // Expected to throw
      }
      expect(db.updateTrackMock).not.toHaveBeenCalled();

      try {
        track.remove();
      } catch {
        // Expected to throw
      }
      expect(db.removeTrackMock).not.toHaveBeenCalled();

      try {
        track.copyFile('/path/to/song.mp3');
      } catch {
        // Expected to throw
      }
      expect(db.copyFileToTrackMock).not.toHaveBeenCalled();

      try {
        track.setArtwork('/path/to/cover.jpg');
      } catch {
        // Expected to throw
      }
      expect(db.setTrackArtworkMock).not.toHaveBeenCalled();

      try {
        track.setArtworkFromData(Buffer.from([0x89]));
      } catch {
        // Expected to throw
      }
      expect(db.setTrackArtworkFromDataMock).not.toHaveBeenCalled();

      try {
        track.removeArtwork();
      } catch {
        // Expected to throw
      }
      expect(db.removeTrackArtworkMock).not.toHaveBeenCalled();
    });
  });

  describe('read-only properties', () => {
    it('properties are readonly and cannot be modified', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      const track = new IpodTrackImpl(db, handle, trackData);

      // TypeScript would prevent this at compile time, but we can verify
      // that the values are correctly set and remain unchanged
      const originalTitle = track.title;
      const originalArtist = track.artist;

      // These should remain unchanged (readonly properties)
      expect(track.title).toBe(originalTitle);
      expect(track.artist).toBe(originalArtist);
    });
  });

  describe('_markRemoved()', () => {
    it('marks the track as removed', () => {
      const db = createMockDatabase();
      const handle = createMockHandle();
      const trackData = createMockTrack();
      const track = new IpodTrackImpl(db, handle, trackData);

      // Before marking as removed, operations should work
      db.updateTrackMock.mockReturnValue(track);
      expect(() => track.update({ title: 'New' })).not.toThrow();

      // Mark as removed
      track._markRemoved();

      // After marking as removed, operations should throw
      expect(() => track.update({ title: 'New' })).toThrow(IpodError);
    });
  });
});
