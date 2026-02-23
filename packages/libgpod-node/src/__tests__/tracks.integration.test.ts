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

// Tests for track update operations
describe('libgpod-node track updates (updateTrack)', () => {
  it.skipIf(!isNativeAvailable())(
    'can update track metadata',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track
        const track = db.addTrack({
          title: 'Original Title',
          artist: 'Original Artist',
          album: 'Original Album',
        });

        // Update some fields
        const updated = db.updateTrack(track.id, {
          title: 'Updated Title',
          artist: 'Updated Artist',
        });

        // Verify updates
        expect(updated.title).toBe('Updated Title');
        expect(updated.artist).toBe('Updated Artist');
        // Album should remain unchanged
        expect(updated.album).toBe('Original Album');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can update rating and play statistics',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Stats Test' });

        // Update play statistics
        const updated = db.updateTrack(track.id, {
          rating: 80, // 4 stars
          playCount: 10,
          skipCount: 2,
        });

        expect(updated.rating).toBe(80);
        expect(updated.playCount).toBe(10);
        expect(updated.skipCount).toBe(2);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'updates persist after save()',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Persistence Test' });
        db.updateTrack(track.id, {
          title: 'Persisted Title',
          artist: 'Persisted Artist',
          year: 2024,
        });

        // Save and reopen
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        expect(tracks[0].title).toBe('Persisted Title');
        expect(tracks[0].artist).toBe('Persisted Artist');
        expect(tracks[0].year).toBe(2024);

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for invalid track ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.updateTrack(99999, { title: 'Should Fail' });
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can update all string fields',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Initial' });

        // Update all string fields
        const updated = db.updateTrack(track.id, {
          title: 'New Title',
          artist: 'New Artist',
          album: 'New Album',
          albumArtist: 'New Album Artist',
          genre: 'New Genre',
          composer: 'New Composer',
          comment: 'New Comment',
          grouping: 'New Grouping',
          filetype: 'AAC audio file',
        });

        expect(updated.title).toBe('New Title');
        expect(updated.artist).toBe('New Artist');
        expect(updated.album).toBe('New Album');
        expect(updated.albumArtist).toBe('New Album Artist');
        expect(updated.genre).toBe('New Genre');
        expect(updated.composer).toBe('New Composer');
        expect(updated.comment).toBe('New Comment');
        expect(updated.grouping).toBe('New Grouping');
        expect(updated.filetype).toBe('AAC audio file');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can update all numeric fields',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Numeric Test' });

        const updated = db.updateTrack(track.id, {
          trackNumber: 7,
          totalTracks: 15,
          discNumber: 2,
          totalDiscs: 3,
          year: 2025,
          duration: 240000,
          bitrate: 256,
          sampleRate: 48000,
          size: 5000000,
          bpm: 120,
          mediaType: 0x0001, // Audio
        });

        expect(updated.trackNumber).toBe(7);
        expect(updated.totalTracks).toBe(15);
        expect(updated.discNumber).toBe(2);
        expect(updated.totalDiscs).toBe(3);
        expect(updated.year).toBe(2025);
        expect(updated.duration).toBe(240000);
        expect(updated.bitrate).toBe(256);
        expect(updated.sampleRate).toBe(48000);
        expect(updated.size).toBe(5000000);
        expect(updated.bpm).toBe(120);
        expect(updated.mediaType).toBe(0x0001);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can update with empty strings',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create track with values
        const track = db.addTrack({
          title: 'Has Values',
          artist: 'Some Artist',
          comment: 'Some Comment',
        });

        expect(track.artist).toBe('Some Artist');
        expect(track.comment).toBe('Some Comment');

        // Update with empty strings (should clear the fields)
        // Note: libgpod stores empty strings as empty, not null
        const updated = db.updateTrack(track.id, {
          artist: '',
          comment: '',
        });

        // Empty string becomes empty string (not null)
        expect(updated.artist).toBe('');
        expect(updated.comment).toBe('');
        // Title unchanged
        expect(updated.title).toBe('Has Values');

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'can update compilation flag',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Create track without compilation flag
        const track = db.addTrack({ title: 'Compilation Test' });
        expect(track.compilation).toBe(false);

        // Set compilation to true
        const updated1 = db.updateTrack(track.id, { compilation: true });
        expect(updated1.compilation).toBe(true);

        // Set compilation back to false
        const updated2 = db.updateTrack(track.id, { compilation: false });
        expect(updated2.compilation).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'updates time_modified automatically',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Time Test' });
        const originalModified = track.timeModified;

        // Small delay to ensure time difference
        await new Promise((resolve) => setTimeout(resolve, 1100));

        const updated = db.updateTrack(track.id, { title: 'Updated' });

        // timeModified should be updated to a later time
        expect(updated.timeModified).toBeGreaterThanOrEqual(originalModified);

        db.close();
      });
    }
  );
});

// Tests for track file path (itdb_filename_on_ipod)
describe('libgpod-node track file path (getTrackFilePath)', () => {
  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'returns full path for transferred track',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const track = db.addTrack({ title: 'Path Test' });
        db.copyTrackToDevice(track.id, TEST_MP3_PATH);

        const filePath = db.getTrackFilePath(track.id);

        expect(filePath).not.toBeNull();
        expect(filePath).toContain(ipod.path);
        expect(filePath).toContain('iPod_Control');
        expect(filePath).toContain('Music');
        expect(existsSync(filePath!)).toBe(true);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'returns null for track without file',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add track without copying file
        const track = db.addTrack({ title: 'No File' });

        const filePath = db.getTrackFilePath(track.id);
        expect(filePath).toBeNull();

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
          db.getTrackFilePath(99999);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );
});

// Tests for track duplication (itdb_track_duplicate)
describe('libgpod-node track duplication (duplicateTrack)', () => {
  it.skipIf(!isNativeAvailable())(
    'can duplicate track metadata',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add original track with full metadata
        const original = db.addTrack({
          title: 'Original Song',
          artist: 'Original Artist',
          album: 'Original Album',
          genre: 'Rock',
          trackNumber: 5,
          year: 2020,
        });

        // Duplicate it
        const copy = db.duplicateTrack(original.id);

        // Verify metadata was copied
        expect(copy.title).toBe('Original Song');
        expect(copy.artist).toBe('Original Artist');
        expect(copy.album).toBe('Original Album');
        expect(copy.genre).toBe('Rock');
        expect(copy.trackNumber).toBe(5);
        expect(copy.year).toBe(2020);

        // Verify duplicate has no file
        expect(copy.ipodPath).toBeNull();
        expect(copy.transferred).toBe(false);

        // Should now have 2 tracks
        expect(db.getTracks()).toHaveLength(2);

        // Save and verify tracks have different IDs
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(2);
        // After save, IDs should be assigned and different
        expect(tracks[0].id).not.toBe(tracks[1].id);

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'duplicate has new dbid',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({ title: 'DBID Test' });

        // Save to get dbid assigned
        db.saveSync();

        // Reopen to get actual dbid
        db.close();
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks[0].dbid).not.toBe(0n);

        // Duplicate
        db2.duplicateTrack(tracks[0].id);

        // Save to get new dbid assigned
        db2.saveSync();
        db2.close();

        // Reopen and verify different dbids
        const db3 = Database.openSync(ipod.path);
        const allTracks = db3.getTracks();
        expect(allTracks).toHaveLength(2);

        // Both tracks should have non-zero dbids after save
        // and they should be different
        const dbids = allTracks.map((t) => t.dbid);
        expect(dbids[0]).not.toBe(0n);
        expect(dbids[1]).not.toBe(0n);
        expect(dbids[0]).not.toBe(dbids[1]);

        db3.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable() || !hasTestMp3)(
    'can copy file to duplicate after save',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add original with file
        const original = db.addTrack({ title: 'With File' });
        db.copyTrackToDevice(original.id, TEST_MP3_PATH);

        // Save first to get unique IDs assigned
        db.saveSync();
        db.close();

        // Reopen and duplicate
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);
        const originalTrack = tracks[0];

        // Duplicate
        const copy = db2.duplicateTrack(originalTrack.id);
        expect(copy.ipodPath).toBeNull();

        // Save so the duplicate gets a unique ID
        db2.saveSync();

        // Get the updated duplicate (now with proper ID)
        const duplicateTrack = db2.getTracks().find(
          (t) => t.id !== originalTrack.id
        );
        expect(duplicateTrack).not.toBeUndefined();

        // Copy file to duplicate (now with unique ID)
        const updated = db2.copyTrackToDevice(duplicateTrack!.id, TEST_MP3_PATH);
        expect(updated.ipodPath).not.toBeNull();
        expect(updated.transferred).toBe(true);

        // Paths should be different now that IDs are different
        expect(updated.ipodPath).not.toBe(originalTrack.ipodPath);

        db2.saveSync();
        db2.close();

        // Reopen and verify both files exist
        const db3 = Database.openSync(ipod.path);
        const finalTracks = db3.getTracks();
        expect(finalTracks).toHaveLength(2);

        // Both tracks should have different ipod paths
        const paths = finalTracks.map((t) => t.ipodPath);
        expect(paths[0]).not.toBeNull();
        expect(paths[1]).not.toBeNull();
        expect(paths[0]).not.toBe(paths[1]);

        // Verify both files exist on disk
        const filePath1 = db3.getTrackFilePath(finalTracks[0].id);
        const filePath2 = db3.getTrackFilePath(finalTracks[1].id);
        expect(filePath1).not.toBeNull();
        expect(filePath2).not.toBeNull();
        expect(existsSync(filePath1!)).toBe(true);
        expect(existsSync(filePath2!)).toBe(true);

        db3.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'throws error for invalid track ID',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        expect(() => {
          db.duplicateTrack(99999);
        }).toThrow(LibgpodError);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'duplicates all metadata fields',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add original track with comprehensive metadata
        const original = db.addTrack({
          title: 'Full Metadata Track',
          artist: 'Test Artist',
          album: 'Test Album',
          albumArtist: 'Test Album Artist',
          genre: 'Electronic',
          composer: 'Test Composer',
          comment: 'Test Comment',
          grouping: 'Test Grouping',
          trackNumber: 3,
          totalTracks: 12,
          discNumber: 1,
          totalDiscs: 2,
          year: 2024,
          duration: 180000,
          bitrate: 320,
          sampleRate: 44100,
          size: 5760000,
          bpm: 128,
          filetype: 'MPEG audio file',
          compilation: true,
        });

        // Duplicate it
        const copy = db.duplicateTrack(original.id);

        // Verify all metadata was copied
        expect(copy.title).toBe('Full Metadata Track');
        expect(copy.artist).toBe('Test Artist');
        expect(copy.album).toBe('Test Album');
        expect(copy.albumArtist).toBe('Test Album Artist');
        expect(copy.genre).toBe('Electronic');
        expect(copy.composer).toBe('Test Composer');
        expect(copy.comment).toBe('Test Comment');
        expect(copy.grouping).toBe('Test Grouping');
        expect(copy.trackNumber).toBe(3);
        expect(copy.totalTracks).toBe(12);
        expect(copy.discNumber).toBe(1);
        expect(copy.totalDiscs).toBe(2);
        expect(copy.year).toBe(2024);
        expect(copy.duration).toBe(180000);
        expect(copy.bitrate).toBe(320);
        expect(copy.sampleRate).toBe(44100);
        expect(copy.size).toBe(5760000);
        expect(copy.bpm).toBe(128);
        expect(copy.filetype).toBe('MPEG audio file');
        expect(copy.compilation).toBe(true);

        // Verify duplicate specifics
        expect(copy.ipodPath).toBeNull();
        expect(copy.transferred).toBe(false);

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'duplicate is added to master playlist',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({ title: 'MPL Test' });

        // Save and reopen to get proper IDs
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        db2.duplicateTrack(tracks[0].id);

        db2.saveSync();
        db2.close();

        // Verify both tracks are in the database (and thus master playlist)
        const db3 = Database.openSync(ipod.path);
        const mpl = db3.getMasterPlaylist();
        expect(mpl).not.toBeNull();
        expect(mpl!.trackCount).toBe(2);

        db3.close();
      });
    }
  );
});

// Tests for getTrackByDbId
describe('libgpod-node track lookup by dbid (getTrackByDbId)', () => {
  it.skipIf(!isNativeAvailable())(
    'can find track by dbid',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a track and save to get dbid assigned
        db.addTrack({ title: 'DBID Lookup Test' });
        db.saveSync();
        db.close();

        // Reopen to get actual dbid
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(1);

        const dbid = tracks[0].dbid;
        expect(dbid).not.toBe(0n);

        // Look up by dbid
        const found = db2.getTrackByDbId(dbid);
        expect(found).not.toBeNull();
        expect(found!.title).toBe('DBID Lookup Test');
        expect(found!.dbid).toBe(dbid);

        db2.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'returns null for non-existent dbid',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const found = db.getTrackByDbId(BigInt('999999999999999'));
        expect(found).toBeNull();

        db.close();
      });
    }
  );

  it.skipIf(!isNativeAvailable())(
    'dbid is unique across tracks',
    async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add multiple tracks
        db.addTrack({ title: 'Track 1' });
        db.addTrack({ title: 'Track 2' });
        db.addTrack({ title: 'Track 3' });

        db.saveSync();
        db.close();

        // Reopen and verify unique dbids
        const db2 = Database.openSync(ipod.path);
        const tracks = db2.getTracks();
        expect(tracks).toHaveLength(3);

        const dbids = tracks.map((t) => t.dbid);
        const uniqueDbids = new Set(dbids);
        expect(uniqueDbids.size).toBe(3);

        // Each dbid should be able to look up its track
        for (const track of tracks) {
          const found = db2.getTrackByDbId(track.dbid);
          expect(found).not.toBeNull();
          expect(found!.id).toBe(track.id);
        }

        db2.close();
      });
    }
  );
});
