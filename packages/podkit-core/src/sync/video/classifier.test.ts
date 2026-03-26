import { describe, expect, test } from 'bun:test';
import { VideoTrackClassifier } from './classifier.js';
import { resolveVideoConfig } from './config.js';
import type { CollectionVideo } from '../../video/directory-adapter.js';
import { DEVICE_PROFILES } from '../../video/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeCollectionVideo(overrides: Partial<CollectionVideo> = {}): CollectionVideo {
  return {
    id: '/videos/movie.mkv',
    filePath: '/videos/movie.mkv',
    contentType: 'movie',
    title: 'Test Movie',
    year: 2024,
    container: 'mkv',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    duration: 7200,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('VideoTrackClassifier', () => {
  describe('no device profile', () => {
    test('always returns transcode with default settings', () => {
      const config = resolveVideoConfig({});
      const classifier = new VideoTrackClassifier(config);
      const video = makeCollectionVideo();

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
      if (result.action.type === 'transcode') {
        expect(result.action.settings.targetVideoBitrate).toBe(1500);
        expect(result.action.settings.targetAudioBitrate).toBe(128);
        expect(result.action.settings.targetWidth).toBe(640);
        expect(result.action.settings.targetHeight).toBe(480);
      }
    });

    test('respects hardwareAcceleration=false', () => {
      const config = resolveVideoConfig({ hardwareAcceleration: false });
      const classifier = new VideoTrackClassifier(config);
      const video = makeCollectionVideo();

      const result = classifier.classify(video);
      expect(result.action.type).toBe('transcode');
      if (result.action.type === 'transcode') {
        expect(result.action.settings.useHardwareAcceleration).toBe(false);
      }
    });
  });

  describe('with device profile (ipod-classic)', () => {
    const ipodClassic = DEVICE_PROFILES['ipod-classic']!;

    test('passthrough for compatible MP4 within device limits', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodClassic });
      const classifier = new VideoTrackClassifier(config);

      // MP4 container, H.264, AAC, within 640x480 limits
      const video = makeCollectionVideo({
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(true);
      expect(result.action.type).toBe('passthrough');
    });

    test('transcode for MKV container with compatible streams', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodClassic });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
    });

    test('transcode for oversized resolution', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodClassic });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1920,
        height: 1080,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
    });

    test('transcode for incompatible video codec', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodClassic });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mkv',
        videoCodec: 'hevc',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
    });

    test('transcode for incompatible audio codec', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodClassic });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'ac3',
        width: 640,
        height: 480,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
    });

    test('transcode settings use device profile constraints', () => {
      const config = resolveVideoConfig({
        deviceProfile: ipodClassic,
        videoQuality: 'high',
      });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mkv',
        videoCodec: 'hevc',
        audioCodec: 'ac3',
        width: 1920,
        height: 1080,
      });

      const result = classifier.classify(video);
      expect(result.action.type).toBe('transcode');
      if (result.action.type === 'transcode') {
        // Should be capped to device max dimensions
        expect(result.action.settings.targetWidth).toBeLessThanOrEqual(ipodClassic.maxWidth);
        expect(result.action.settings.targetHeight).toBeLessThanOrEqual(ipodClassic.maxHeight);
        // Should use device profile/level
        expect(result.action.settings.videoProfile).toBe(ipodClassic.videoProfile);
        expect(result.action.settings.videoLevel).toBe(ipodClassic.videoLevel);
      }
    });

    test('respects quality preset for transcode settings', () => {
      const configLow = resolveVideoConfig({
        deviceProfile: ipodClassic,
        videoQuality: 'low',
      });
      const configMax = resolveVideoConfig({
        deviceProfile: ipodClassic,
        videoQuality: 'max',
      });

      const classifierLow = new VideoTrackClassifier(configLow);
      const classifierMax = new VideoTrackClassifier(configMax);

      const video = makeCollectionVideo({
        container: 'mkv',
        videoCodec: 'hevc',
        width: 1920,
        height: 1080,
      });

      const resultLow = classifierLow.classify(video);
      const resultMax = classifierMax.classify(video);

      if (resultLow.action.type === 'transcode' && resultMax.action.type === 'transcode') {
        expect(resultMax.action.settings.targetVideoBitrate).toBeGreaterThan(
          resultLow.action.settings.targetVideoBitrate
        );
      }
    });
  });

  describe('with device profile (ipod-video-5g)', () => {
    const ipodVideo5G = DEVICE_PROFILES['ipod-video-5g']!;

    test('passthrough for small MP4 within 320x240 limits', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodVideo5G });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 320,
        height: 240,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(true);
      expect(result.action.type).toBe('passthrough');
    });

    test('transcode for video exceeding 320x240', () => {
      const config = resolveVideoConfig({ deviceProfile: ipodVideo5G });
      const classifier = new VideoTrackClassifier(config);

      const video = makeCollectionVideo({
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });

      const result = classifier.classify(video);
      expect(result.compatible).toBe(false);
      expect(result.action.type).toBe('transcode');
    });
  });

  describe('caching', () => {
    test('returns cached result for same file path', () => {
      const config = resolveVideoConfig({});
      const classifier = new VideoTrackClassifier(config);
      const video = makeCollectionVideo();

      const result1 = classifier.classify(video);
      const result2 = classifier.classify(video);
      expect(result1).toBe(result2); // Same object reference (cached)
    });

    test('returns different results for different file paths', () => {
      const config = resolveVideoConfig({
        deviceProfile: DEVICE_PROFILES['ipod-classic']!,
      });
      const classifier = new VideoTrackClassifier(config);

      const compatible = makeCollectionVideo({
        filePath: '/videos/compatible.mp4',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
      });
      const incompatible = makeCollectionVideo({
        filePath: '/videos/incompatible.mkv',
        container: 'mkv',
        videoCodec: 'hevc',
        width: 1920,
        height: 1080,
      });

      const result1 = classifier.classify(compatible);
      const result2 = classifier.classify(incompatible);
      expect(result1.compatible).toBe(true);
      expect(result2.compatible).toBe(false);
    });
  });
});
