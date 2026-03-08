import { describe, it, expect } from 'bun:test';
import {
  checkVideoCompatibility,
  isCompatibleVideoCodec,
  isCompatibleAudioCodec,
  isCompatibleContainer,
  canPassthrough,
} from './compatibility.js';
import type { VideoSourceAnalysis } from './types.js';
import { DEVICE_PROFILES } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a base video analysis with sensible defaults
 */
function createAnalysis(overrides: Partial<VideoSourceAnalysis> = {}): VideoSourceAnalysis {
  return {
    filePath: '/path/to/video.mp4',
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
    duration: 3600,
    hasVideoStream: true,
    hasAudioStream: true,
    ...overrides,
  };
}

const ipodClassic = DEVICE_PROFILES['ipod-classic']!;
const ipodVideo5g = DEVICE_PROFILES['ipod-video-5g']!;

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('video/compatibility helpers', () => {
  describe('isCompatibleVideoCodec', () => {
    it('returns true for H.264 baseline on all devices', () => {
      expect(isCompatibleVideoCodec('h264', 'baseline', ipodClassic)).toBe(true);
      expect(isCompatibleVideoCodec('h264', 'baseline', ipodVideo5g)).toBe(true);
    });

    it('returns true for H.264 main on devices that support main profile', () => {
      expect(isCompatibleVideoCodec('h264', 'main', ipodClassic)).toBe(true);
    });

    it('returns false for H.264 main on baseline-only devices', () => {
      expect(isCompatibleVideoCodec('h264', 'main', ipodVideo5g)).toBe(false);
    });

    it('returns false for H.264 high profile on all devices', () => {
      expect(isCompatibleVideoCodec('h264', 'high', ipodClassic)).toBe(false);
      expect(isCompatibleVideoCodec('h264', 'high', ipodVideo5g)).toBe(false);
    });

    it('returns true for H.264 with no profile info (assume compatible)', () => {
      expect(isCompatibleVideoCodec('h264', null, ipodClassic)).toBe(true);
      expect(isCompatibleVideoCodec('h264', null, ipodVideo5g)).toBe(true);
    });

    it('returns false for non-H.264 codecs', () => {
      expect(isCompatibleVideoCodec('hevc', null, ipodClassic)).toBe(false);
      expect(isCompatibleVideoCodec('vp9', null, ipodClassic)).toBe(false);
      expect(isCompatibleVideoCodec('mpeg4', null, ipodClassic)).toBe(false);
    });

    it('handles codec name variations', () => {
      expect(isCompatibleVideoCodec('avc', 'main', ipodClassic)).toBe(true);
      expect(isCompatibleVideoCodec('avc1', 'baseline', ipodClassic)).toBe(true);
      expect(isCompatibleVideoCodec('H264', 'main', ipodClassic)).toBe(true);
    });
  });

  describe('isCompatibleAudioCodec', () => {
    it('returns true for AAC', () => {
      expect(isCompatibleAudioCodec('aac')).toBe(true);
      expect(isCompatibleAudioCodec('AAC')).toBe(true);
      expect(isCompatibleAudioCodec('mp4a')).toBe(true);
    });

    it('returns false for non-AAC codecs', () => {
      expect(isCompatibleAudioCodec('mp3')).toBe(false);
      expect(isCompatibleAudioCodec('ac3')).toBe(false);
      expect(isCompatibleAudioCodec('dts')).toBe(false);
      expect(isCompatibleAudioCodec('flac')).toBe(false);
    });
  });

  describe('isCompatibleContainer', () => {
    it('returns true for MP4 and M4V', () => {
      expect(isCompatibleContainer('mp4')).toBe(true);
      expect(isCompatibleContainer('m4v')).toBe(true);
      expect(isCompatibleContainer('MP4')).toBe(true);
      expect(isCompatibleContainer('M4V')).toBe(true);
    });

    it('returns false for other containers', () => {
      expect(isCompatibleContainer('mkv')).toBe(false);
      expect(isCompatibleContainer('avi')).toBe(false);
      expect(isCompatibleContainer('webm')).toBe(false);
      expect(isCompatibleContainer('mov')).toBe(false);
    });
  });
});

// =============================================================================
// Passthrough Tests
// =============================================================================

describe('video/compatibility passthrough', () => {
  it('passthrough: compatible H.264 MP4 at 640x480', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'h264',
      videoProfile: 'main',
      width: 640,
      height: 480,
      videoBitrate: 2000,
      frameRate: 24,
      audioCodec: 'aac',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
    expect(result.reasons).toHaveLength(0);
  });

  it('passthrough: compatible H.264 M4V with AAC', () => {
    const analysis = createAnalysis({
      container: 'm4v',
      videoCodec: 'h264',
      videoProfile: 'main',
      width: 640,
      height: 480,
      audioCodec: 'aac',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
    expect(result.reasons).toHaveLength(0);
  });

  it('passthrough: baseline profile on baseline-only device', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'h264',
      videoProfile: 'baseline',
      width: 320,
      height: 240,
      videoBitrate: 600,
      audioCodec: 'aac',
    });

    const result = checkVideoCompatibility(analysis, ipodVideo5g);

    expect(result.status).toBe('passthrough');
    expect(result.reasons).toHaveLength(0);
  });

  it('passthrough: video without audio stream', () => {
    const analysis = createAnalysis({
      hasAudioStream: false,
      audioCodec: '',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
    expect(result.reasons).toHaveLength(0);
  });

  it('passthrough: exactly at device limits', () => {
    const analysis = createAnalysis({
      width: 640,
      height: 480,
      videoBitrate: 2500,
      frameRate: 30,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
    expect(result.reasons).toHaveLength(0);
  });
});

// =============================================================================
// Transcode Tests
// =============================================================================

describe('video/compatibility transcode', () => {
  it('transcode: MKV container (compatible codec, wrong container)', () => {
    const analysis = createAnalysis({
      container: 'mkv',
      videoCodec: 'h264',
      videoProfile: 'main',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible container: mkv');
  });

  it('transcode: AVI container', () => {
    const analysis = createAnalysis({
      container: 'avi',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible container: avi');
  });

  it('transcode: Resolution too high (1080p)', () => {
    const analysis = createAnalysis({
      width: 1920,
      height: 1080,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain(
      'Resolution exceeds device maximum: 1920x1080 > 640x480'
    );
  });

  it('transcode: Width exceeds limit', () => {
    const analysis = createAnalysis({
      width: 720,
      height: 480,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain(
      'Resolution exceeds device maximum: 720x480 > 640x480'
    );
  });

  it('transcode: Height exceeds limit', () => {
    const analysis = createAnalysis({
      width: 640,
      height: 576,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain(
      'Resolution exceeds device maximum: 640x576 > 640x480'
    );
  });

  it('transcode: Wrong video codec (HEVC)', () => {
    const analysis = createAnalysis({
      videoCodec: 'hevc',
      videoProfile: null,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible video codec: hevc');
  });

  it('transcode: Wrong video codec (VP9)', () => {
    const analysis = createAnalysis({
      videoCodec: 'vp9',
      videoProfile: null,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible video codec: vp9');
  });

  it('transcode: Wrong audio codec (AC3)', () => {
    const analysis = createAnalysis({
      audioCodec: 'ac3',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible audio codec: ac3');
  });

  it('transcode: Wrong audio codec (DTS)', () => {
    const analysis = createAnalysis({
      audioCodec: 'dts',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible audio codec: dts');
  });

  it('transcode: Video bitrate exceeds maximum', () => {
    const analysis = createAnalysis({
      videoBitrate: 5000,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain(
      'Video bitrate exceeds maximum: 5000kbps > 2500kbps'
    );
  });

  it('transcode: Frame rate exceeds maximum', () => {
    const analysis = createAnalysis({
      frameRate: 60,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Frame rate exceeds maximum: 60fps > 30fps');
  });

  it('transcode: H.264 high profile', () => {
    const analysis = createAnalysis({
      videoCodec: 'h264',
      videoProfile: 'high',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible video profile: high');
  });

  it('transcode: Main profile on baseline-only device', () => {
    const analysis = createAnalysis({
      videoCodec: 'h264',
      videoProfile: 'main',
      width: 320,
      height: 240,
      videoBitrate: 600,
    });

    const result = checkVideoCompatibility(analysis, ipodVideo5g);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible video profile: main');
  });

  it('transcode: Multiple reasons', () => {
    const analysis = createAnalysis({
      container: 'mkv',
      videoCodec: 'hevc',
      width: 1920,
      height: 1080,
      audioCodec: 'ac3',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible container: mkv');
    expect(result.reasons).toContain('Incompatible video codec: hevc');
    expect(result.reasons).toContain(
      'Resolution exceeds device maximum: 1920x1080 > 640x480'
    );
    expect(result.reasons).toContain('Incompatible audio codec: ac3');
  });
});

// =============================================================================
// Unsupported Tests
// =============================================================================

describe('video/compatibility unsupported', () => {
  it('unsupported: No video stream', () => {
    const analysis = createAnalysis({
      hasVideoStream: false,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('unsupported');
    expect(result.reasons).toContain('No video stream');
  });

  it('unsupported: Unknown/exotic video codec', () => {
    const analysis = createAnalysis({
      videoCodec: 'exotic_codec_xyz',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('unsupported');
    expect(result.reasons).toContain('Unsupported video codec: exotic_codec_xyz');
  });

  it('unsupported: Unknown/exotic audio codec with audio stream', () => {
    const analysis = createAnalysis({
      audioCodec: 'exotic_audio_xyz',
      hasAudioStream: true,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('unsupported');
    expect(result.reasons).toContain('Unsupported audio codec: exotic_audio_xyz');
  });

  it('unsupported check happens before transcode checks', () => {
    // Even though container is wrong, unsupported codec takes precedence
    const analysis = createAnalysis({
      container: 'mkv',
      videoCodec: 'unknown_codec',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('unsupported');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('Unsupported video codec');
  });
});

// =============================================================================
// Warnings Tests
// =============================================================================

describe('video/compatibility warnings', () => {
  it('warns about low quality source (low bitrate)', () => {
    const analysis = createAnalysis({
      videoBitrate: 400,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.warnings).toContain('Low quality source: 400kbps');
  });

  it('warns about low resolution source', () => {
    const analysis = createAnalysis({
      width: 240,
      height: 180,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.warnings).toContain('Low resolution source: 240x180');
  });

  it('no warning at exactly 500kbps', () => {
    const analysis = createAnalysis({
      videoBitrate: 500,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.warnings.some((w) => w.includes('Low quality'))).toBe(false);
  });

  it('no warning at exactly 320x240', () => {
    const analysis = createAnalysis({
      width: 320,
      height: 240,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.warnings.some((w) => w.includes('Low resolution'))).toBe(false);
  });

  it('warnings can occur with passthrough status', () => {
    const analysis = createAnalysis({
      videoBitrate: 400,
      width: 240,
      height: 180,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
    expect(result.warnings).toHaveLength(2);
  });

  it('warnings can occur with transcode status', () => {
    const analysis = createAnalysis({
      container: 'mkv',
      videoBitrate: 400,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible container: mkv');
    expect(result.warnings).toContain('Low quality source: 400kbps');
  });

  it('no warnings for unsupported files', () => {
    const analysis = createAnalysis({
      hasVideoStream: false,
      videoBitrate: 100,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('unsupported');
    expect(result.warnings).toHaveLength(0);
  });

  it('no bitrate warning when bitrate is 0 (unknown)', () => {
    const analysis = createAnalysis({
      videoBitrate: 0,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.warnings.some((w) => w.includes('Low quality'))).toBe(false);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('video/compatibility edge cases', () => {
  it('handles case-insensitive codec names', () => {
    const analysis = createAnalysis({
      videoCodec: 'H264',
      audioCodec: 'AAC',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
  });

  it('handles case-insensitive container names', () => {
    const analysis = createAnalysis({
      container: 'MP4',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
  });

  it('handles H.264 with null profile', () => {
    const analysis = createAnalysis({
      videoCodec: 'h264',
      videoProfile: null,
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('passthrough');
  });

  it('handles various transcodable video codecs', () => {
    const codecs = ['hevc', 'h265', 'vp9', 'vp8', 'mpeg4', 'mpeg2video', 'prores', 'av1'];

    for (const codec of codecs) {
      const analysis = createAnalysis({
        videoCodec: codec,
        videoProfile: null,
      });

      const result = checkVideoCompatibility(analysis, ipodClassic);

      expect(result.status).toBe('transcode');
      expect(result.reasons).toContain(`Incompatible video codec: ${codec}`);
    }
  });

  it('handles various transcodable audio codecs', () => {
    const codecs = ['mp3', 'ac3', 'dts', 'flac', 'vorbis', 'opus', 'alac'];

    for (const codec of codecs) {
      const analysis = createAnalysis({
        audioCodec: codec,
      });

      const result = checkVideoCompatibility(analysis, ipodClassic);

      expect(result.status).toBe('transcode');
      expect(result.reasons).toContain(`Incompatible audio codec: ${codec}`);
    }
  });

  it('handles webm container with vp9', () => {
    const analysis = createAnalysis({
      filePath: '/path/to/video.webm',
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    });

    const result = checkVideoCompatibility(analysis, ipodClassic);

    expect(result.status).toBe('transcode');
    expect(result.reasons).toContain('Incompatible container: webm');
    expect(result.reasons).toContain('Incompatible video codec: vp9');
    expect(result.reasons).toContain('Incompatible audio codec: opus');
  });
});

// =============================================================================
// canPassthrough Tests
// =============================================================================

describe('video/compatibility canPassthrough', () => {
  it('returns true for compatible H.264 MP4 files', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'h264',
      videoProfile: 'main',
      width: 640,
      height: 480,
      videoBitrate: 2000,
      frameRate: 24,
      audioCodec: 'aac',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns false with reasons for MKV container', () => {
    const analysis = createAnalysis({
      container: 'mkv',
      videoCodec: 'h264',
      videoProfile: 'main',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons).toContain('Incompatible container: mkv');
  });

  it('returns false with reasons for incompatible audio', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'h264',
      videoProfile: 'main',
      audioCodec: 'ac3',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons).toContain('Incompatible audio codec: ac3');
  });

  it('returns false with reasons for over-resolution', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'h264',
      videoProfile: 'main',
      width: 1920,
      height: 1080,
      audioCodec: 'aac',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons).toContain(
      'Resolution exceeds device maximum: 1920x1080 > 640x480'
    );
  });

  it('returns false with reasons for unsupported codec', () => {
    const analysis = createAnalysis({
      container: 'mp4',
      videoCodec: 'hevc',
      videoProfile: null,
      audioCodec: 'aac',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons).toContain('Incompatible video codec: hevc');
  });

  it('returns false for unsupported files (no video stream)', () => {
    const analysis = createAnalysis({
      hasVideoStream: false,
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons).toContain('No video stream');
  });

  it('returns false with multiple reasons when multiple issues exist', () => {
    const analysis = createAnalysis({
      container: 'mkv',
      videoCodec: 'hevc',
      width: 1920,
      height: 1080,
      audioCodec: 'ac3',
    });

    const result = canPassthrough(analysis, ipodClassic);

    expect(result.canPassthrough).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(1);
    expect(result.reasons).toContain('Incompatible container: mkv');
    expect(result.reasons).toContain('Incompatible video codec: hevc');
    expect(result.reasons).toContain('Incompatible audio codec: ac3');
  });
});
