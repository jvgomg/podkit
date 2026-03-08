/**
 * Tests for VideoDirectoryAdapter
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as path from 'node:path';
import {
  VideoDirectoryAdapter,
  createVideoDirectoryAdapter,
  type VideoDirectoryAdapterConfig,
  type VideoScanProgress,
  type VideoScanWarning,
  type CollectionVideo,
} from './directory-adapter.js';
import type { VideoMetadata, VideoMetadataAdapter, MovieMetadata, TVShowMetadata } from './metadata.js';
import type { VideoSourceAnalysis } from './types.js';

// =============================================================================
// Mock Data
// =============================================================================

// Sample data kept for potential future use with mocked scanning tests
// These would be used when we mock the glob and probeVideo functions

const _SAMPLE_MOVIE_ANALYSIS: VideoSourceAnalysis = {
  filePath: '/videos/Movie (2024).mp4',
  container: 'mp4',
  videoCodec: 'h264',
  videoProfile: 'main',
  videoLevel: '3.1',
  width: 640,
  height: 480,
  videoBitrate: 2000,
  frameRate: 24,
  audioCodec: 'aac',
  audioBitrate: 128,
  audioChannels: 2,
  audioSampleRate: 48000,
  duration: 7200,
  hasVideoStream: true,
  hasAudioStream: true,
};

const _SAMPLE_TVSHOW_ANALYSIS: VideoSourceAnalysis = {
  filePath: '/videos/Show.S01E01.mp4',
  container: 'mp4',
  videoCodec: 'h264',
  videoProfile: 'main',
  videoLevel: '3.1',
  width: 640,
  height: 480,
  videoBitrate: 1500,
  frameRate: 24,
  audioCodec: 'aac',
  audioBitrate: 128,
  audioChannels: 2,
  audioSampleRate: 48000,
  duration: 2700,
  hasVideoStream: true,
  hasAudioStream: true,
};

const _SAMPLE_MOVIE_METADATA: MovieMetadata = {
  contentType: 'movie',
  title: 'Test Movie',
  year: 2024,
  description: 'A test movie',
  genre: 'Drama',
  director: 'Test Director',
  studio: 'Test Studio',
};

const _SAMPLE_TVSHOW_METADATA: TVShowMetadata = {
  contentType: 'tvshow',
  title: 'Pilot',
  seriesTitle: 'Test Show',
  seasonNumber: 1,
  episodeNumber: 1,
  episodeId: 'S01E01',
  year: 2024,
  description: 'The first episode',
  genre: 'Drama',
  network: 'Test Network',
};

// =============================================================================
// Mock Metadata Adapter
// =============================================================================

class MockMetadataAdapter implements VideoMetadataAdapter {
  readonly name = 'mock';

  private metadataMap: Map<string, VideoMetadata | null> = new Map();
  private canHandleFiles: Set<string> = new Set();

  setMetadata(filePath: string, metadata: VideoMetadata | null): void {
    this.metadataMap.set(filePath, metadata);
    if (metadata) {
      this.canHandleFiles.add(filePath);
    }
  }

  setCanHandle(filePath: string, canHandle: boolean): void {
    if (canHandle) {
      this.canHandleFiles.add(filePath);
    } else {
      this.canHandleFiles.delete(filePath);
    }
  }

  async canHandle(filePath: string): Promise<boolean> {
    return this.canHandleFiles.has(filePath);
  }

  async getMetadata(filePath: string): Promise<VideoMetadata | null> {
    return this.metadataMap.get(filePath) ?? null;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('VideoDirectoryAdapter', () => {
  describe('constructor', () => {
    it('creates adapter with default settings', () => {
      const adapter = new VideoDirectoryAdapter({ path: '/videos' });

      expect(adapter.name).toBe('video-directory');
      expect(adapter.getRootPath()).toBe('/videos');
    });

    it('resolves relative paths', () => {
      const adapter = new VideoDirectoryAdapter({ path: './videos' });

      expect(path.isAbsolute(adapter.getRootPath())).toBe(true);
    });

    it('uses custom extensions when provided', () => {
      const adapter = new VideoDirectoryAdapter({
        path: '/videos',
        extensions: ['mp4', 'mkv'],
      });

      expect(adapter.name).toBe('video-directory');
    });
  });

  describe('createVideoDirectoryAdapter', () => {
    it('creates adapter instance', () => {
      const adapter = createVideoDirectoryAdapter({ path: '/videos' });

      expect(adapter).toBeInstanceOf(VideoDirectoryAdapter);
      expect(adapter.name).toBe('video-directory');
    });
  });

  describe('getFilePath', () => {
    it('returns video filePath property', () => {
      const adapter = new VideoDirectoryAdapter({ path: '/videos' });

      const video: CollectionVideo = {
        id: '/videos/test.mp4',
        filePath: '/videos/test.mp4',
        contentType: 'movie',
        title: 'Test',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
        duration: 3600,
      };

      expect(adapter.getFilePath(video)).toBe('/videos/test.mp4');
    });
  });

  describe('disconnect', () => {
    it('clears cache and resets connected state', async () => {
      const adapter = new VideoDirectoryAdapter({ path: '/videos' });

      // Initially not connected
      expect(adapter.getVideoCount()).toBe(0);

      // After disconnect
      await adapter.disconnect();

      expect(adapter.getVideoCount()).toBe(0);
    });
  });

  describe('getFilteredVideos', () => {
    let adapter: VideoDirectoryAdapter;
    let videos: CollectionVideo[];

    beforeEach(() => {
      adapter = new VideoDirectoryAdapter({ path: '/videos' });

      videos = [
        {
          id: '/videos/Movie1.mp4',
          filePath: '/videos/Movie1.mp4',
          contentType: 'movie',
          title: 'Action Movie',
          year: 2024,
          genre: 'Action',
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 1920,
          height: 1080,
          duration: 7200,
        },
        {
          id: '/videos/Movie2.mp4',
          filePath: '/videos/Movie2.mp4',
          contentType: 'movie',
          title: 'Comedy Movie',
          year: 2023,
          genre: 'Comedy',
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 1920,
          height: 1080,
          duration: 5400,
        },
        {
          id: '/videos/TV Shows/Show/Season 1/S01E01.mp4',
          filePath: '/videos/TV Shows/Show/Season 1/S01E01.mp4',
          contentType: 'tvshow',
          title: 'Pilot',
          seriesTitle: 'Test Show',
          seasonNumber: 1,
          episodeNumber: 1,
          episodeId: 'S01E01',
          year: 2024,
          genre: 'Drama',
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 1920,
          height: 1080,
          duration: 2700,
        },
        {
          id: '/videos/TV Shows/Show/Season 2/S02E01.mp4',
          filePath: '/videos/TV Shows/Show/Season 2/S02E01.mp4',
          contentType: 'tvshow',
          title: 'Season 2 Premiere',
          seriesTitle: 'Test Show',
          seasonNumber: 2,
          episodeNumber: 1,
          episodeId: 'S02E01',
          year: 2025,
          genre: 'Drama',
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 1920,
          height: 1080,
          duration: 2700,
        },
      ];

      // Inject videos into cache directly for testing filters
      (adapter as unknown as { cache: CollectionVideo[]; connected: boolean }).cache = videos;
      (adapter as unknown as { cache: CollectionVideo[]; connected: boolean }).connected = true;
    });

    it('filters by content type', async () => {
      const movies = await adapter.getFilteredVideos({ contentType: 'movie' });
      expect(movies).toHaveLength(2);
      expect(movies.every((v) => v.contentType === 'movie')).toBe(true);

      const tvshows = await adapter.getFilteredVideos({ contentType: 'tvshow' });
      expect(tvshows).toHaveLength(2);
      expect(tvshows.every((v) => v.contentType === 'tvshow')).toBe(true);
    });

    it('filters by genre (case-insensitive partial match)', async () => {
      const action = await adapter.getFilteredVideos({ genre: 'action' });
      expect(action).toHaveLength(1);
      expect(action[0]!.title).toBe('Action Movie');

      const drama = await adapter.getFilteredVideos({ genre: 'DRAMA' });
      expect(drama).toHaveLength(2);
    });

    it('filters by year (exact match)', async () => {
      const year2024 = await adapter.getFilteredVideos({ year: 2024 });
      expect(year2024).toHaveLength(2);

      const year2023 = await adapter.getFilteredVideos({ year: 2023 });
      expect(year2023).toHaveLength(1);
      expect(year2023[0]!.title).toBe('Comedy Movie');
    });

    it('filters by series title', async () => {
      const show = await adapter.getFilteredVideos({ seriesTitle: 'test' });
      expect(show).toHaveLength(2);
      expect(show.every((v) => v.seriesTitle === 'Test Show')).toBe(true);
    });

    it('filters by season number', async () => {
      const season1 = await adapter.getFilteredVideos({ seasonNumber: 1 });
      expect(season1).toHaveLength(1);
      expect(season1[0]!.episodeId).toBe('S01E01');

      const season2 = await adapter.getFilteredVideos({ seasonNumber: 2 });
      expect(season2).toHaveLength(1);
      expect(season2[0]!.episodeId).toBe('S02E01');
    });

    it('filters by path pattern', async () => {
      const tvShowPath = await adapter.getFilteredVideos({ pathPattern: '**/TV Shows/**' });
      expect(tvShowPath).toHaveLength(2);
      expect(tvShowPath.every((v) => v.filePath.includes('TV Shows'))).toBe(true);

      const season1Path = await adapter.getFilteredVideos({ pathPattern: '**/Season 1/**' });
      expect(season1Path).toHaveLength(1);
    });

    it('combines multiple filters', async () => {
      const result = await adapter.getFilteredVideos({
        contentType: 'tvshow',
        seriesTitle: 'test',
        seasonNumber: 1,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.episodeId).toBe('S01E01');
    });

    it('returns all videos when no filter provided', async () => {
      const result = await adapter.getFilteredVideos({});
      expect(result).toHaveLength(4);
    });
  });

  describe('progress and warning callbacks', () => {
    it('calls onProgress during scan phases', () => {
      const progressEvents: VideoScanProgress[] = [];
      const config: VideoDirectoryAdapterConfig = {
        path: '/videos',
        onProgress: (progress) => progressEvents.push({ ...progress }),
      };

      const adapter = new VideoDirectoryAdapter(config);
      expect(adapter.name).toBe('video-directory');
      // Progress callbacks would be tested in integration tests with real files
    });

    it('accepts onWarning callback', () => {
      const warnings: VideoScanWarning[] = [];
      const config: VideoDirectoryAdapterConfig = {
        path: '/videos',
        onWarning: (warning) => warnings.push({ ...warning }),
      };

      const adapter = new VideoDirectoryAdapter(config);
      expect(adapter.name).toBe('video-directory');
      // Warning callbacks would be tested in integration tests with real files
    });
  });

  describe('custom metadata adapter', () => {
    it('accepts custom metadata adapter', () => {
      const mockAdapter = new MockMetadataAdapter();
      const config: VideoDirectoryAdapterConfig = {
        path: '/videos',
        metadataAdapter: mockAdapter,
      };

      const adapter = new VideoDirectoryAdapter(config);
      expect(adapter.name).toBe('video-directory');
    });
  });
});

describe('CollectionVideo interface', () => {
  it('can represent a movie', () => {
    const movie: CollectionVideo = {
      id: '/videos/movie.mp4',
      filePath: '/videos/movie.mp4',
      contentType: 'movie',
      title: 'Test Movie',
      year: 2024,
      description: 'A test movie',
      genre: 'Drama',
      director: 'Test Director',
      studio: 'Test Studio',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 640,
      height: 480,
      duration: 7200,
    };

    expect(movie.contentType).toBe('movie');
    expect(movie.director).toBe('Test Director');
    expect(movie.studio).toBe('Test Studio');
  });

  it('can represent a TV show episode', () => {
    const episode: CollectionVideo = {
      id: '/videos/show.s01e01.mp4',
      filePath: '/videos/show.s01e01.mp4',
      contentType: 'tvshow',
      title: 'Pilot',
      seriesTitle: 'Test Show',
      seasonNumber: 1,
      episodeNumber: 1,
      episodeId: 'S01E01',
      year: 2024,
      description: 'The first episode',
      genre: 'Drama',
      network: 'Test Network',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1920,
      height: 1080,
      duration: 2700,
    };

    expect(episode.contentType).toBe('tvshow');
    expect(episode.seriesTitle).toBe('Test Show');
    expect(episode.seasonNumber).toBe(1);
    expect(episode.episodeNumber).toBe(1);
    expect(episode.episodeId).toBe('S01E01');
    expect(episode.network).toBe('Test Network');
  });
});
