/**
 * Integration tests for track file replacement.
 *
 * Tests for `replaceTrackFile()` which enables "self-healing sync" where a
 * track's audio file can be upgraded in-place (e.g., MP3 -> AAC) while
 * preserving play counts, ratings, and playlist membership.
 *
 * Also verifies that calling `copyTrackToDevice()` a second time on an
 * already-transferred track is a no-op (the underlying libgpod behavior
 * that `replaceTrackFile()` works around).
 */

import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  withTestIpod,
  Database,
  ipodPathToFilePath,
  LibgpodError,
  TEST_MP3_PATH,
} from './helpers/test-setup';
import { ensureFixturesExist, getMultiFormatFixturesDir } from '@podkit/test-fixtures';

ensureFixturesExist('multi-format');

// Second test file: a different MP3 from the multi-format fixture set.
const TEST_MP3_PATH_2 = join(getMultiFormatFixturesDir(), '05-mp3-track.mp3');

// AAC test file: for cross-format replacement tests (MP3 → AAC).
const TEST_AAC_PATH = join(getMultiFormatFixturesDir(), '06-aac-track.m4a');

describe('copyTrackToDevice() called twice on same track', () => {
  it('second call is a no-op when track is already transferred', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add a track and copy the first file
      const handle = db.addTrack({
        title: 'Replace Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      const firstCopy = db.copyTrackToDevice(handle, TEST_MP3_PATH);
      expect(firstCopy.ipodPath).not.toBeNull();
      expect(firstCopy.transferred).toBe(true);

      const firstIpodPath = firstCopy.ipodPath!;
      const firstFilePath = join(ipod.path, ipodPathToFilePath(firstIpodPath));
      expect(existsSync(firstFilePath)).toBe(true);

      const firstFileStats = await stat(firstFilePath);
      const originalMp3Stats = await stat(TEST_MP3_PATH);
      expect(firstFileStats.size).toBe(originalMp3Stats.size);

      // Now call copyTrackToDevice() AGAIN with a different, larger file.
      // Because track->transferred is TRUE, libgpod will return TRUE
      // immediately without actually copying the new file.
      const secondCopy = db.copyTrackToDevice(handle, TEST_MP3_PATH_2);

      // The call succeeds (returns the track object)
      expect(secondCopy.transferred).toBe(true);

      // The ipodPath should be unchanged
      expect(secondCopy.ipodPath).toBe(firstIpodPath);

      // The file on disk should NOT have changed - it should still be
      // the original file's size, not the new file's size
      const secondFileStats = await stat(firstFilePath);
      const newMp3Stats = await stat(TEST_MP3_PATH_2);

      // This is the key assertion: the file was NOT replaced
      expect(secondFileStats.size).toBe(originalMp3Stats.size);
      expect(secondFileStats.size).not.toBe(newMp3Stats.size);

      db.close();
    });
  });
});

describe('replaceTrackFile()', () => {
  it('replaces the file on the iPod with a new path', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add and transfer initial file
      const handle = db.addTrack({
        title: 'Replacement Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });
      const firstCopy = db.copyTrackToDevice(handle, TEST_MP3_PATH);
      const originalIpodPath = firstCopy.ipodPath!;
      const originalFilePath = join(ipod.path, ipodPathToFilePath(originalIpodPath));

      const originalFileStats = await stat(originalFilePath);
      const originalMp3Stats = await stat(TEST_MP3_PATH);
      expect(originalFileStats.size).toBe(originalMp3Stats.size);

      // Replace the file with a different one
      const replaced = db.replaceTrackFile(handle, TEST_MP3_PATH_2);

      // ipodPath changes (new path generated with correct extension)
      expect(replaced.ipodPath).not.toBe(originalIpodPath);
      // Same format so same extension
      expect(replaced.ipodPath).toMatch(/\.mp3$/);

      // The transferred flag should be TRUE again
      expect(replaced.transferred).toBe(true);

      // Old file should be deleted
      expect(existsSync(originalFilePath)).toBe(false);

      // New file should exist with the replacement content
      const newFilePath = join(ipod.path, ipodPathToFilePath(replaced.ipodPath!));
      const newFileStats = await stat(newFilePath);
      const newMp3Stats = await stat(TEST_MP3_PATH_2);
      expect(newFileStats.size).toBe(newMp3Stats.size);
      expect(newFileStats.size).not.toBe(originalMp3Stats.size);

      db.close();
    });
  });

  it('updates the track size to match the new file', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Size Update Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      const originalTrack = db.getTrack(handle);
      const originalMp3Stats = await stat(TEST_MP3_PATH);
      // The original size should match the original file
      expect(originalTrack.size).toBe(originalMp3Stats.size);

      // Replace with the second file
      const replaced = db.replaceTrackFile(handle, TEST_MP3_PATH_2);

      // The size should now match the new file
      const newMp3Stats = await stat(TEST_MP3_PATH_2);
      expect(replaced.size).toBe(newMp3Stats.size);

      db.close();
    });
  });

  it('preserves play counts, ratings, and other user data', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Preserve Data Test',
        artist: 'Test Artist',
        album: 'Test Album',
        trackNumber: 3,
        year: 2023,
        filetype: 'MPEG audio file',
      });

      // Set user data
      db.updateTrack(handle, {
        rating: 80, // 4 stars
        playCount: 42,
        skipCount: 5,
      });

      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Replace the file
      db.replaceTrackFile(handle, TEST_MP3_PATH_2);

      // Verify all user data is preserved
      const track = db.getTrack(handle);
      expect(track.title).toBe('Preserve Data Test');
      expect(track.artist).toBe('Test Artist');
      expect(track.album).toBe('Test Album');
      expect(track.trackNumber).toBe(3);
      expect(track.year).toBe(2023);
      expect(track.rating).toBe(80);
      expect(track.playCount).toBe(42);
      expect(track.skipCount).toBe(5);
      expect(track.transferred).toBe(true);

      db.close();
    });
  });

  it('preserves playlist membership after file replacement', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Playlist Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Add track to a playlist
      const playlist = db.createPlaylist('My Playlist');
      db.addTrackToPlaylist(playlist.id, handle);
      expect(db.playlistContainsTrack(playlist.id, handle)).toBe(true);

      // Replace the file
      db.replaceTrackFile(handle, TEST_MP3_PATH_2);

      // Track should still be in the playlist
      expect(db.playlistContainsTrack(playlist.id, handle)).toBe(true);

      // And still in the master playlist
      const playlists = db.getPlaylists();
      const masterPlaylist = playlists.find((p) => p.isMaster);
      expect(masterPlaylist).toBeDefined();
      expect(db.playlistContainsTrack(masterPlaylist!.id, handle)).toBe(true);

      db.close();
    });
  });

  it('survives save and reload with replaced file', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Save Reload Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      db.updateTrack(handle, {
        rating: 60, // 3 stars
        playCount: 10,
      });

      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Replace the file
      const replaced = db.replaceTrackFile(handle, TEST_MP3_PATH_2);
      const newIpodPath = replaced.ipodPath!;

      // Save and close
      db.saveSync();
      db.close();

      // Reopen and verify
      const db2 = Database.openSync(ipod.path);
      const handles = db2.getTracks();
      expect(handles).toHaveLength(1);

      const track = db2.getTrack(handles[0]!);
      expect(track.title).toBe('Save Reload Test');
      expect(track.artist).toBe('Test Artist');
      expect(track.rating).toBe(60);
      expect(track.playCount).toBe(10);
      expect(track.transferred).toBe(true);
      expect(track.ipodPath).toBe(newIpodPath);

      // Verify the file on disk is the replaced one
      const filePath = join(ipod.path, ipodPathToFilePath(track.ipodPath!));
      expect(existsSync(filePath)).toBe(true);
      const fileStats = await stat(filePath);
      const newMp3Stats = await stat(TEST_MP3_PATH_2);
      expect(fileStats.size).toBe(newMp3Stats.size);

      // Verify the track size field persisted correctly
      expect(track.size).toBe(newMp3Stats.size);

      db2.close();
    });
  });

  it('throws when track has no file on the iPod', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add a track but do NOT copy a file
      const handle = db.addTrack({
        title: 'No File Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      // Attempting to replace should throw
      expect(() => {
        db.replaceTrackFile(handle, TEST_MP3_PATH);
      }).toThrow(/no file on the iPod/i);

      db.close();
    });
  });

  it('throws for non-existent source file', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add and transfer a track so it has a file on the iPod
      const handle = db.addTrack({
        title: 'Non-Existent Source Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });
      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Attempting to replace with a non-existent source should throw
      expect(() => {
        db.replaceTrackFile(handle, '/nonexistent/path/to/file.mp3');
      }).toThrow(LibgpodError);

      db.close();
    });
  });

  it('throws for invalid track handle', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Use a handle number that was never registered
      const invalidHandle = { __brand: 'TrackHandle' as const, index: 99999 };

      expect(() => {
        db.replaceTrackFile(invalidHandle, TEST_MP3_PATH);
      }).toThrow();

      db.close();
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-format file replacement (MP3 → AAC)
//
// Documents the critical requirement: when replacing a track's file with a
// different format, the ipodPath must get the correct extension for the new
// format. The iPod firmware uses the file extension to select the decoder.
// ---------------------------------------------------------------------------

describe('replaceTrackFile() cross-format (MP3 → AAC)', () => {
  it('assigns new ipodPath with correct extension when format changes', async () => {
    // When replacing an MP3 with an AAC file, replaceTrackFile() must generate
    // a new ipodPath with the .m4a extension. The iPod firmware uses the file
    // extension to select the decoder — a .mp3 file containing AAC audio will
    // not play.
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add an MP3 track and copy it
      const handle = db.addTrack({
        title: 'Cross Format Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });
      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      const originalTrack = db.getTrack(handle);
      const originalPath = originalTrack.ipodPath!;
      expect(originalPath).toMatch(/\.mp3$/);

      // Replace with an AAC file
      const replaced = db.replaceTrackFile(handle, TEST_AAC_PATH);

      // ipodPath should now have .m4a extension
      expect(replaced.ipodPath).toMatch(/\.m4a$/);

      // Old .mp3 file should be deleted
      const oldFilePath = join(ipod.path, ipodPathToFilePath(originalPath));
      expect(existsSync(oldFilePath)).toBe(false);

      // New .m4a file should exist with correct content
      const newFilePath = join(ipod.path, ipodPathToFilePath(replaced.ipodPath!));
      expect(existsSync(newFilePath)).toBe(true);
      const fileStats = await stat(newFilePath);
      const aacStats = await stat(TEST_AAC_PATH);
      expect(fileStats.size).toBe(aacStats.size);

      db.close();
    });
  });

  it('FIXED: assigns correct .m4a extension when replacing MP3 with AAC', async () => {
    // This test asserts the CORRECT behavior after the fix.
    // When replacing a track's file with a different format, the ipodPath
    // should get the correct extension for the new format.
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      // Add an MP3 track and copy it
      const handle = db.addTrack({
        title: 'Cross Format Fix Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });
      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      const originalTrack = db.getTrack(handle);
      expect(originalTrack.ipodPath).toMatch(/\.mp3$/);

      // Replace with an AAC file
      const replaced = db.replaceTrackFile(handle, TEST_AAC_PATH);

      // After fix: ipodPath should have .m4a extension
      expect(replaced.ipodPath).toMatch(/\.m4a$/);

      // The old .mp3 file should no longer exist
      const oldFilePath = join(ipod.path, ipodPathToFilePath(originalTrack.ipodPath!));
      expect(existsSync(oldFilePath)).toBe(false);

      // The new .m4a file should exist with correct content
      const newFilePath = join(ipod.path, ipodPathToFilePath(replaced.ipodPath!));
      expect(existsSync(newFilePath)).toBe(true);
      const newFileStats = await stat(newFilePath);
      const aacStats = await stat(TEST_AAC_PATH);
      expect(newFileStats.size).toBe(aacStats.size);

      db.close();
    });
  });

  it('FIXED: preserves database entry when changing format', async () => {
    // The whole point of replaceTrackFile is to keep play counts, ratings,
    // and playlist membership. This must still work when the format changes.
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Format Change Preserve Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      db.updateTrack(handle, {
        rating: 100,
        playCount: 99,
        skipCount: 3,
      });

      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Add to a playlist
      const playlist = db.createPlaylist('Format Test Playlist');
      db.addTrackToPlaylist(playlist.id, handle);

      // Replace MP3 with AAC
      db.replaceTrackFile(handle, TEST_AAC_PATH);

      // All user data preserved
      const track = db.getTrack(handle);
      expect(track.title).toBe('Format Change Preserve Test');
      expect(track.rating).toBe(100);
      expect(track.playCount).toBe(99);
      expect(track.skipCount).toBe(3);
      expect(track.transferred).toBe(true);

      // Playlist membership preserved
      expect(db.playlistContainsTrack(playlist.id, handle)).toBe(true);

      db.close();
    });
  });

  it('FIXED: survives save and reload after cross-format replacement', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      const handle = db.addTrack({
        title: 'Format Reload Test',
        artist: 'Test Artist',
        filetype: 'MPEG audio file',
      });

      db.updateTrack(handle, { rating: 80, playCount: 50 });
      db.copyTrackToDevice(handle, TEST_MP3_PATH);

      // Replace MP3 with AAC
      const replaced = db.replaceTrackFile(handle, TEST_AAC_PATH);
      const newIpodPath = replaced.ipodPath!;
      expect(newIpodPath).toMatch(/\.m4a$/);

      // Save and reopen
      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);
      const handles = db2.getTracks();
      expect(handles).toHaveLength(1);

      const track = db2.getTrack(handles[0]!);
      expect(track.title).toBe('Format Reload Test');
      expect(track.rating).toBe(80);
      expect(track.playCount).toBe(50);
      expect(track.ipodPath).toBe(newIpodPath);
      expect(track.ipodPath).toMatch(/\.m4a$/);

      // File on disk is correct
      const filePath = join(ipod.path, ipodPathToFilePath(track.ipodPath!));
      expect(existsSync(filePath)).toBe(true);
      const fileStats = await stat(filePath);
      const aacStats = await stat(TEST_AAC_PATH);
      expect(fileStats.size).toBe(aacStats.size);

      db2.close();
    });
  });
});
