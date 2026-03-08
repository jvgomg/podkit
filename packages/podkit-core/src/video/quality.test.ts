import { describe, it, expect } from 'bun:test';
import {
  calculateTargetDimensions,
  calculateEffectiveSettings,
  generateQualityWarnings,
  isSourceQualityLimiting,
  getQualityLimitationSummary,
} from './quality.js';
import type { VideoSourceAnalysis } from './types.js';
import { DEVICE_PROFILES } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal VideoSourceAnalysis for testing
 */
function createSourceAnalysis(overrides: Partial<VideoSourceAnalysis> = {}): VideoSourceAnalysis {
  return {
    filePath: '/path/to/video.mkv',
    container: 'mkv',
    videoCodec: 'h264',
    videoProfile: 'main',
    videoLevel: '4.0',
    width: 1920,
    height: 1080,
    videoBitrate: 8000,
    frameRate: 24,
    audioCodec: 'aac',
    audioBitrate: 192,
    audioChannels: 2,
    audioSampleRate: 48000,
    duration: 7200,
    hasVideoStream: true,
    hasAudioStream: true,
    ...overrides,
  };
}

// Device profile shortcuts
const IPOD_CLASSIC = DEVICE_PROFILES['ipod-classic']!;
const IPOD_VIDEO_5G = DEVICE_PROFILES['ipod-video-5g']!;

// =============================================================================
// calculateTargetDimensions Tests
// =============================================================================

describe('calculateTargetDimensions', () => {
  describe('no upscaling (source smaller than device)', () => {
    it('uses source dimensions when source is smaller', () => {
      const result = calculateTargetDimensions(480, 360, 640, 480);
      expect(result.width).toBe(480);
      expect(result.height).toBe(360);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('uses source dimensions when source equals device max', () => {
      const result = calculateTargetDimensions(640, 480, 640, 480);
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('ensures even dimensions for odd source sizes', () => {
      const result = calculateTargetDimensions(479, 361, 640, 480);
      // Should round down to even
      expect(result.width % 2).toBe(0);
      expect(result.height % 2).toBe(0);
      expect(result.width).toBe(478);
      expect(result.height).toBe(360);
    });
  });

  describe('downscaling (source larger than device)', () => {
    it('scales 1080p to fit iPod Classic (4:3 device)', () => {
      // 1920x1080 (16:9) -> 640x480 (4:3)
      // 16:9 is wider than 4:3, so fit to width
      const result = calculateTargetDimensions(1920, 1080, 640, 480);
      expect(result.width).toBe(640);
      // 640 / (16/9) = 360
      expect(result.height).toBe(360);
      expect(result.needsLetterboxing).toBe(true);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('scales 4K to fit iPod Classic', () => {
      // 3840x2160 (16:9) -> should fit within 640x480
      const result = calculateTargetDimensions(3840, 2160, 640, 480);
      expect(result.width).toBe(640);
      expect(result.height).toBe(360);
      expect(result.needsLetterboxing).toBe(true);
    });

    it('scales standard definition 4:3 content', () => {
      // 720x480 (3:2) -> 640x480 (4:3)
      // 3:2 (1.5) is wider than 4:3 (1.33), fit to width
      const result = calculateTargetDimensions(720, 480, 640, 480);
      expect(result.width).toBe(640);
      // 640 / 1.5 = 426.67 -> 426
      expect(result.height).toBe(426);
      expect(result.needsLetterboxing).toBe(true);
    });
  });

  describe('aspect ratios', () => {
    it('handles 16:9 widescreen (letterboxing needed)', () => {
      const result = calculateTargetDimensions(1280, 720, 640, 480);
      expect(result.width).toBe(640);
      expect(result.height).toBe(360);
      expect(result.needsLetterboxing).toBe(true);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('handles 4:3 standard (no boxing needed when matching device)', () => {
      const result = calculateTargetDimensions(800, 600, 640, 480);
      // 800x600 is 4:3, same as device
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('handles 2.35:1 cinemascope (significant letterboxing)', () => {
      // 2.35:1 -> 2.35 aspect ratio
      const result = calculateTargetDimensions(940, 400, 640, 480);
      expect(result.width).toBe(640);
      // 640 / 2.35 = 272
      expect(result.height).toBe(272);
      expect(result.needsLetterboxing).toBe(true);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('handles portrait/narrow content (pillarboxing needed)', () => {
      // 480x640 vertical video on 640x480 device (4:3 = 1.33)
      // Source aspect: 0.75 < device aspect: 1.33
      const result = calculateTargetDimensions(480, 640, 640, 480);
      // Fit to height: width = 480 * 0.75 = 360
      expect(result.width).toBe(360);
      expect(result.height).toBe(480);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(true);
    });

    it('handles 1:1 square content', () => {
      // 1:1 is narrower than 4:3, needs pillarboxing
      const result = calculateTargetDimensions(500, 500, 640, 480);
      // Fit to height: width = 480 * 1 = 480
      expect(result.width).toBe(480);
      expect(result.height).toBe(480);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles very small source dimensions', () => {
      const result = calculateTargetDimensions(160, 120, 640, 480);
      expect(result.width).toBe(160);
      expect(result.height).toBe(120);
    });

    it('handles source exactly matching device max', () => {
      const result = calculateTargetDimensions(640, 480, 640, 480);
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.needsLetterboxing).toBe(false);
      expect(result.needsPillarboxing).toBe(false);
    });

    it('handles source width equal, height larger', () => {
      const result = calculateTargetDimensions(640, 800, 640, 480);
      // 640/800 = 0.8, narrower than 4:3 (1.33)
      // Fit to height: 480 * 0.8 = 384
      expect(result.width).toBe(384);
      expect(result.height).toBe(480);
      expect(result.needsPillarboxing).toBe(true);
    });

    it('handles source height equal, width larger', () => {
      const result = calculateTargetDimensions(800, 480, 640, 480);
      // 800/480 = 1.67, wider than 4:3 (1.33)
      // Fit to width: 640 / 1.67 = 384
      expect(result.width).toBe(640);
      expect(result.height).toBe(384);
      expect(result.needsLetterboxing).toBe(true);
    });
  });
});

// =============================================================================
// calculateEffectiveSettings Tests
// =============================================================================

describe('calculateEffectiveSettings', () => {
  describe('high-quality source (use preset settings)', () => {
    it('uses preset bitrate when source is high quality', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 8000, // Much higher than any preset
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      // Should use preset bitrate (2000 for high on iPod Classic)
      expect(settings.targetVideoBitrate).toBe(2000);
    });

    it('scales resolution to device max', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(640);
      expect(settings.targetHeight).toBe(360); // 16:9 letterboxed
    });

    it('uses device profile codec settings', () => {
      const source = createSourceAnalysis();

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.videoProfile).toBe('main');
      expect(settings.videoLevel).toBe('3.1');
    });

    it('uses preset CRF value', () => {
      const source = createSourceAnalysis();

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.crf).toBe(21); // High preset CRF for iPod Classic
    });
  });

  describe('low-quality source (cap to source)', () => {
    it('caps bitrate to source when source is lower', () => {
      const source = createSourceAnalysis({
        videoBitrate: 500, // Lower than preset target
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      // Should cap to source bitrate
      expect(settings.targetVideoBitrate).toBe(500);
    });

    it('uses source resolution when smaller than device max', () => {
      const source = createSourceAnalysis({
        width: 480,
        height: 360,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(480);
      expect(settings.targetHeight).toBe(360);
    });

    it('caps frame rate to source when lower than device max', () => {
      const source = createSourceAnalysis({
        frameRate: 15, // Lower than device max (30)
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.frameRate).toBe(15);
    });
  });

  describe('quality presets', () => {
    it('uses max preset settings', () => {
      const source = createSourceAnalysis({ videoBitrate: 10000 });
      const settings = calculateEffectiveSettings(source, 'max', IPOD_CLASSIC);

      expect(settings.targetVideoBitrate).toBe(2500); // Max preset
      expect(settings.crf).toBe(18); // Max CRF
    });

    it('uses medium preset settings', () => {
      const source = createSourceAnalysis({ videoBitrate: 10000 });
      const settings = calculateEffectiveSettings(source, 'medium', IPOD_CLASSIC);

      expect(settings.targetVideoBitrate).toBe(1500);
      expect(settings.crf).toBe(24);
    });

    it('uses low preset settings', () => {
      const source = createSourceAnalysis({ videoBitrate: 10000 });
      const settings = calculateEffectiveSettings(source, 'low', IPOD_CLASSIC);

      expect(settings.targetVideoBitrate).toBe(1000);
      expect(settings.crf).toBe(27);
    });
  });

  describe('different device profiles', () => {
    it('respects iPod Video 5G constraints', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 8000,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_VIDEO_5G);

      expect(settings.targetWidth).toBe(320);
      expect(settings.targetHeight).toBe(180); // 16:9 scaled down
      expect(settings.targetVideoBitrate).toBe(600); // iPod Video 5G high preset
      expect(settings.videoProfile).toBe('baseline');
      expect(settings.videoLevel).toBe('3.0');
    });

    it('respects device max bitrate even when preset is higher', () => {
      const source = createSourceAnalysis({ videoBitrate: 10000 });

      // iPod Video 5G max is 768, but high preset is 600
      const settings = calculateEffectiveSettings(source, 'max', IPOD_VIDEO_5G);

      // max preset is 768, which equals device max
      expect(settings.targetVideoBitrate).toBe(768);
    });
  });

  describe('audio settings', () => {
    it('uses preset audio bitrate', () => {
      const source = createSourceAnalysis({ audioBitrate: 320 });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      // High preset: 128kbps audio
      expect(settings.targetAudioBitrate).toBe(128);
    });

    it('caps audio to device max', () => {
      const source = createSourceAnalysis({ audioBitrate: 320 });

      // iPod Classic max audio is 160kbps
      const settings = calculateEffectiveSettings(source, 'max', IPOD_CLASSIC);

      expect(settings.targetAudioBitrate).toBe(160);
    });
  });

  describe('frame rate handling', () => {
    it('uses source frame rate when lower than device max', () => {
      const source = createSourceAnalysis({ frameRate: 24 });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.frameRate).toBe(24);
    });

    it('caps to device max frame rate', () => {
      const source = createSourceAnalysis({ frameRate: 60 });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.frameRate).toBe(30); // Device max
    });
  });
});

// =============================================================================
// generateQualityWarnings Tests
// =============================================================================

describe('generateQualityWarnings', () => {
  describe('bitrate warnings', () => {
    it('warns when source bitrate limits output', () => {
      const source = createSourceAnalysis({ videoBitrate: 500 });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      const bitrateWarning = warnings.find(w => w.type === 'bitrate');
      expect(bitrateWarning).toBeDefined();
      expect(bitrateWarning!.message).toContain('500kbps');
      expect(bitrateWarning!.message).toContain('2000kbps'); // High preset target
    });

    it('does not warn when source bitrate exceeds preset', () => {
      const source = createSourceAnalysis({ videoBitrate: 8000 });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      const bitrateWarning = warnings.find(w => w.type === 'bitrate');
      expect(bitrateWarning).toBeUndefined();
    });
  });

  describe('resolution warnings', () => {
    it('warns when source resolution limits output', () => {
      const source = createSourceAnalysis({
        width: 480,
        height: 360,
        videoBitrate: 8000, // High bitrate to avoid bitrate warning
      });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      const resWarning = warnings.find(w => w.type === 'resolution');
      expect(resWarning).toBeDefined();
      expect(resWarning!.message).toContain('480x360');
      expect(resWarning!.message).toContain('640x480');
    });

    it('does not warn when source resolution exceeds device max', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 8000,
      });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      const resWarning = warnings.find(w => w.type === 'resolution');
      expect(resWarning).toBeUndefined();
    });
  });

  describe('multiple warnings', () => {
    it('generates multiple warnings for low-quality source', () => {
      const source = createSourceAnalysis({
        width: 320,
        height: 240,
        videoBitrate: 300,
        frameRate: 15,
      });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      expect(warnings.length).toBeGreaterThanOrEqual(2);

      const types = warnings.map(w => w.type);
      expect(types).toContain('bitrate');
      expect(types).toContain('resolution');
    });
  });

  describe('no warnings for high-quality source', () => {
    it('returns empty array for high-quality source', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 8000,
        frameRate: 30,
      });
      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);
      const warnings = generateQualityWarnings(source, 'high', IPOD_CLASSIC, settings);

      expect(warnings).toHaveLength(0);
    });
  });
});

// =============================================================================
// isSourceQualityLimiting Tests
// =============================================================================

describe('isSourceQualityLimiting', () => {
  it('returns true for low-quality source', () => {
    const source = createSourceAnalysis({
      width: 320,
      height: 240,
      videoBitrate: 300,
    });

    expect(isSourceQualityLimiting(source, 'high', IPOD_CLASSIC)).toBe(true);
  });

  it('returns false for high-quality source', () => {
    const source = createSourceAnalysis({
      width: 1920,
      height: 1080,
      videoBitrate: 8000,
    });

    expect(isSourceQualityLimiting(source, 'high', IPOD_CLASSIC)).toBe(false);
  });
});

// =============================================================================
// getQualityLimitationSummary Tests
// =============================================================================

describe('getQualityLimitationSummary', () => {
  it('returns warning messages for low-quality source', () => {
    const source = createSourceAnalysis({
      videoBitrate: 500,
    });

    const messages = getQualityLimitationSummary(source, 'high', IPOD_CLASSIC);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('500kbps');
  });

  it('returns empty array for high-quality source', () => {
    const source = createSourceAnalysis({
      width: 1920,
      height: 1080,
      videoBitrate: 8000,
    });

    const messages = getQualityLimitationSummary(source, 'high', IPOD_CLASSIC);

    expect(messages).toHaveLength(0);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('integration scenarios', () => {
  describe('example from task requirements', () => {
    it('high-quality source uses preset settings', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 8000,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(640);
      expect(settings.targetHeight).toBe(360); // 16:9 letterboxed in 4:3
      expect(settings.targetVideoBitrate).toBe(2000);
    });

    it('low-quality source caps to source', () => {
      const source = createSourceAnalysis({
        width: 480,
        height: 360,
        videoBitrate: 500,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(480);
      expect(settings.targetHeight).toBe(360);
      expect(settings.targetVideoBitrate).toBe(500);
    });
  });

  describe('real-world scenarios', () => {
    it('handles YouTube-quality source (720p, ~2-3Mbps)', () => {
      const source = createSourceAnalysis({
        width: 1280,
        height: 720,
        videoBitrate: 2500,
        frameRate: 30,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(640);
      expect(settings.targetHeight).toBe(360);
      expect(settings.targetVideoBitrate).toBe(2000); // Limited by preset
      expect(settings.frameRate).toBe(30);
    });

    it('handles old VHS rip (low resolution, low bitrate)', () => {
      const source = createSourceAnalysis({
        width: 352,
        height: 240,
        videoBitrate: 400,
        frameRate: 29.97,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(352);
      expect(settings.targetHeight).toBe(240);
      expect(settings.targetVideoBitrate).toBe(400);
    });

    it('handles anime (24fps, various resolutions)', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 4000,
        frameRate: 23.976,
      });

      const settings = calculateEffectiveSettings(source, 'high', IPOD_CLASSIC);

      expect(settings.targetWidth).toBe(640);
      expect(settings.targetHeight).toBe(360);
      expect(settings.frameRate).toBe(23.976);
    });

    it('handles music video (high quality, square pixels)', () => {
      const source = createSourceAnalysis({
        width: 1920,
        height: 1080,
        videoBitrate: 15000, // High bitrate music video
        frameRate: 24,
      });

      const settings = calculateEffectiveSettings(source, 'max', IPOD_CLASSIC);

      expect(settings.targetVideoBitrate).toBe(2500); // Max preset
      expect(settings.crf).toBe(18);
    });
  });
});
