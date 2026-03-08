/**
 * Unit tests for the video sync planner
 *
 * These tests verify the planning logic that converts video diffs into
 * execution plans with appropriate operations and estimates.
 *
 * ## Test Coverage
 *
 * 1. Passthrough detection (compatible videos copy directly)
 * 2. Transcode settings generation
 * 3. Time/size estimation
 * 4. Operation ordering
 * 5. Warning generation
 */

import { describe, expect, it } from 'bun:test';
import {
  planVideoSync,
  getVideoPlanSummary,
  willVideoPlanFit,
  createVideoPlanner,
  DefaultVideoSyncPlanner,
  estimateTranscodedSize,
  estimatePassthroughSize,
} from './video-planner.js';
import type { VideoSyncDiff, IPodVideo } from './video-differ.js';
import type { CollectionVideo } from '../video/directory-adapter.js';
import { getDefaultDeviceProfile } from '../video/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a CollectionVideo for testing
 */
function createVideo(
  title: string,
  options: Partial<CollectionVideo> = {}
): CollectionVideo {
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

/**
 * Create an iPod video for testing
 */
function createIPodVideo(title: string): IPodVideo {
  return {
    id: `ipod-${title}`,
    filePath: `:iPod_Control:Videos:${title}.m4v`,
    contentType: 'movie',
    title,
  };
}

/**
 * Create a VideoSyncDiff for testing
 */
function createDiff(
  toAdd: CollectionVideo[] = [],
  toRemove: IPodVideo[] = [],
  existing: { collection: CollectionVideo; ipod: IPodVideo }[] = []
): VideoSyncDiff {
  return { toAdd, toRemove, existing };
}

// =============================================================================
// Basic Planning Tests
// =============================================================================

describe('planVideoSync', () => {
  describe('empty diff', () => {
    it('should return empty plan for empty diff', () => {
      const diff = createDiff();
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(0);
      expect(plan.estimatedTime).toBe(0);
      expect(plan.estimatedSize).toBe(0);
      expect(plan.warnings).toHaveLength(0);
    });
  });

  describe('passthrough detection', () => {
    it('should create video-copy operation for compatible MP4', () => {
      const video = createVideo('Test Movie', {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-copy');
    });

    it('should create video-copy operation for compatible M4V', () => {
      const video = createVideo('Test Movie', {
        container: 'm4v',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-copy');
    });
  });

  describe('transcode detection', () => {
    it('should create video-transcode operation for MKV container', () => {
      const video = createVideo('Test Movie', {
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-transcode');
    });

    it('should create video-transcode operation for HEVC codec', () => {
      const video = createVideo('Test Movie', {
        container: 'mp4',
        videoCodec: 'hevc',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-transcode');
    });

    it('should create video-transcode operation for AC3 audio', () => {
      const video = createVideo('Test Movie', {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'ac3',
        width: 640,
        height: 480,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-transcode');
    });

    it('should create video-transcode operation for oversized resolution', () => {
      const video = createVideo('Test Movie', {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1920,
        height: 1080,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.type).toBe('video-transcode');
    });
  });

  describe('transcode settings', () => {
    it('should include transcode settings in video-transcode operations', () => {
      const video = createVideo('Test Movie', {
        container: 'mkv',
        width: 1920,
        height: 1080,
        duration: 7200,
      });
      const diff = createDiff([video]);
      const plan = planVideoSync(diff, { qualityPreset: 'high' });

      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0]!;
      expect(op.type).toBe('video-transcode');

      if (op.type === 'video-transcode') {
        expect(op.settings).toBeDefined();
        expect(op.settings.targetWidth).toBeLessThanOrEqual(640);
        expect(op.settings.targetHeight).toBeLessThanOrEqual(480);
        expect(op.settings.videoProfile).toBeDefined();
        expect(op.settings.crf).toBeDefined();
      }
    });

    it('should use device profile settings', () => {
      const video = createVideo('Test Movie', {
        container: 'mkv',
        width: 1920,
        height: 1080,
      });
      const diff = createDiff([video]);
      const device = getDefaultDeviceProfile();
      const plan = planVideoSync(diff, { deviceProfile: device });

      if (plan.operations[0]?.type === 'video-transcode') {
        expect(plan.operations[0].settings.videoProfile).toBe(device.videoProfile);
        expect(plan.operations[0].settings.videoLevel).toBe(device.videoLevel);
      }
    });
  });

  describe('multiple videos', () => {
    it('should plan operations for multiple videos', () => {
      const videos = [
        createVideo('Movie 1', { container: 'mkv' }),
        createVideo('Movie 2', { container: 'mp4', width: 640, height: 480 }),
        createVideo('Movie 3', { container: 'mkv' }),
      ];
      const diff = createDiff(videos);
      const plan = planVideoSync(diff);

      expect(plan.operations).toHaveLength(3);
    });

    it('should order copy operations before transcode operations', () => {
      const videos = [
        createVideo('Needs Transcode', { container: 'mkv' }),
        createVideo('Can Copy', { container: 'mp4', width: 640, height: 480 }),
      ];
      const diff = createDiff(videos);
      const plan = planVideoSync(diff);

      expect(plan.operations[0]!.type).toBe('video-copy');
      expect(plan.operations[1]!.type).toBe('video-transcode');
    });
  });
});

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

// =============================================================================
// Plan Summary Tests
// =============================================================================

describe('getVideoPlanSummary', () => {
  it('should count transcode operations', () => {
    const videos = [
      createVideo('Movie 1', { container: 'mkv' }),
      createVideo('Movie 2', { container: 'mkv' }),
    ];
    const diff = createDiff(videos);
    const plan = planVideoSync(diff);
    const summary = getVideoPlanSummary(plan);

    expect(summary.transcodeCount).toBe(2);
    expect(summary.copyCount).toBe(0);
  });

  it('should count copy operations', () => {
    const videos = [
      createVideo('Movie 1', { container: 'mp4', width: 640, height: 480 }),
      createVideo('Movie 2', { container: 'm4v', width: 640, height: 480 }),
    ];
    const diff = createDiff(videos);
    const plan = planVideoSync(diff);
    const summary = getVideoPlanSummary(plan);

    expect(summary.transcodeCount).toBe(0);
    expect(summary.copyCount).toBe(2);
  });

  it('should count mixed operations', () => {
    const videos = [
      createVideo('Transcode', { container: 'mkv' }),
      createVideo('Copy', { container: 'mp4', width: 640, height: 480 }),
    ];
    const diff = createDiff(videos);
    const plan = planVideoSync(diff);
    const summary = getVideoPlanSummary(plan);

    expect(summary.transcodeCount).toBe(1);
    expect(summary.copyCount).toBe(1);
  });
});

describe('willVideoPlanFit', () => {
  it('should return true when plan fits', () => {
    const videos = [
      createVideo('Small', { container: 'mp4', width: 640, height: 480, duration: 60 }),
    ];
    const diff = createDiff(videos);
    const plan = planVideoSync(diff);

    expect(willVideoPlanFit(plan, 100_000_000_000)).toBe(true);
  });

  it('should return false when plan does not fit', () => {
    const videos = [
      createVideo('Large', { container: 'mkv', duration: 7200 }),
    ];
    const diff = createDiff(videos);
    const plan = planVideoSync(diff);

    expect(willVideoPlanFit(plan, 1000)).toBe(false);
  });
});

// =============================================================================
// Interface Tests
// =============================================================================

describe('VideoSyncPlanner interface', () => {
  it('should create planner via factory function', () => {
    const planner = createVideoPlanner();
    expect(planner).toBeInstanceOf(DefaultVideoSyncPlanner);
  });

  it('should work through interface', () => {
    const planner = createVideoPlanner();
    const diff = createDiff([createVideo('Test', { container: 'mkv' })]);
    const plan = planner.plan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.estimatedSize).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });
});

// =============================================================================
// Options Tests
// =============================================================================

describe('VideoSyncPlanOptions', () => {
  it('should respect quality preset', () => {
    const video = createVideo('Test', { container: 'mkv', duration: 3600 });
    const diff = createDiff([video]);

    const planHigh = planVideoSync(diff, { qualityPreset: 'high' });
    const planLow = planVideoSync(diff, { qualityPreset: 'low' });

    // Higher quality should mean larger estimated size
    expect(planHigh.estimatedSize).toBeGreaterThan(planLow.estimatedSize);
  });

  it('should use hardware acceleration setting', () => {
    const video = createVideo('Test', { container: 'mkv' });
    const diff = createDiff([video]);
    const plan = planVideoSync(diff, { useHardwareAcceleration: true });

    if (plan.operations[0]?.type === 'video-transcode') {
      expect(plan.operations[0].settings.useHardwareAcceleration).toBe(true);
    }
  });

  it('should use software encoding when hardware disabled', () => {
    const video = createVideo('Test', { container: 'mkv' });
    const diff = createDiff([video]);
    const plan = planVideoSync(diff, { useHardwareAcceleration: false });

    if (plan.operations[0]?.type === 'video-transcode') {
      expect(plan.operations[0].settings.useHardwareAcceleration).toBe(false);
    }
  });
});
