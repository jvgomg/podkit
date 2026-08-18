/**
 * Unit tests for IpodDatabase class.
 *
 * Note: Most IpodDatabase functionality is best tested via integration tests
 * because IpodDatabase requires a real iPod database (via libgpod-node's
 * Database class). See database.integration.test.ts for full coverage.
 *
 * These unit tests cover the limited cases that can be tested without
 * requiring a real iPod database.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  IpodDatabase,
  discardUnvouchedPlaybackDatabase,
  type PlaybackDbFsOps,
} from './database.js';
import { IpodError } from './errors.js';

/**
 * Build a minimal `IpodDatabase` instance backed by a fake `db` object,
 * bypassing the private constructor. Only the properties touched by the
 * method under test need to be present on the fake.
 */
function makeInstance(fakeDb: Record<string, unknown>, closed = false): IpodDatabase {
  const instance = Object.create(IpodDatabase.prototype) as IpodDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).db = fakeDb;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any)._mountPoint = '/fake';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any)._closed = closed;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).trackHandles = new WeakMap();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).playlistIds = new WeakMap();
  return instance;
}

describe('IpodDatabase', () => {
  describe('open()', () => {
    it('throws NOT_FOUND error if mount point does not exist', async () => {
      try {
        await IpodDatabase.open('/nonexistent/path');
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('NOT_FOUND');
        expect((error as IpodError).message).toContain('iPod not found');
      }
    });

    it('throws NOT_FOUND error with descriptive message', async () => {
      const path = '/this/path/definitely/does/not/exist';
      try {
        await IpodDatabase.open(path);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IpodError);
        expect((error as IpodError).code).toBe('NOT_FOUND');
        expect((error as IpodError).message).toContain(path);
      }
    });
  });

  describe('setDeviceName()', () => {
    it('throws DATABASE_CLOSED when the database has been closed', () => {
      const instance = makeInstance({}, true /* closed */);
      expect(() => instance.setDeviceName('Party iPod')).toThrow(IpodError);
      try {
        instance.setDeviceName('Party iPod');
      } catch (err) {
        expect(err).toBeInstanceOf(IpodError);
        expect((err as IpodError).code).toBe('DATABASE_CLOSED');
      }
    });

    it('surfaces a write failure as IpodError with code SAVE_FAILED', () => {
      const fakeDb = {
        setDeviceName: () => {
          throw new Error('native write error');
        },
      };
      const instance = makeInstance(fakeDb);
      expect(() => instance.setDeviceName('Party iPod')).toThrow(IpodError);
      try {
        instance.setDeviceName('Party iPod');
      } catch (err) {
        expect(err).toBeInstanceOf(IpodError);
        expect((err as IpodError).code).toBe('SAVE_FAILED');
        expect((err as IpodError).message).toContain('native write error');
      }
    });
  });

  describe('discardUnvouchedPlaybackDatabase()', () => {
    const MOUNT = '/Volumes/IPOD';
    const ITUNESSD = join(MOUNT, 'iPod_Control', 'iTunes', 'iTunesSD');

    /** Records what was removed so a no-op can be told from a deletion. */
    function makeFs(present: string[]): PlaybackDbFsOps & { removed: string[] } {
      const files = new Set(present);
      const removed: string[] = [];
      return {
        removed,
        existsSync: (p) => files.has(p),
        rmSync: (p) => {
          files.delete(p);
          removed.push(p);
        },
      };
    }

    it('removes an iTunesSD the initialisation just created', () => {
      // libgpod writes one whenever it is given no model number — in the bdhs
      // format of a shuffle 3G/4G, for a device nothing has identified.
      const fs = makeFs([ITUNESSD]);
      expect(discardUnvouchedPlaybackDatabase(MOUNT, false, fs)).toBe(true);
      expect(fs.removed).toEqual([ITUNESSD]);
    });

    it('keeps an iTunesSD the device already had', () => {
      // libgpod skips the write when a file is present, so this one is the
      // device's own — deleting it would destroy a working playback database.
      const fs = makeFs([ITUNESSD]);
      expect(discardUnvouchedPlaybackDatabase(MOUNT, true, fs)).toBe(false);
      expect(fs.removed).toEqual([]);
    });

    it('does nothing when no iTunesSD was written', () => {
      const fs = makeFs([]);
      expect(discardUnvouchedPlaybackDatabase(MOUNT, false, fs)).toBe(false);
      expect(fs.removed).toEqual([]);
    });
  });

  // Note: The following behaviors are tested in integration tests because
  // they require creating a real IpodDatabase instance:
  //
  // - Track operations (addTrack, updateTrack, removeTrack, etc.)
  // - Playlist operations (createPlaylist, renamePlaylist, etc.)
  // - Track/playlist handle management (TRACK_REMOVED, PLAYLIST_REMOVED errors)
  // - save() and warning generation
  //
  // See database.integration.test.ts for comprehensive coverage.
});
