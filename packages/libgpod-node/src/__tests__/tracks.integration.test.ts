/**
 * Integration tests for libgpod-node track operations.
 *
 * These tests cover: copyTrackToDevice, track add/remove operations.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  withTestIpod,
  Database,
  isNativeAvailable,
  ipodPathToFilePath,
  LibgpodError,
  TEST_MP3_PATH,
} from './helpers/test-setup';

// Check if we have a test MP3 file available
const hasTestMp3 = existsSync(TEST_MP3_PATH);

// Tests for file copy functionality (itdb_cp_track_to_ipod)
describe('libgpod-node file copy (copyTrackToDevice)', () => {
  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can copy audio file to iPod storage',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track (metadata only)
        const track = db.addTrack({
          title: 'Tiny Test',
          artist: 'Test Artist',
          album: 'Test Album',
          filetype: 'MPEG audio file',
        });

        expect(track.ipodPath).toBeNull();
        expect(track.transferred).toBe(false);

        // Copy the file to the iPod
        const updated = db.copyTrackToDevice(track.id, TEST_MP3_PATH);

        // Verify the track now has an iPod path
        expect(updated.ipodPath).not.toBeNull();
        expect(updated.ipodPath).toMatch(/^:iPod_Control:Music:F\d{2}:/);
        expect(updated.transferred).toBe(true);

        // Verify the file was actually copied
        const filePath = join(
          ipod.path,
          ipodPathToFilePath(updated.ipodPath!)
        );
        expect(existsSync(filePath)).toBe(true);

        // Verify file size matches
        const originalStats = await stat(TEST_MP3_PATH);
        const copiedStats = await stat(filePath);
        expect(copiedStats.size).toBe(originalStats.size);

        // Save and re-open to verify persistence
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].ipodPath).toBe(updated.ipodPath);
        expect(tracks[0].transferred).toBe(true);
        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for non-existent source file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({
          title: 'Test Track',
        });

        expect(() => {
          db.copyTrackToDevice(track.id, '/nonexistent/path/to/file.mp3');
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for invalid track ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.copyTrackToDevice(99999, TEST_MP3_PATH);
        }).toThrow();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can copy multiple tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add first track and copy immediately
        // (track IDs are 0 before save, so we need to copy one at a time)
        const track1 = db.addTrack({ title: 'Song 1', artist: 'Artist 1' });
        const updated1 = db.copyTrackToDevice(track1.id, TEST_MP3_PATH);

        // Save to get proper IDs assigned
        db.saveSync();

        // Add second track and copy
        const track2 = db.addTrack({ title: 'Song 2', artist: 'Artist 2' });
        const updated2 = db.copyTrackToDevice(track2.id, TEST_MP3_PATH);

        // They should have different iPod paths
        expect(updated1.ipodPath).not.toBeNull();
        expect(updated2.ipodPath).not.toBeNull();
        expect(updated1.ipodPath).not.toBe(updated2.ipodPath);

        // Both files should exist
        expect(
          existsSync(join(ipod.path, ipodPathToFilePath(updated1.ipodPath!)))
        ).toBe(true);
        expect(
          existsSync(join(ipod.path, ipodPathToFilePath(updated2.ipodPath!)))
        ).toBe(true);

        db.saveSync();
        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'preserves metadata after file copy',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track with full metadata
        const track = db.addTrack({
          title: 'Metadata Test',
          artist: 'Test Artist',
          album: 'Test Album',
          albumArtist: 'Album Artist',
          genre: 'Electronic',
          trackNumber: 3,
          totalTracks: 12,
          discNumber: 1,
          totalDiscs: 2,
          year: 2024,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
        });

        // Copy the file
        const updated = db.copyTrackToDevice(track.id, TEST_MP3_PATH);

        // Verify all metadata is preserved
        expect(updated.title).toBe('Metadata Test');
        expect(updated.artist).toBe('Test Artist');
        expect(updated.album).toBe('Test Album');
        expect(updated.albumArtist).toBe('Album Artist');
        expect(updated.genre).toBe('Electronic');
        expect(updated.trackNumber).toBe(3);
        expect(updated.totalTracks).toBe(12);
        expect(updated.discNumber).toBe(1);
        expect(updated.totalDiscs).toBe(2);
        expect(updated.year).toBe(2024);

        // File should be copied
        expect(updated.ipodPath).not.toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'async version works correctly',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = await Database.open(ipod.path);

        const track = db.addTrack({ title: 'Async Test' });
        const updated = await db.copyTrackToDeviceAsync(track.id, TEST_MP3_PATH);

        expect(updated.ipodPath).not.toBeNull();
        expect(updated.transferred).toBe(true);

        db.close();
      });
    }
  );
});
