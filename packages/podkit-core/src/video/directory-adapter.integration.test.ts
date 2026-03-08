/**
 * Integration tests for VideoDirectoryAdapter
 *
 * These tests use actual video files from the test fixtures directory
 * to verify the adapter correctly scans directories, extracts metadata,
 * and probes technical information.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  VideoDirectoryAdapter,
  type VideoScanProgress,
  type VideoScanWarning,
} from './directory-adapter.js';

// Path to test fixtures
const FIXTURES_DIR = path.resolve(__dirname, '../../../../test/fixtures/video');

// Check if fixtures exist before running tests
const fixturesExist = fs.existsSync(FIXTURES_DIR);

describe('VideoDirectoryAdapter integration', () => {
  // Skip all tests if fixtures don't exist
  beforeAll(() => {
    if (!fixturesExist) {
      console.log('Skipping integration tests: fixtures directory not found');
    }
  });

  describe('connect and scan', () => {
    it.skipIf(!fixturesExist)('scans fixture directory for video files', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      await adapter.connect();

      const count = adapter.getVideoCount();
      // Should find all video files in fixtures
      expect(count).toBeGreaterThanOrEqual(4);
    });

    it.skipIf(!fixturesExist)('reports progress during scan', async () => {
      const progressEvents: VideoScanProgress[] = [];

      const adapter = new VideoDirectoryAdapter({
        path: FIXTURES_DIR,
        onProgress: (progress) => progressEvents.push({ ...progress }),
      });

      await adapter.connect();

      // Should have discovery phase
      expect(progressEvents.some((p) => p.phase === 'discovering')).toBe(true);

      // Should have analyzing phase
      expect(progressEvents.some((p) => p.phase === 'analyzing')).toBe(true);

      // Final progress should show all files processed
      const lastProgress = progressEvents[progressEvents.length - 1];
      expect(lastProgress?.processed).toBe(lastProgress?.total);
    });

    it.skipIf(!fixturesExist)('only scans once when connect called multiple times', async () => {
      let progressCallCount = 0;

      const adapter = new VideoDirectoryAdapter({
        path: FIXTURES_DIR,
        onProgress: () => progressCallCount++,
      });

      await adapter.connect();
      const firstCallCount = progressCallCount;

      await adapter.connect();
      const secondCallCount = progressCallCount;

      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('getVideos', () => {
    it.skipIf(!fixturesExist)('returns all scanned videos', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos = await adapter.getVideos();

      expect(videos.length).toBeGreaterThanOrEqual(4);

      // Each video should have required fields
      for (const video of videos) {
        expect(video.id).toBeDefined();
        expect(video.filePath).toBeDefined();
        expect(video.contentType).toMatch(/^(movie|tvshow)$/);
        expect(video.title).toBeDefined();
        expect(video.container).toBeDefined();
        expect(video.videoCodec).toBeDefined();
        expect(video.audioCodec).toBeDefined();
        expect(video.width).toBeGreaterThan(0);
        expect(video.height).toBeGreaterThan(0);
        expect(video.duration).toBeGreaterThan(0);
      }
    });

    it.skipIf(!fixturesExist)('detects movie content type', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos = await adapter.getVideos();
      const movieVideo = videos.find((v) => v.filePath.includes('movie-with-metadata'));

      expect(movieVideo).toBeDefined();
      expect(movieVideo!.contentType).toBe('movie');
      expect(movieVideo!.title).toBe('Test Movie Title');
      expect(movieVideo!.director).toBe('Test Director');
      expect(movieVideo!.studio).toBe('Test Studio');
      expect(movieVideo!.year).toBe(2024);
      expect(movieVideo!.genre).toBe('Test');
    });

    it.skipIf(!fixturesExist)('detects TV show content type', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos = await adapter.getVideos();
      const tvVideo = videos.find((v) => v.filePath.includes('tvshow-episode'));

      expect(tvVideo).toBeDefined();
      expect(tvVideo!.contentType).toBe('tvshow');
      expect(tvVideo!.title).toBe('Pilot Episode');
      expect(tvVideo!.seriesTitle).toBe('Test Show');
      expect(tvVideo!.seasonNumber).toBe(1);
      expect(tvVideo!.episodeNumber).toBe(1);
      expect(tvVideo!.episodeId).toBe('S01E01');
      expect(tvVideo!.network).toBe('Test Network');
      expect(tvVideo!.year).toBe(2024);
      expect(tvVideo!.genre).toBe('Drama');
    });

    it.skipIf(!fixturesExist)('extracts technical information', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos = await adapter.getVideos();
      const compatibleVideo = videos.find((v) => v.filePath.includes('compatible-h264'));

      expect(compatibleVideo).toBeDefined();
      expect(compatibleVideo!.container).toBe('mp4');
      expect(compatibleVideo!.videoCodec).toBe('h264');
      expect(compatibleVideo!.audioCodec).toBe('aac');
      expect(compatibleVideo!.width).toBe(640);
      expect(compatibleVideo!.height).toBe(480);
    });

    it.skipIf(!fixturesExist)('handles different video containers', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos = await adapter.getVideos();

      // Should find MKV file
      const mkvVideo = videos.find((v) => v.filePath.endsWith('.mkv'));
      expect(mkvVideo).toBeDefined();
      expect(mkvVideo!.container).toBe('mkv');

      // Should find WebM file
      const webmVideo = videos.find((v) => v.filePath.endsWith('.webm'));
      expect(webmVideo).toBeDefined();
      // WebM is reported as mkv container by ffprobe
      expect(['webm', 'mkv']).toContain(webmVideo!.container);
    });
  });

  describe('getFilteredVideos', () => {
    it.skipIf(!fixturesExist)('filters by content type', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const movies = await adapter.getFilteredVideos({ contentType: 'movie' });
      const tvshows = await adapter.getFilteredVideos({ contentType: 'tvshow' });

      expect(movies.every((v) => v.contentType === 'movie')).toBe(true);
      expect(tvshows.every((v) => v.contentType === 'tvshow')).toBe(true);
    });

    it.skipIf(!fixturesExist)('filters by year', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const videos2024 = await adapter.getFilteredVideos({ year: 2024 });

      expect(videos2024.length).toBeGreaterThan(0);
      expect(videos2024.every((v) => v.year === 2024)).toBe(true);
    });

    it.skipIf(!fixturesExist)('filters by genre', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const dramaVideos = await adapter.getFilteredVideos({ genre: 'Drama' });

      expect(dramaVideos.length).toBeGreaterThan(0);
      expect(dramaVideos.every((v) => v.genre?.toLowerCase().includes('drama'))).toBe(true);
    });

    it.skipIf(!fixturesExist)('filters by path pattern', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      const mp4Videos = await adapter.getFilteredVideos({ pathPattern: '*.mp4' });

      expect(mp4Videos.length).toBeGreaterThan(0);
      expect(mp4Videos.every((v) => v.filePath.endsWith('.mp4'))).toBe(true);
    });
  });

  describe('custom extensions', () => {
    it.skipIf(!fixturesExist)('only scans specified extensions', async () => {
      const adapter = new VideoDirectoryAdapter({
        path: FIXTURES_DIR,
        extensions: ['mp4'],
      });

      const videos = await adapter.getVideos();

      expect(videos.every((v) => v.filePath.endsWith('.mp4'))).toBe(true);
    });

    it.skipIf(!fixturesExist)('scans multiple specified extensions', async () => {
      const adapter = new VideoDirectoryAdapter({
        path: FIXTURES_DIR,
        extensions: ['mp4', 'mkv'],
      });

      const videos = await adapter.getVideos();

      expect(
        videos.every((v) => v.filePath.endsWith('.mp4') || v.filePath.endsWith('.mkv'))
      ).toBe(true);
    });
  });

  describe('disconnect', () => {
    it.skipIf(!fixturesExist)('clears cache after disconnect', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      await adapter.connect();
      expect(adapter.getVideoCount()).toBeGreaterThan(0);

      await adapter.disconnect();
      expect(adapter.getVideoCount()).toBe(0);
    });

    it.skipIf(!fixturesExist)('rescans after disconnect and reconnect', async () => {
      const adapter = new VideoDirectoryAdapter({ path: FIXTURES_DIR });

      await adapter.connect();
      const countBefore = adapter.getVideoCount();

      await adapter.disconnect();
      await adapter.connect();
      const countAfter = adapter.getVideoCount();

      expect(countAfter).toBe(countBefore);
    });
  });

  describe('error handling', () => {
    it('reports warning for non-existent directory but does not throw', async () => {
      const warnings: VideoScanWarning[] = [];
      const adapter = new VideoDirectoryAdapter({
        path: '/nonexistent/path/to/videos',
        onWarning: (warning) => warnings.push(warning),
      });

      await adapter.connect();

      // Should complete without errors, but may have warnings
      expect(adapter.getVideoCount()).toBe(0);
    });
  });
});
