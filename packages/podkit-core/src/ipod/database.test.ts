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
import { IpodDatabase } from './database.js';
import { IpodError } from './errors.js';

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

  // Note: The following behaviors are tested in integration tests because
  // they require creating a real IpodDatabase instance:
  //
  // - Closed state behavior (DATABASE_CLOSED errors)
  // - Track operations (addTrack, updateTrack, removeTrack, etc.)
  // - Playlist operations (createPlaylist, renamePlaylist, etc.)
  // - Track/playlist handle management (TRACK_REMOVED, PLAYLIST_REMOVED errors)
  // - save() and warning generation
  //
  // See database.integration.test.ts for comprehensive coverage.
});
