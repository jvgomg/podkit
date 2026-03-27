/**
 * Unit tests for the video sync estimation utilities
 *
 * These tests verify the estimation logic for video operation sizes
 * and passthrough size calculations.
 */

import { describe, expect, it } from 'bun:test';
import { estimateTranscodedSize, estimatePassthroughSize } from './planner.js';
import type { CollectionVideo } from '../../video/directory-adapter.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a CollectionVideo for testing
 */
function createVideo(title: string, options: Partial<CollectionVideo> = {}): CollectionVideo {
  return {
    id: options.id ?? `/videos/${title}.mkv`,
    filePath: options.filePath ?? `/videos/${title}.mkv`,
    contentType: options.contentType ?? 'movie',
    title,
    container: options.container ?? 'mkv',
    videoCodec: options.videoCodec ?? 'h264',
    audioCodec: options.audioCodec ?? 'aac',
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    duration: options.duration ?? 7200, // 2 hours
    year: options.year,
    description: options.description,
    genre: options.genre,
    director: options.director,
    studio: options.studio,
    seriesTitle: options.seriesTitle,
    seasonNumber: options.seasonNumber,
    episodeNumber: options.episodeNumber,
    episodeId: options.episodeId,
    network: options.network,
  };
}

// =============================================================================
// Size Estimation Tests
// =============================================================================

describe('estimateTranscodedSize', () => {
  it('should estimate size based on duration and bitrates', () => {
    // 1 hour video at 2000kbps video + 128kbps audio
    const size = estimateTranscodedSize(3600, 2000, 128);

    // Expected: (3600 * 2000 * 1000 / 8) + (3600 * 128 * 1000 / 8) + overhead
    // = 900,000,000 + 57,600,000 + 4096 = ~957,604,096 bytes
    expect(size).toBeGreaterThan(900_000_000);
    expect(size).toBeLessThan(1_000_000_000);
  });

  it('should scale with duration', () => {
    const size1h = estimateTranscodedSize(3600, 2000, 128);
    const size2h = estimateTranscodedSize(7200, 2000, 128);

    // 2 hour video should be roughly 2x the size of 1 hour
    expect(size2h).toBeGreaterThan(size1h * 1.9);
    expect(size2h).toBeLessThan(size1h * 2.1);
  });

  it('should scale with bitrate', () => {
    const sizeLow = estimateTranscodedSize(3600, 1000, 128);
    const sizeHigh = estimateTranscodedSize(3600, 2000, 128);

    expect(sizeHigh).toBeGreaterThan(sizeLow * 1.4);
  });
});

describe('estimatePassthroughSize', () => {
  it('should estimate based on resolution and duration', () => {
    const video = createVideo('Test', {
      width: 640,
      height: 480,
      duration: 3600,
    });

    const size = estimatePassthroughSize(video);
    expect(size).toBeGreaterThan(0);
  });

  it('should return larger size for HD content', () => {
    const videoSD = createVideo('SD', { width: 640, height: 480, duration: 3600 });
    const videoHD = createVideo('HD', { width: 1280, height: 720, duration: 3600 });

    const sizeSD = estimatePassthroughSize(videoSD);
    const sizeHD = estimatePassthroughSize(videoHD);

    expect(sizeHD).toBeGreaterThan(sizeSD);
  });
});
