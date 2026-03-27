/**
 * Unit tests for music planning utilities
 *
 * Tests for source categorization, size estimation, device compatibility,
 * and operation size calculation.
 */

import { describe, expect, it } from 'bun:test';
import {
  calculateMusicOperationSize,
  categorizeSource,
  estimateCopySize,
  estimateTranscodedSize,
  fileTypeToAudioCodec,
  isDeviceCompatible,
  isDefaultCompatibleFormat,
  isLosslessSource,
  requiresTranscoding,
  willWarnLossyToLossy,
} from './planner.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { AudioFileType } from '../../types.js';
import type { DeviceTrack, SyncOperation } from '../engine/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal CollectionTrack for testing
 */
function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  fileType: AudioFileType = 'flac',
  options: Partial<CollectionTrack> = {}
): CollectionTrack {
  return {
    id: options.id ?? `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath: options.filePath ?? `/music/${artist}/${album}/${title}.${fileType}`,
    fileType,
    duration: options.duration ?? 180000, // 3 minutes default
    ...options,
  };
}

/**
 * Create a minimal DeviceTrack for testing
 */
function createDeviceTrack(artist: string, title: string, album: string): DeviceTrack {
  const track: DeviceTrack = {
    artist,
    title,
    album,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath: `Music/TRACK.m4a`,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    syncTag: null,
    update: () => track,
    remove: () => {},
    copyFile: () => track,
    setArtwork: () => track,
    setArtworkFromData: () => track,
    removeArtwork: () => track,
  };
  return track;
}

// =============================================================================
// Format Detection Tests
// =============================================================================

describe('isDefaultCompatibleFormat', () => {
  it('returns true for MP3 files', () => {
    expect(isDefaultCompatibleFormat('mp3')).toBe(true);
  });

  it('returns true for M4A files', () => {
    expect(isDefaultCompatibleFormat('m4a')).toBe(true);
  });

  it('returns true for AAC files', () => {
    expect(isDefaultCompatibleFormat('aac')).toBe(true);
  });

  it('returns true for ALAC files', () => {
    expect(isDefaultCompatibleFormat('alac')).toBe(true);
  });

  it('returns false for FLAC files', () => {
    expect(isDefaultCompatibleFormat('flac')).toBe(false);
  });

  it('returns false for OGG files', () => {
    expect(isDefaultCompatibleFormat('ogg')).toBe(false);
  });

  it('returns false for OPUS files', () => {
    expect(isDefaultCompatibleFormat('opus')).toBe(false);
  });

  it('returns false for WAV files', () => {
    expect(isDefaultCompatibleFormat('wav')).toBe(false);
  });
});

describe('requiresTranscoding', () => {
  it('returns true for FLAC files', () => {
    expect(requiresTranscoding('flac')).toBe(true);
  });

  it('returns true for OGG files', () => {
    expect(requiresTranscoding('ogg')).toBe(true);
  });

  it('returns true for OPUS files', () => {
    expect(requiresTranscoding('opus')).toBe(true);
  });

  it('returns true for WAV files', () => {
    expect(requiresTranscoding('wav')).toBe(true);
  });

  it('returns false for MP3 files', () => {
    expect(requiresTranscoding('mp3')).toBe(false);
  });

  it('returns false for M4A files', () => {
    expect(requiresTranscoding('m4a')).toBe(false);
  });

  it('returns false for AAC files', () => {
    expect(requiresTranscoding('aac')).toBe(false);
  });

  it('returns false for ALAC files', () => {
    expect(requiresTranscoding('alac')).toBe(false);
  });
});

// =============================================================================
// Source Categorization Tests
// =============================================================================

describe('categorizeSource', () => {
  describe('lossless formats', () => {
    it('categorizes FLAC as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac');
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes WAV as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'wav');
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes AIFF as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'aiff');
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes ALAC extension as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'alac');
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes M4A with ALAC codec as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a', {
        codec: 'alac',
      });
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes M4A with ALAC codec (uppercase) as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a', {
        codec: 'ALAC',
      });
      expect(categorizeSource(track)).toBe('lossless');
    });

    it('categorizes track explicitly marked as lossless', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a', {
        lossless: true,
      });
      expect(categorizeSource(track)).toBe('lossless');
    });
  });

  describe('compatible lossy formats', () => {
    it('categorizes MP3 as compatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3');
      expect(categorizeSource(track)).toBe('compatible-lossy');
    });

    it('categorizes M4A (AAC) as compatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a');
      expect(categorizeSource(track)).toBe('compatible-lossy');
    });

    it('categorizes M4A with explicit AAC codec as compatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a', {
        codec: 'aac',
      });
      expect(categorizeSource(track)).toBe('compatible-lossy');
    });

    it('categorizes AAC extension as compatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'aac');
      expect(categorizeSource(track)).toBe('compatible-lossy');
    });
  });

  describe('incompatible lossy formats', () => {
    it('categorizes OGG as incompatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'ogg');
      expect(categorizeSource(track)).toBe('incompatible-lossy');
    });

    it('categorizes Opus as incompatible-lossy', () => {
      const track = createCollectionTrack('Artist', 'Song', 'Album', 'opus');
      expect(categorizeSource(track)).toBe('incompatible-lossy');
    });
  });
});

describe('isLosslessSource', () => {
  it('returns true for lossless category', () => {
    expect(isLosslessSource('lossless')).toBe(true);
  });

  it('returns false for compatible-lossy category', () => {
    expect(isLosslessSource('compatible-lossy')).toBe(false);
  });

  it('returns false for incompatible-lossy category', () => {
    expect(isLosslessSource('incompatible-lossy')).toBe(false);
  });
});

describe('willWarnLossyToLossy', () => {
  it('returns true for incompatible-lossy (OGG, Opus)', () => {
    expect(willWarnLossyToLossy('incompatible-lossy')).toBe(true);
  });

  it('returns false for lossless', () => {
    expect(willWarnLossyToLossy('lossless')).toBe(false);
  });

  it('returns false for compatible-lossy', () => {
    expect(willWarnLossyToLossy('compatible-lossy')).toBe(false);
  });
});

// =============================================================================
// fileTypeToAudioCodec Tests
// =============================================================================

describe('fileTypeToAudioCodec', () => {
  it('maps standard file types to codecs', () => {
    expect(fileTypeToAudioCodec('mp3')).toBe('mp3');
    expect(fileTypeToAudioCodec('flac')).toBe('flac');
    expect(fileTypeToAudioCodec('ogg')).toBe('ogg');
    expect(fileTypeToAudioCodec('opus')).toBe('opus');
    expect(fileTypeToAudioCodec('wav')).toBe('wav');
    expect(fileTypeToAudioCodec('aiff')).toBe('aiff');
    expect(fileTypeToAudioCodec('alac')).toBe('alac');
  });

  it('maps m4a to aac by default', () => {
    expect(fileTypeToAudioCodec('m4a')).toBe('aac');
  });

  it('maps m4a with alac codec to alac', () => {
    expect(fileTypeToAudioCodec('m4a', 'alac')).toBe('alac');
    expect(fileTypeToAudioCodec('m4a', 'ALAC')).toBe('alac');
  });

  it('maps aac extension to aac', () => {
    expect(fileTypeToAudioCodec('aac')).toBe('aac');
  });
});

// =============================================================================
// isDeviceCompatible Tests
// =============================================================================

describe('isDeviceCompatible', () => {
  it('returns false when no supported codecs provided', () => {
    const track = createCollectionTrack('A', 'B', 'C', 'flac');
    expect(isDeviceCompatible(track, undefined)).toBe(false);
    expect(isDeviceCompatible(track, [])).toBe(false);
  });

  it('returns true when track codec is in supported list', () => {
    const track = createCollectionTrack('A', 'B', 'C', 'flac');
    expect(isDeviceCompatible(track, ['aac', 'mp3', 'flac'])).toBe(true);
  });

  it('returns false when track codec is not in supported list', () => {
    const track = createCollectionTrack('A', 'B', 'C', 'flac');
    expect(isDeviceCompatible(track, ['aac', 'mp3'])).toBe(false);
  });

  it('handles m4a files with AAC codec', () => {
    const track = createCollectionTrack('A', 'B', 'C', 'm4a');
    expect(isDeviceCompatible(track, ['aac'])).toBe(true);
    expect(isDeviceCompatible(track, ['mp3'])).toBe(false);
  });

  it('handles m4a files with ALAC codec', () => {
    const track = createCollectionTrack('A', 'B', 'C', 'm4a', { codec: 'alac' });
    expect(isDeviceCompatible(track, ['alac'])).toBe(true);
    expect(isDeviceCompatible(track, ['aac'])).toBe(false);
  });
});

// =============================================================================
// Size Estimation Tests
// =============================================================================

describe('estimateTranscodedSize', () => {
  it('estimates size correctly for 3-minute track at 256 kbps', () => {
    // 180 seconds * 256000 bits/sec / 8 = 5,760,000 bytes + ~2KB overhead
    const size = estimateTranscodedSize(180000, 256);
    expect(size).toBeGreaterThan(5760000);
    expect(size).toBeLessThan(5770000); // small overhead
  });

  it('estimates size correctly for 4-minute track at 192 kbps', () => {
    // 240 seconds * 192000 bits/sec / 8 = 5,760,000 bytes + ~2KB overhead
    const size = estimateTranscodedSize(240000, 192);
    expect(size).toBeGreaterThan(5760000);
    expect(size).toBeLessThan(5770000);
  });

  it('estimates size correctly for 5-minute track at 128 kbps', () => {
    // 300 seconds * 128000 bits/sec / 8 = 4,800,000 bytes + ~2KB overhead
    const size = estimateTranscodedSize(300000, 128);
    expect(size).toBeGreaterThan(4800000);
    expect(size).toBeLessThan(4810000);
  });

  it('handles very short tracks', () => {
    // 10 seconds at 256 kbps = 320,000 bytes + overhead
    const size = estimateTranscodedSize(10000, 256);
    expect(size).toBeGreaterThan(320000);
    expect(size).toBeLessThan(325000);
  });

  it('handles very long tracks', () => {
    // 1 hour at 256 kbps = 115,200,000 bytes + overhead
    const size = estimateTranscodedSize(3600000, 256);
    expect(size).toBeGreaterThan(115200000);
    expect(size).toBeLessThan(115210000);
  });

  it('returns positive value even for zero duration', () => {
    // Should return just the container overhead
    const size = estimateTranscodedSize(0, 256);
    expect(size).toBeGreaterThan(0);
  });
});

describe('estimateCopySize', () => {
  it('estimates MP3 copy size based on duration', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      duration: 180000,
    });
    const size = estimateCopySize(track);
    // 180 seconds at ~256 kbps
    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('estimates M4A copy size based on duration', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'm4a', {
      duration: 180000,
    });
    const size = estimateCopySize(track);
    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('estimates ALAC with higher bitrate assumption', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'alac', {
      duration: 180000,
    });
    const size = estimateCopySize(track);
    // ALAC at ~900 kbps should be larger
    expect(size).toBeGreaterThan(20000000);
  });

  it('uses fallback for tracks without duration', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      duration: undefined,
    });
    const size = estimateCopySize(track);
    // Should use default 4-minute duration
    expect(size).toBeGreaterThan(0);
  });

  it('uses fallback for tracks with zero duration', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      duration: 0,
    });
    const size = estimateCopySize(track);
    // Should use default 4-minute duration
    expect(size).toBeGreaterThan(0);
  });
});

// =============================================================================
// calculateMusicOperationSize Tests
// =============================================================================

describe('calculateMusicOperationSize', () => {
  it('calculates size for transcode operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      duration: 180000,
    });
    const op: SyncOperation = {
      type: 'add-transcode',
      source: track,
      preset: { name: 'high' },
    };

    const size = calculateMusicOperationSize(op);

    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('calculates size for copy operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      duration: 180000,
    });
    const op: SyncOperation = {
      type: 'add-direct-copy',
      source: track,
    };

    const size = calculateMusicOperationSize(op);

    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('returns 0 for remove operation', () => {
    const op: SyncOperation = {
      type: 'remove',
      track: createDeviceTrack('Artist', 'Song', 'Album'),
    };

    const size = calculateMusicOperationSize(op);

    expect(size).toBe(0);
  });

  it('returns 0 for update-metadata operation', () => {
    const op: SyncOperation = {
      type: 'update-metadata',
      track: createDeviceTrack('Artist', 'Song', 'Album'),
      metadata: { genre: 'Rock' },
    };

    const size = calculateMusicOperationSize(op);

    expect(size).toBe(0);
  });

  it('uses different bitrates for different presets', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      duration: 180000,
    });

    const highSize = calculateMusicOperationSize({
      type: 'add-transcode',
      source: track,
      preset: { name: 'high' }, // 256 kbps
    });

    const lowSize = calculateMusicOperationSize({
      type: 'add-transcode',
      source: track,
      preset: { name: 'low' }, // 128 kbps
    });

    // High should be roughly twice as large as low
    expect(highSize).toBeGreaterThan(lowSize * 1.8);
    expect(highSize).toBeLessThan(lowSize * 2.2);
  });

  it('uses bitrateOverride when present', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      duration: 180000,
    });

    const overriddenSize = calculateMusicOperationSize({
      type: 'add-transcode',
      source: track,
      preset: { name: 'high', bitrateOverride: 128 },
    });

    const lowSize = calculateMusicOperationSize({
      type: 'add-transcode',
      source: track,
      preset: { name: 'low' }, // also 128 kbps
    });

    // Should be approximately the same
    expect(overriddenSize).toBe(lowSize);
  });
});
