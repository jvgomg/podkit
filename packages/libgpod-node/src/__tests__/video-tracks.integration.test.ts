/**
 * Integration tests for libgpod-node video track operations.
 *
 * These tests verify that video-specific fields (tvShow, seasonNumber,
 * episodeNumber, movieFlag, videoWidth, videoHeight) are correctly
 * stored and retrieved from the iPod database.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';

import {
  withTestIpod,
  Database,
  MediaType,
} from './helpers/test-setup';

describe('libgpod-node video track operations', () => {
  describe('movie tracks', () => {
    it('can add a movie track with video fields', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Test Movie',
          artist: 'Director Name',
          album: 'Test Movie',
          genre: 'Action',
          year: 2024,
          duration: 7200000, // 2 hours in ms
          mediaType: MediaType.Movie,
          movieFlag: true,
          filetype: 'M4V video file',
        });

        const track = db.getTrack(handle);

        expect(track.title).toBe('Test Movie');
        expect(track.mediaType).toBe(MediaType.Movie);
        expect(track.movieFlag).toBe(true);
        expect(track.tvShow).toBeNull();
        expect(track.seasonNumber).toBe(0);
        expect(track.episodeNumber).toBe(0);

        db.close();
      });
    });

    it('movie track persists after save', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({
          title: 'Persistent Movie',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        db.saveSync();
        db.close();

        // Reopen and verify
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);

        const track = db2.getTrack(handles[0]!);
        expect(track.title).toBe('Persistent Movie');
        expect(track.mediaType).toBe(MediaType.Movie);
        expect(track.movieFlag).toBe(true);

        db2.close();
      });
    });
  });

  describe('TV show tracks', () => {
    it('can add a TV show episode with series/season/episode info', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Pilot Episode',
          artist: 'Test Show',
          album: 'Test Show, Season 1',
          genre: 'Drama',
          year: 2024,
          duration: 2700000, // 45 minutes in ms
          mediaType: MediaType.TVShow,
          tvShow: 'Test Show',
          tvEpisode: 'Pilot',
          seasonNumber: 1,
          episodeNumber: 1,
          movieFlag: false,
          filetype: 'M4V video file',
          trackNumber: 1, // Episode as track number
          discNumber: 1, // Season as disc number
        });

        const track = db.getTrack(handle);

        expect(track.title).toBe('Pilot Episode');
        expect(track.mediaType).toBe(MediaType.TVShow);
        expect(track.tvShow).toBe('Test Show');
        expect(track.tvEpisode).toBe('Pilot');
        expect(track.seasonNumber).toBe(1);
        expect(track.episodeNumber).toBe(1);
        expect(track.movieFlag).toBe(false);
        expect(track.trackNumber).toBe(1);
        expect(track.discNumber).toBe(1);

        db.close();
      });
    });

    it('can add multiple episodes from the same series', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add 3 episodes
        for (let ep = 1; ep <= 3; ep++) {
          db.addTrack({
            title: `Episode ${ep}`,
            artist: 'My Series',
            album: 'My Series, Season 2',
            mediaType: MediaType.TVShow,
            tvShow: 'My Series',
            tvEpisode: `Episode ${ep}`,
            seasonNumber: 2,
            episodeNumber: ep,
            trackNumber: ep,
            discNumber: 2,
          });
        }

        const handles = db.getTracks();
        expect(handles).toHaveLength(3);

        // Verify each episode
        for (let i = 0; i < 3; i++) {
          const track = db.getTrack(handles[i]!);
          expect(track.tvShow).toBe('My Series');
          expect(track.seasonNumber).toBe(2);
          expect(track.episodeNumber).toBe(i + 1);
        }

        db.close();
      });
    });

    it('TV show tracks persist after save', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        db.addTrack({
          title: 'Persistent Episode',
          mediaType: MediaType.TVShow,
          tvShow: 'Saved Show',
          tvEpisode: 'Persistent Episode',
          seasonNumber: 3,
          episodeNumber: 7,
        });

        db.saveSync();
        db.close();

        // Reopen and verify
        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(1);

        const track = db2.getTrack(handles[0]!);
        expect(track.title).toBe('Persistent Episode');
        expect(track.mediaType).toBe(MediaType.TVShow);
        expect(track.tvShow).toBe('Saved Show');
        expect(track.tvEpisode).toBe('Persistent Episode');
        expect(track.seasonNumber).toBe(3);
        expect(track.episodeNumber).toBe(7);

        db2.close();
      });
    });
  });

  describe('updating video tracks', () => {
    it('can update video-specific fields', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Original Episode',
          mediaType: MediaType.TVShow,
          tvShow: 'Original Show',
          tvEpisode: 'Episode 1',
          seasonNumber: 1,
          episodeNumber: 1,
        });

        // Update video fields
        const updated = db.updateTrack(handle, {
          tvShow: 'Updated Show',
          tvEpisode: 'Episode 5',
          seasonNumber: 2,
          episodeNumber: 5,
        });

        expect(updated.tvShow).toBe('Updated Show');
        expect(updated.tvEpisode).toBe('Episode 5');
        expect(updated.seasonNumber).toBe(2);
        expect(updated.episodeNumber).toBe(5);

        db.close();
      });
    });

    it('can convert audio track to movie', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Start with audio track
        const handle = db.addTrack({
          title: 'Audio Track',
          mediaType: MediaType.Audio,
        });

        let track = db.getTrack(handle);
        expect(track.mediaType).toBe(MediaType.Audio);
        expect(track.movieFlag).toBe(false);

        // Convert to movie
        const updated = db.updateTrack(handle, {
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        expect(updated.mediaType).toBe(MediaType.Movie);
        expect(updated.movieFlag).toBe(true);

        db.close();
      });
    });

    it('can clear TV show field', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        const handle = db.addTrack({
          title: 'Episode',
          tvShow: 'My Show',
          seasonNumber: 1,
          episodeNumber: 1,
        });

        let track = db.getTrack(handle);
        expect(track.tvShow).toBe('My Show');

        // Clear the TV show field by setting it to empty string
        const updated = db.updateTrack(handle, {
          tvShow: '',
        });

        expect(updated.tvShow).toBe('');

        db.close();
      });
    });
  });

  describe('video field defaults', () => {
    it('video fields default to appropriate values', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add a basic audio track (no video fields specified)
        const handle = db.addTrack({
          title: 'Basic Audio Track',
          mediaType: MediaType.Audio,
        });

        const track = db.getTrack(handle);

        expect(track.tvShow).toBeNull();
        expect(track.tvEpisode).toBeNull();
        expect(track.sortTvShow).toBeNull();
        expect(track.seasonNumber).toBe(0);
        expect(track.episodeNumber).toBe(0);
        expect(track.movieFlag).toBe(false);

        db.close();
      });
    });
  });

  describe('mixed content library', () => {
    it('can have music, movies, and TV shows in the same database', async () => {
      await withTestIpod(async (ipod) => {
        const db = Database.openSync(ipod.path);

        // Add music track
        db.addTrack({
          title: 'Music Track',
          artist: 'Artist',
          album: 'Album',
          mediaType: MediaType.Audio,
        });

        // Add movie
        db.addTrack({
          title: 'A Movie',
          mediaType: MediaType.Movie,
          movieFlag: true,
        });

        // Add TV episode
        db.addTrack({
          title: 'TV Episode',
          mediaType: MediaType.TVShow,
          tvShow: 'A Series',
          tvEpisode: 'Episode One',
          seasonNumber: 1,
          episodeNumber: 1,
        });

        // Save and reopen
        db.saveSync();
        db.close();

        const db2 = Database.openSync(ipod.path);
        const handles = db2.getTracks();
        expect(handles).toHaveLength(3);

        // Count by media type
        const tracks = handles.map((h) => db2.getTrack(h));
        const audioTracks = tracks.filter((t) => t.mediaType === MediaType.Audio);
        const movies = tracks.filter((t) => t.mediaType === MediaType.Movie);
        const tvShows = tracks.filter((t) => t.mediaType === MediaType.TVShow);

        expect(audioTracks).toHaveLength(1);
        expect(movies).toHaveLength(1);
        expect(tvShows).toHaveLength(1);

        // Verify movie and TV show have video fields
        const movie = movies[0]!;
        expect(movie.movieFlag).toBe(true);

        const tvShow = tvShows[0]!;
        expect(tvShow.tvShow).toBe('A Series');
        expect(tvShow.tvEpisode).toBe('Episode One');
        expect(tvShow.seasonNumber).toBe(1);
        expect(tvShow.episodeNumber).toBe(1);

        db2.close();
      });
    });
  });
});
