/**
 * Integration tests to investigate CRITICAL assertion failures when
 * removing all video tracks from an iPod database.
 *
 * Issue: User reports CRITICAL warnings about "track id 0" when clearing
 * all videos from their iPod. The warnings go away when videos are added back.
 *
 * This test attempts to reproduce that scenario.
 *
 * Run with: bun test packages/libgpod-node/src/__tests__/video-removal-criticals.integration.test.ts
 */

import { describe, it, expect } from 'bun:test';

import {
  withTestIpod,
  Database,
  MediaType,
} from './helpers/test-setup';

describe('TASK-041: Video removal CRITICAL investigation', () => {
  describe('removing all videos', () => {
    it('add videos, save, remove all, save again - check for CRITICALs', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Step 1: Add multiple video tracks (mix of movies and TV shows)
        console.log('Step 1: Adding video tracks...');

        const movieHandle = db.addTrack({
          title: 'Test Movie',
          artist: 'Director',
          mediaType: MediaType.Movie,
          movieFlag: true,
          duration: 7200000,
        });

        const tvHandle1 = db.addTrack({
          title: 'Episode 1',
          mediaType: MediaType.TVShow,
          tvShow: 'Test Series',
          tvEpisode: 'Pilot',
          seasonNumber: 1,
          episodeNumber: 1,
          duration: 2700000,
        });

        const tvHandle2 = db.addTrack({
          title: 'Episode 2',
          mediaType: MediaType.TVShow,
          tvShow: 'Test Series',
          tvEpisode: 'Second Episode',
          seasonNumber: 1,
          episodeNumber: 2,
          duration: 2700000,
        });

        expect(db.trackCount).toBe(3);
        console.log(`  Added ${db.trackCount} video tracks`);

        // Step 2: Save the database with videos
        console.log('Step 2: Saving database with videos...');
        db.saveSync();

        // Step 3: Remove ALL video tracks
        console.log('Step 3: Removing all video tracks...');
        db.removeTrack(movieHandle);
        db.removeTrack(tvHandle1);
        db.removeTrack(tvHandle2);

        expect(db.trackCount).toBe(0);
        console.log(`  Track count after removal: ${db.trackCount}`);

        // Step 4: Save the database with zero videos
        // THIS IS WHERE WE EXPECT CRITICAL WARNINGS
        console.log('Step 4: Saving database with zero videos (watch for CRITICALs)...');
        db.saveSync();
        console.log('  Save completed');

        // Step 5: Close and reopen to verify database integrity
        console.log('Step 5: Closing and reopening database...');
        db.close();

        const db2 = Database.openSync(ipod.path);
        expect(db2.trackCount).toBe(0);
        console.log(`  Reopened database has ${db2.trackCount} tracks`);

        db2.close();
      });
    });

    it('add videos, save, remove all, close without second save', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add video tracks
        const handle1 = db.addTrack({
          title: 'Movie 1',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        const handle2 = db.addTrack({
          title: 'Movie 2',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        db.saveSync();

        // Remove all videos
        db.removeTrack(handle1);
        db.removeTrack(handle2);

        // Close WITHOUT saving - see if close() triggers CRITICALs
        console.log('Closing database without saving after removal...');
        db.close();
      });
    });

    it('remove videos one by one with saves between each removal', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add 3 video tracks
        const handles = [];
        for (let i = 1; i <= 3; i++) {
          handles.push(db.addTrack({
            title: `Video ${i}`,
            mediaType: MediaType.Movie,
            movieFlag: true,
          }));
        }
        db.saveSync();
        console.log(`Added ${handles.length} videos`);

        // Remove one by one with saves
        for (let i = 0; i < handles.length; i++) {
          console.log(`Removing video ${i + 1} (${handles.length - i} remaining)...`);
          db.removeTrack(handles[i]!);
          db.saveSync();
          console.log(`  Saved. Track count: ${db.trackCount}`);
        }

        // Final state should be 0 tracks
        expect(db.trackCount).toBe(0);

        db.close();
      });
    });
  });

  describe('video with audio mix', () => {
    it('remove only videos, leave audio tracks', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add mix of audio and video
        db.addTrack({
          title: 'Music Track',
          artist: 'Artist',
          mediaType: MediaType.Audio,
        });

        const videoHandle = db.addTrack({
          title: 'Video Track',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        db.saveSync();
        console.log('Saved with 1 audio + 1 video');

        // Remove only the video
        db.removeTrack(videoHandle);
        console.log('Removed video, saving...');
        db.saveSync();

        expect(db.trackCount).toBe(1);
        const remaining = db.getTrack(db.getTracks()[0]!);
        expect(remaining.mediaType).toBe(MediaType.Audio);
        console.log(`Remaining track: ${remaining.title}`);

        db.close();
      });
    });
  });

  describe('reopen after clearing videos', () => {
    it('clear videos, save, close, reopen, then add videos back', async () => {
      await withTestIpod(async (ipod) => {
        // Session 1: Add and save videos
        const db1 = Database.openSync(ipod.path);
        db1.addTrack({
          title: 'Original Video',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });
        db1.saveSync();
        db1.close();

        // Session 2: Remove all videos and save
        console.log('Session 2: Removing all videos...');
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        for (const h of handles) {
          db2.removeTrack(h);
        }
        expect(db2.trackCount).toBe(0);
        console.log('  Saving empty database...');
        db2.saveSync();
        db2.close();

        // Session 3: Reopen and add videos back
        console.log('Session 3: Adding videos back...');
        const db3 = Database.openSync(ipod.path);
        expect(db3.trackCount).toBe(0);

        db3.addTrack({
          title: 'New Video',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });
        console.log('  Saving with new video...');
        db3.saveSync();

        expect(db3.trackCount).toBe(1);
        db3.close();
      });
    });
  });

  describe('edge cases', () => {
    it('database with only videos (no audio ever added)', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Only add videos, never any audio
        const handle = db.addTrack({
          title: 'Only Video',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });
        db.saveSync();

        // Remove the only video
        db.removeTrack(handle);
        console.log('Removed only video, saving empty database...');
        db.saveSync();

        expect(db.trackCount).toBe(0);
        db.close();
      });
    });

    it('TV shows with chapters - remove all', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add TV show with chapters (like a podcast)
        const handle = db.addTrack({
          title: 'TV Episode with Chapters',
          mediaType: MediaType.TVShow,
          tvShow: 'Chaptered Show',
          seasonNumber: 1,
          episodeNumber: 1,
          duration: 3600000,
        });

        // Add chapters
        db.setTrackChapters(handle, [
          { startPos: 0, title: 'Intro' },
          { startPos: 300000, title: 'Act 1' },
          { startPos: 1200000, title: 'Act 2' },
        ]);

        db.saveSync();
        console.log('Saved TV show with chapters');

        // Remove the track (with chapters)
        db.removeTrack(handle);
        console.log('Removed TV show with chapters, saving...');
        db.saveSync();

        expect(db.trackCount).toBe(0);
        db.close();
      });
    });
  });
});
