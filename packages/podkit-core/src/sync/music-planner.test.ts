/**
 * Unit tests for the sync planner
 *
 * These tests verify the planning logic that converts a UnifiedSyncDiff into
 * an executable SyncPlan with ordered operations.
 *
 * ## Test Coverage
 *
 * 1. Format detection (copy vs transcode decisions)
 * 2. Size estimation for transcoded and copied files
 * 3. Time estimation for operations
 * 4. Operation ordering (removes first, then copies, then transcodes)
 * 5. Space checking and plan validation
 * 6. Mixed scenarios with various file types
 * 7. Edge cases (empty diff, no duration, etc.)
 * 8. `max` preset: ALAC on capable devices, high on non-capable
 * 9. Incompatible lossy bitrate capping
 * 10. Custom bitrate and encoding mode overrides
 */

import { describe, expect, it } from 'bun:test';
import {
  calculateMusicOperationSize,
  categorizeSource,
  createMusicPlan,
  estimateCopySize,
  estimateTranscodedSize,
  fileTypeToAudioCodec,
  getMusicPlanSummary,
  isDeviceCompatible,
  isIPodCompatible,
  isLosslessSource,
  requiresTranscoding,
  willMusicFitInSpace,
  willWarnLossyToLossy,
} from './music-planner.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { AudioFileType } from '../types.js';
import { parseSyncTag } from './sync-tags.js';
import type { DeviceTrack, IPodTrack, SyncOperation } from './types.js';
import type { UnifiedSyncDiff } from './content-type.js';

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

// Counter for generating unique file paths in tests
let ipodTrackPathCounter = 0;

/**
 * Create a minimal DeviceTrack for testing.
 * Each track gets a unique filePath which serves as its identifier.
 */
function createIPodTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<
    Omit<
      DeviceTrack,
      'update' | 'remove' | 'copyFile' | 'setArtwork' | 'setArtworkFromData' | 'removeArtwork'
    >
  > = {}
): DeviceTrack {
  // Generate unique filePath if not provided
  const uniquePath =
    options.filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
  const track: IPodTrack = {
    artist,
    title,
    album,
    duration: options.duration ?? 180000,
    bitrate: options.bitrate ?? 256,
    sampleRate: options.sampleRate ?? 44100,
    size: options.size ?? 5000000,
    mediaType: options.mediaType ?? 1, // Audio
    filePath: uniquePath,
    timeAdded: options.timeAdded ?? Math.floor(Date.now() / 1000),
    timeModified: options.timeModified ?? Math.floor(Date.now() / 1000),
    timePlayed: options.timePlayed ?? 0,
    timeReleased: options.timeReleased ?? 0,
    playCount: options.playCount ?? 0,
    skipCount: options.skipCount ?? 0,
    rating: options.rating ?? 0,
    hasArtwork: options.hasArtwork ?? false,
    hasFile: options.hasFile ?? true,
    compilation: options.compilation ?? false,
    // Optional fields
    albumArtist: options.albumArtist,
    genre: options.genre,
    composer: options.composer,
    comment: options.comment,
    syncTag: options.comment ? parseSyncTag(options.comment) : null,
    grouping: options.grouping,
    trackNumber: options.trackNumber,
    totalTracks: options.totalTracks,
    discNumber: options.discNumber,
    totalDiscs: options.totalDiscs,
    year: options.year,
    bpm: options.bpm,
    filetype: options.filetype,
    // Methods (stubs for testing)
    update: () => track,
    remove: () => {},
    copyFile: () => track,
    setArtwork: () => track,
    setArtworkFromData: () => track,
    removeArtwork: () => track,
  };
  return track;
}

/**
 * Create an empty UnifiedSyncDiff for testing
 */
function createEmptyDiff(): UnifiedSyncDiff<CollectionTrack, DeviceTrack> {
  return {
    toAdd: [],
    toRemove: [],
    existing: [],
    toUpdate: [],
  };
}

// =============================================================================
// Format Detection Tests
// =============================================================================

describe('isIPodCompatible', () => {
  it('returns true for MP3 files', () => {
    expect(isIPodCompatible('mp3')).toBe(true);
  });

  it('returns true for M4A files', () => {
    expect(isIPodCompatible('m4a')).toBe(true);
  });

  it('returns true for AAC files', () => {
    expect(isIPodCompatible('aac')).toBe(true);
  });

  it('returns true for ALAC files', () => {
    expect(isIPodCompatible('alac')).toBe(true);
  });

  it('returns false for FLAC files', () => {
    expect(isIPodCompatible('flac')).toBe(false);
  });

  it('returns false for OGG files', () => {
    expect(isIPodCompatible('ogg')).toBe(false);
  });

  it('returns false for OPUS files', () => {
    expect(isIPodCompatible('opus')).toBe(false);
  });

  it('returns false for WAV files', () => {
    expect(isIPodCompatible('wav')).toBe(false);
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
// Operation Planning Tests
// =============================================================================

describe('createMusicPlan - operation types', () => {
  it('creates transcode operation for FLAC files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('creates transcode operation for OGG files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'ogg')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('creates transcode operation for OPUS files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'opus')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('creates transcode operation for WAV files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'wav')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('creates copy operation for MP3 files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('creates copy operation for M4A files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'm4a')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('creates copy operation for AAC files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'aac')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('creates optimized-copy for MP3 when transferMode is optimized', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, { transferMode: 'optimized' });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('creates direct-copy for MP3 when transferMode is fast', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, { transferMode: 'fast' });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('creates direct-copy for MP3 when transferMode is portable', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, { transferMode: 'portable' });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('creates optimized-copy for ALAC→ALAC when transferMode is optimized', () => {
    const alacTrack = createCollectionTrack('Artist', 'Song', 'Album', 'alac');
    alacTrack.codec = 'alac';

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [alacTrack],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
      transferMode: 'optimized',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('creates direct-copy for ALAC→ALAC when transferMode is fast', () => {
    const alacTrack = createCollectionTrack('Artist', 'Song', 'Album', 'alac');
    alacTrack.codec = 'alac';

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [alacTrack],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
      transferMode: 'fast',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('transcodes ALAC files to AAC by default (for space efficiency)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'alac')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('includes preset in transcode operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset).toBeDefined();
      expect(plan.operations[0]!.preset.name).toBe('high'); // default
    }
  });

  it('uses custom preset when provided', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'low' } });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('low');
    }
  });
});

// =============================================================================
// Embedded Artwork Device Tests
// =============================================================================

describe('createMusicPlan - embedded artwork devices', () => {
  const embeddedCapabilities = {
    artworkSources: ['embedded' as const],
    artworkMaxResolution: 600,
    supportedAudioCodecs: ['aac' as const, 'mp3' as const, 'flac' as const],
    supportsVideo: false,
  };

  it('routes MP3 through optimized-copy for embedded-artwork device (fast mode)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: embeddedCapabilities,
      transferMode: 'fast',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('routes MP3 through optimized-copy for embedded-artwork device (portable mode)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: embeddedCapabilities,
      transferMode: 'portable',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('routes AAC through optimized-copy for embedded-artwork device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'm4a')],
    };

    const plan = createMusicPlan(diff, { capabilities: embeddedCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('copies FLAC as-is when device supports FLAC natively', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, { capabilities: embeddedCapabilities });

    expect(plan.operations).toHaveLength(1);
    // Device supports FLAC natively — copy via optimized-copy (embedded artwork resize)
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('transcodes FLAC when device does not support FLAC', () => {
    const noFlacCapabilities = {
      artworkSources: ['embedded' as const],
      artworkMaxResolution: 600,
      supportedAudioCodecs: ['aac' as const, 'mp3' as const],
      supportsVideo: false,
    };
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, { capabilities: noFlacCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('produces embedded-artwork-resize warning in portable mode', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: embeddedCapabilities,
      transferMode: 'portable',
    });

    const artworkWarning = plan.warnings.find((w) => w.type === 'embedded-artwork-resize');
    expect(artworkWarning).toBeDefined();
    expect(artworkWarning!.message).toContain('600px');
  });

  it('does not produce embedded-artwork-resize warning in fast mode', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: embeddedCapabilities,
      transferMode: 'fast',
    });

    const artworkWarning = plan.warnings.find((w) => w.type === 'embedded-artwork-resize');
    expect(artworkWarning).toBeUndefined();
  });

  it('database-artwork device still uses direct-copy in fast mode', () => {
    const databaseCapabilities = {
      artworkSources: ['database' as const],
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['aac' as const, 'mp3' as const],
      supportsVideo: true,
    };

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: databaseCapabilities,
      transferMode: 'fast',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });
});

// =============================================================================
// Device Codec Compatibility Tests
// =============================================================================

describe('createMusicPlan - device codec compatibility', () => {
  // Echo Mini-like device: supports FLAC, OGG, WAV, etc. natively
  const echoMiniCapabilities = {
    artworkSources: ['embedded' as const],
    artworkMaxResolution: 600,
    supportedAudioCodecs: [
      'aac' as const,
      'alac' as const,
      'mp3' as const,
      'flac' as const,
      'ogg' as const,
      'wav' as const,
    ],
    supportsVideo: false,
  };

  it('copies FLAC as-is when device supports FLAC natively', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, { capabilities: echoMiniCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('copies OGG as-is when device supports OGG natively (no lossy-to-lossy warning)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'ogg')],
    };

    const plan = createMusicPlan(diff, { capabilities: echoMiniCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
    expect(plan.warnings).toHaveLength(0);
  });

  it('copies WAV as-is when device supports WAV natively', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'wav')],
    };

    const plan = createMusicPlan(diff, { capabilities: echoMiniCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-optimized-copy');
  });

  it('transcodes Opus when device does not support Opus', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'opus')],
    };

    // echoMiniCapabilities does not include 'opus'
    const plan = createMusicPlan(diff, { capabilities: echoMiniCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('uses direct-copy for FLAC on database-artwork device that supports FLAC', () => {
    const databaseFlacCapabilities = {
      artworkSources: ['database' as const],
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['aac' as const, 'mp3' as const, 'flac' as const],
      supportsVideo: false,
    };

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      capabilities: databaseFlacCapabilities,
      transferMode: 'fast',
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('still transcodes FLAC for iPod (no FLAC in supportedAudioCodecs)', () => {
    const ipodCapabilities = {
      artworkSources: ['database' as const],
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['aac' as const, 'mp3' as const],
      supportsVideo: true,
    };

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, { capabilities: ipodCapabilities });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });

  it('copies FLAC for upgrade when device supports FLAC', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          device: createIPodTrack('Artist', 'Song', 'Album'),
          reasons: ['format-upgrade'],
          changes: [{ field: 'fileType', from: 'mp3', to: 'flac' }],
        },
      ],
    };

    const plan = createMusicPlan(diff, { capabilities: echoMiniCapabilities });

    expect(plan.operations).toHaveLength(1);
    // Should be a copy upgrade, not transcode upgrade
    expect(plan.operations[0]!.type).toBe('upgrade-optimized-copy');
  });

  it('falls back to iPod-compatible format check when no capabilities provided', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    // No capabilities = legacy iPod behavior, FLAC must be transcoded
    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
  });
});

// =============================================================================
// Remove Operations Tests
// =============================================================================

describe('createMusicPlan - remove operations', () => {
  it('does not create remove operations by default', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(0);
  });

  it('creates remove operations when removeOrphans is true', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('remove');
  });

  it('creates remove operations for multiple tracks', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [
        createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
        createIPodTrack('Artist 2', 'Song 2', 'Album 2'),
        createIPodTrack('Artist 3', 'Song 3', 'Album 3'),
      ],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(3);
    expect(plan.operations.every((op) => op.type === 'remove')).toBe(true);
  });

  it('includes iPod track reference in remove operation', () => {
    const ipodTrack = createIPodTrack('Artist', 'Song', 'Album', {
      filePath: ':iPod_Control:Music:F00:0123.m4a',
    });
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [ipodTrack],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations[0]!.type).toBe('remove');
    if (plan.operations[0]!.type === 'remove') {
      expect(plan.operations[0]!.track.filePath).toBe(':iPod_Control:Music:F00:0123.m4a');
    }
  });
});

// =============================================================================
// Operation Ordering Tests
// =============================================================================

describe('createMusicPlan - operation ordering', () => {
  it('orders removes before copies', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New Song', 'Album', 'mp3')],
      toRemove: [createIPodTrack('Artist', 'Old Song', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('add-direct-copy');
  });

  it('orders removes before transcodes', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New Song', 'Album', 'flac')],
      toRemove: [createIPodTrack('Artist', 'Old Song', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('add-transcode');
  });

  it('orders copies before transcodes', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC Song', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3 Song', 'Album', 'mp3'),
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
    expect(plan.operations[1]!.type).toBe('add-transcode');
  });

  it('maintains full ordering: removes -> copies -> transcodes', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC 1', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3 1', 'Album', 'mp3'),
        createCollectionTrack('Artist', 'FLAC 2', 'Album', 'flac'),
        createCollectionTrack('Artist', 'M4A 1', 'Album', 'm4a'),
      ],
      toRemove: [
        createIPodTrack('Artist', 'Old 1', 'Album'),
        createIPodTrack('Artist', 'Old 2', 'Album'),
      ],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(6);

    // First two should be removes
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('remove');

    // Next two should be copies
    expect(plan.operations[2]!.type).toBe('add-direct-copy');
    expect(plan.operations[3]!.type).toBe('add-direct-copy');

    // Last two should be transcodes
    expect(plan.operations[4]!.type).toBe('add-transcode');
    expect(plan.operations[5]!.type).toBe('add-transcode');
  });
});

// =============================================================================
// Size and Time Calculation Tests
// =============================================================================

describe('createMusicPlan - size calculation', () => {
  it('calculates total size for transcode operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // 3 minutes at 256 kbps (high preset default) = ~5.76 MB
    expect(plan.estimatedSize).toBeGreaterThan(5000000);
    expect(plan.estimatedSize).toBeLessThan(6000000);
  });

  it('calculates total size for copy operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.estimatedSize).toBeGreaterThan(5000000);
    expect(plan.estimatedSize).toBeLessThan(6000000);
  });

  it('sums sizes for multiple operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song 1', 'Album', 'flac', {
          duration: 180000,
        }),
        createCollectionTrack('Artist', 'Song 2', 'Album', 'mp3', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // Two 3-minute tracks should be ~11.5 MB total
    expect(plan.estimatedSize).toBeGreaterThan(10000000);
    expect(plan.estimatedSize).toBeLessThan(12000000);
  });

  it('does not count remove operations in size', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [
        createIPodTrack('Artist', 'Song 1', 'Album'),
        createIPodTrack('Artist', 'Song 2', 'Album'),
      ],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.estimatedSize).toBe(0);
  });
});

describe('createMusicPlan - time calculation', () => {
  it('estimates time for transcode operations based on transfer speed', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000, // 3 minutes
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // 3 minutes at 256kbps AAC = ~5.6 MB, transfer at 2.5 MB/s = ~2.2 seconds
    expect(plan.estimatedTime).toBeGreaterThan(1);
    expect(plan.estimatedTime).toBeLessThan(5);
  });

  it('estimates time for copy operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // Copy time based on size / speed
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('includes small time for remove operations', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    // Remove is nearly instant
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeLessThan(1);
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
      track: createIPodTrack('Artist', 'Song', 'Album'),
    };

    const size = calculateMusicOperationSize(op);

    expect(size).toBe(0);
  });

  it('returns 0 for update-metadata operation', () => {
    const op: SyncOperation = {
      type: 'update-metadata',
      track: createIPodTrack('Artist', 'Song', 'Album'),
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

// =============================================================================
// Space Checking Tests
// =============================================================================

describe('willMusicFitInSpace', () => {
  it('returns true when plan fits in available space', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);
    const availableSpace = 100 * 1024 * 1024; // 100 MB

    expect(willMusicFitInSpace(plan, availableSpace)).toBe(true);
  });

  it('returns false when plan exceeds available space', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);
    const availableSpace = 1024; // 1 KB (too small)

    expect(willMusicFitInSpace(plan, availableSpace)).toBe(false);
  });

  it('returns true when plan has zero size (only removes)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(willMusicFitInSpace(plan, 0)).toBe(true);
  });

  it('handles exact fit scenario', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // Exact match
    expect(willMusicFitInSpace(plan, plan.estimatedSize)).toBe(true);
  });
});

// =============================================================================
// Plan Summary Tests
// =============================================================================

describe('getMusicPlanSummary', () => {
  it('counts operations by type', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC 1', 'Album', 'flac'),
        createCollectionTrack('Artist', 'FLAC 2', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3 1', 'Album', 'mp3'),
      ],
      toRemove: [createIPodTrack('Artist', 'Old', 'Album')],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });
    const summary = getMusicPlanSummary(plan);

    expect(summary.addTranscodeCount).toBe(2);
    expect(summary.addDirectCopyCount + summary.addOptimizedCopyCount).toBe(1);
    expect(summary.removeCount).toBe(1);
    expect(summary.updateCount).toBe(0);
  });

  it('returns zeros for empty plan', () => {
    const plan = createMusicPlan(createEmptyDiff());
    const summary = getMusicPlanSummary(plan);

    expect(summary.addTranscodeCount).toBe(0);
    expect(summary.addDirectCopyCount + summary.addOptimizedCopyCount).toBe(0);
    expect(summary.removeCount).toBe(0);
    expect(summary.updateCount).toBe(0);
  });
});

// =============================================================================
// Empty and Edge Case Tests
// =============================================================================

describe('createMusicPlan - empty scenarios', () => {
  it('handles empty diff', () => {
    const plan = createMusicPlan(createEmptyDiff());

    expect(plan.operations).toHaveLength(0);
    expect(plan.estimatedSize).toBe(0);
    expect(plan.estimatedTime).toBe(0);
  });

  it('handles diff with only existing matches', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      existing: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
          device: createIPodTrack('Artist', 'Song', 'Album'),
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(0);
  });

  it('handles diff with nothing to do', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = createEmptyDiff();

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(0);
  });
});

describe('createMusicPlan - tracks without duration', () => {
  it('uses default duration for transcode size estimation', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: undefined,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    // Should still produce valid size estimate (uses 4-minute default)
    expect(plan.estimatedSize).toBeGreaterThan(0);
  });

  it('uses default duration for copy size estimation', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: undefined,
        }),
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.estimatedSize).toBeGreaterThan(0);
  });
});

// =============================================================================
// Mixed Scenario Tests
// =============================================================================

describe('createMusicPlan - mixed scenarios', () => {
  it('handles realistic mixed format collection', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        // Transcodes
        createCollectionTrack('Artist 1', 'Song 1', 'Album', 'flac', {
          duration: 180000,
        }),
        createCollectionTrack('Artist 2', 'Song 2', 'Album', 'ogg', {
          duration: 240000,
        }),
        createCollectionTrack('Artist 3', 'Song 3', 'Album', 'opus', {
          duration: 200000,
        }),
        // Copies
        createCollectionTrack('Artist 4', 'Song 4', 'Album', 'mp3', {
          duration: 210000,
        }),
        createCollectionTrack('Artist 5', 'Song 5', 'Album', 'm4a', {
          duration: 190000,
        }),
        createCollectionTrack('Artist 6', 'Song 6', 'Album', 'aac', {
          duration: 220000,
        }),
      ],
      toRemove: [
        createIPodTrack('Old Artist 1', 'Old Song 1', 'Old Album'),
        createIPodTrack('Old Artist 2', 'Old Song 2', 'Old Album'),
      ],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });
    const summary = getMusicPlanSummary(plan);

    expect(summary.addTranscodeCount).toBe(3);
    expect(summary.addDirectCopyCount + summary.addOptimizedCopyCount).toBe(3);
    expect(summary.removeCount).toBe(2);
    expect(plan.operations).toHaveLength(8);

    // Verify ordering
    const types = plan.operations.map((op) => op.type);
    const firstRemove = types.indexOf('remove');
    const firstCopy = types.indexOf('add-direct-copy');
    const firstTranscode = types.indexOf('add-transcode');

    expect(firstRemove).toBeLessThan(firstCopy);
    expect(firstCopy).toBeLessThan(firstTranscode);
  });

  it('handles large collection efficiently', () => {
    const toAdd: CollectionTrack[] = [];
    for (let i = 0; i < 1000; i++) {
      const fileType: AudioFileType = i % 2 === 0 ? 'flac' : 'mp3';
      toAdd.push(
        createCollectionTrack(`Artist ${i}`, `Song ${i}`, `Album ${i % 10}`, fileType, {
          duration: 180000 + (i % 60) * 1000,
        })
      );
    }

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd,
    };

    const startTime = performance.now();
    const plan = createMusicPlan(diff);
    const endTime = performance.now();

    expect(plan.operations).toHaveLength(1000);
    expect(endTime - startTime).toBeLessThan(100); // Should be fast
  });
});

// =============================================================================
// Source Track Reference Tests
// =============================================================================

describe('createMusicPlan - source track references', () => {
  it('preserves source track in transcode operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      id: 'test-id-123',
      filePath: '/music/test.flac',
    });

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.source.id).toBe('test-id-123');
      expect(plan.operations[0]!.source.filePath).toBe('/music/test.flac');
    }
  });

  it('preserves source track in copy operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      id: 'test-id-456',
      filePath: '/music/test.mp3',
    });

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations[0]!.type).toBe('add-direct-copy');
    if (plan.operations[0]!.type === 'add-direct-copy') {
      expect(plan.operations[0]!.source.id).toBe('test-id-456');
      expect(plan.operations[0]!.source.filePath).toBe('/music/test.mp3');
    }
  });

  it('preserves iPod track reference in remove operation', () => {
    const ipodTrack = createIPodTrack('Artist', 'Song', 'Album', {
      filePath: ':iPod_Control:Music:F00:test.m4a',
    });

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toRemove: [ipodTrack],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });

    expect(plan.operations[0]!.type).toBe('remove');
    if (plan.operations[0]!.type === 'remove') {
      expect(plan.operations[0]!.track.filePath).toBe(':iPod_Control:Music:F00:test.m4a');
    }
  });
});

// =============================================================================
// Lossy-to-Lossy Warning Tests
// =============================================================================

describe('createMusicPlan - lossy-to-lossy warnings', () => {
  it('generates warning for OGG files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'ogg')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(1);
    expect(plan.warnings[0]!.message).toContain('1 track');
    expect(plan.warnings[0]!.message).toContain('lossy-to-lossy');
  });

  it('generates warning for Opus files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'opus')],
    };

    const plan = createMusicPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(1);
  });

  it('generates warning for multiple OGG/Opus files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song 1', 'Album', 'ogg'),
        createCollectionTrack('Artist', 'Song 2', 'Album', 'opus'),
        createCollectionTrack('Artist', 'Song 3', 'Album', 'ogg'),
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(3);
    expect(plan.warnings[0]!.message).toContain('3 tracks');
  });

  it('does not generate warning for lossless files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff);
    expect(plan.warnings).toHaveLength(0);
  });

  it('does not generate warning for compatible lossy files', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'MP3', 'Album', 'mp3'),
        createCollectionTrack('Artist', 'M4A', 'Album', 'm4a'),
      ],
    };

    const plan = createMusicPlan(diff);
    expect(plan.warnings).toHaveLength(0);
  });
});

// =============================================================================
// Max Preset Tests (ADR-010)
// =============================================================================

describe('createMusicPlan - max preset', () => {
  it('resolves max to ALAC for lossless source on ALAC-capable device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('lossless');
    }
  });

  it('copies ALAC source with max preset on ALAC-capable device', () => {
    const track = createCollectionTrack('Artist', 'ALAC', 'Album', 'alac');
    track.codec = 'alac';

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('resolves max to high for lossless source on non-ALAC device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: false,
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('high');
    }
  });

  it('resolves max to high for lossless source when deviceSupportsAlac not set', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    // deviceSupportsAlac defaults to false
    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
    });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('high');
    }
  });

  it('copies compatible lossy with max preset regardless of ALAC support', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'MP3', 'Album', 'mp3')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    expect(plan.operations[0]!.type).toBe('add-direct-copy');
  });

  it('transcodes FLAC to ALAC with max on ALAC-capable device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('lossless');
    }
  });

  it('transcodes FLAC to AAC at high quality with max on non-ALAC device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: false,
    });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.name).toBe('high');
    }
  });

  it('handles mixed collection with max + ALAC device correctly', () => {
    const alacTrack = createCollectionTrack('Artist', 'Existing ALAC', 'Album', 'm4a', {
      codec: 'alac',
    });

    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC', 'Album', 'flac'),
        createCollectionTrack('Artist', 'WAV', 'Album', 'wav'),
        alacTrack,
        createCollectionTrack('Artist', 'MP3', 'Album', 'mp3'),
        createCollectionTrack('Artist', 'OGG', 'Album', 'ogg'),
      ],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });
    const summary = getMusicPlanSummary(plan);

    // FLAC, WAV -> transcode to ALAC (2 transcodes)
    // OGG -> transcode to AAC at high (1 transcode)
    // Existing ALAC -> copy (1 copy)
    // MP3 -> copy (1 copy)
    expect(summary.addTranscodeCount).toBe(3);
    expect(summary.addDirectCopyCount + summary.addOptimizedCopyCount).toBe(2);

    // Verify presets
    const transcodeOps = plan.operations.filter((op) => op.type === 'add-transcode');
    const presets = transcodeOps.map((op) => (op.type === 'add-transcode' ? op.preset.name : ''));

    // Should have 2 lossless (FLAC, WAV) and 1 high (OGG)
    expect(presets.filter((p) => p === 'lossless')).toHaveLength(2);
    expect(presets.filter((p) => p === 'high')).toHaveLength(1);
  });
});

// =============================================================================
// Incompatible Lossy Bitrate Capping Tests (ADR-010)
// =============================================================================

describe('createMusicPlan - incompatible lossy bitrate capping', () => {
  it('caps OGG at source bitrate when lower than preset', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'OGG Song', 'Album', 'ogg', {
          bitrate: 128,
        }),
      ],
    };

    // high preset target is 256 kbps, but source is only 128 kbps
    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(128);
    }
  });

  it('uses preset bitrate when source bitrate is higher', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'OGG Song', 'Album', 'ogg', {
          bitrate: 320,
        }),
      ],
    };

    // low preset target is 128 kbps, source is 320 kbps → use preset (128)
    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'low' } });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(128);
    }
  });

  it('uses preset bitrate when source bitrate is unknown', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'OGG Song', 'Album', 'ogg', {
          bitrate: undefined,
        }),
      ],
    };

    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      // bitrateOverride should be preset bitrate (256) since source is unknown
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(256);
    }
  });

  it('caps OGG at source bitrate with max preset (not at 256)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'OGG Song', 'Album', 'ogg', {
          bitrate: 128,
        }),
      ],
    };

    // max resolves to high (256 kbps) for incompatible lossy, but source is only 128 → cap at 128
    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(128);
    }
  });

  it('caps Opus at source bitrate with medium preset', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Opus Song', 'Album', 'opus', {
          bitrate: 96,
        }),
      ],
    };

    // medium preset target is 192 kbps, source is 96 kbps → cap at 96
    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'medium' } });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(96);
    }
  });
});

// =============================================================================
// Custom Bitrate Override Tests (ADR-010)
// =============================================================================

describe('createMusicPlan - custom bitrate', () => {
  it('passes custom bitrate through for lossless sources', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'high', customBitrate: 200 },
    });

    expect(plan.operations[0]!.type).toBe('add-transcode');
    if (plan.operations[0]!.type === 'add-transcode') {
      expect(plan.operations[0]!.preset.bitrateOverride).toBe(200);
    }
  });

  it('uses custom bitrate for size estimation', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planDefault = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });
    const planCustom = createMusicPlan(diff, {
      transcodeConfig: { quality: 'high', customBitrate: 128 },
    });

    // Custom 128 should be about half the size of default 256
    expect(planCustom.estimatedSize).toBeLessThan(planDefault.estimatedSize * 0.6);
  });
});

// =============================================================================
// Quality Preset Tests
// =============================================================================

describe('createMusicPlan - quality presets', () => {
  const presets = ['max', 'high', 'medium', 'low'] as const;

  for (const preset of presets) {
    it(`uses ${preset} preset when configured`, () => {
      const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
        ...createEmptyDiff(),
        toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
      };

      const plan = createMusicPlan(diff, { transcodeConfig: { quality: preset } });

      expect(plan.operations[0]!.type).toBe('add-transcode');
      if (plan.operations[0]!.type === 'add-transcode') {
        // max resolves to 'high' when deviceSupportsAlac is false (default)
        const expectedPreset = preset === 'max' ? 'high' : preset;
        expect(plan.operations[0]!.preset.name).toBe(expectedPreset);
      }
    });
  }

  it('estimates larger size for high than low preset', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planHigh = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });
    const planLow = createMusicPlan(diff, { transcodeConfig: { quality: 'low' } });

    // High is 256 kbps, Low is 128 kbps
    expect(planHigh.estimatedSize).toBeGreaterThan(planLow.estimatedSize * 1.8);
  });

  it('estimates larger size for ALAC than AAC', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planAlac = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });
    const planHigh = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });

    // ALAC ~900 kbps vs AAC ~256 kbps
    expect(planAlac.estimatedSize).toBeGreaterThan(planHigh.estimatedSize * 3);
  });
});

// =============================================================================
// Update Operations Tests (Transforms)
// =============================================================================

describe('createMusicPlan - update operations', () => {
  it('creates update-metadata operations for toUpdate tracks', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
          device: createIPodTrack('Artist feat. B', 'Song', 'Album'),
          reasons: ['transform-apply'],
          changes: [
            { field: 'artist', from: 'Artist feat. B', to: 'Artist' },
            { field: 'title', from: 'Song', to: 'Song (feat. B)' },
          ],
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('update-metadata');
  });

  it('includes correct metadata in update-metadata operation', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song (feat. B)', 'Album', 'mp3'),
          device: createIPodTrack('Artist feat. B', 'Song', 'Album'),
          reasons: ['transform-apply'],
          changes: [
            { field: 'artist', from: 'Artist feat. B', to: 'Artist' },
            { field: 'title', from: 'Song', to: 'Song (feat. B)' },
          ],
        },
      ],
    };

    const plan = createMusicPlan(diff);
    const op = plan.operations[0];

    expect(op!.type).toBe('update-metadata');
    if (op!.type === 'update-metadata') {
      expect(op!.metadata.artist).toBe('Artist');
      expect(op!.metadata.title).toBe('Song (feat. B)');
    }
  });

  it('orders update operations after transcodes', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New Song', 'Album', 'flac')],
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Existing', 'Album', 'mp3'),
          device: createIPodTrack('Artist feat. B', 'Existing', 'Album'),
          reasons: ['transform-apply'],
          changes: [{ field: 'artist', from: 'Artist feat. B', to: 'Artist' }],
        },
      ],
    };

    const plan = createMusicPlan(diff);
    const types = plan.operations.map((op) => op.type);

    // Transcode comes before update-metadata
    expect(types.indexOf('add-transcode')).toBeLessThan(types.indexOf('update-metadata'));
  });

  it('does not count update operations in estimated size', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
          device: createIPodTrack('Artist feat. B', 'Song', 'Album'),
          reasons: ['transform-apply'],
          changes: [{ field: 'artist', from: 'Artist feat. B', to: 'Artist' }],
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.estimatedSize).toBe(0);
  });
});

// =============================================================================
// Sync Tag Write Tests
// =============================================================================

describe('createMusicPlan - sync-tag-write operations', () => {
  it('creates update-sync-tag operation for sync-tag-write reason', () => {
    const syncTag = { quality: 'high' as const, encoding: 'vbr' as const };
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          device: createIPodTrack('Artist', 'Song', 'Album'),
          reasons: ['sync-tag-write'],
          changes: [],
          syncTag,
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('update-sync-tag');
    const op = plan.operations[0] as Extract<SyncOperation, { type: 'update-sync-tag' }>;
    expect(op.syncTag).toEqual(syncTag);
    expect(op.track.artist).toBe('Artist');
    expect(op.track.title).toBe('Song');
  });

  it('falls through to update-metadata when syncTag is absent despite sync-tag-write reason', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          device: createIPodTrack('Artist', 'Song', 'Album'),
          reasons: ['sync-tag-write'],
          changes: [],
          // syncTag intentionally omitted
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('update-metadata');
  });

  it('does not count sync-tag-write operations in estimated size', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          device: createIPodTrack('Artist', 'Song', 'Album'),
          reasons: ['sync-tag-write'],
          changes: [],
          syncTag: { quality: 'high', encoding: 'vbr' },
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.estimatedSize).toBe(0);
  });
});

// =============================================================================
// Upgrade Operations Tests (Self-Healing Sync)
// =============================================================================

describe('createMusicPlan - upgrade operations', () => {
  it('creates upgrade operation for format-upgrade reason (lossless source)', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            duration: 200000,
            lossless: true,
          }),
          device: createIPodTrack('Artist', 'Song', 'Album', {
            filetype: 'MPEG audio file',
            bitrate: 192,
          }),
          reasons: ['format-upgrade'],
          changes: [
            { field: 'fileType', from: 'mp3', to: 'flac' },
            { field: 'lossless', from: 'false', to: 'true' },
          ],
        },
      ],
    };

    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });

    expect(plan.operations).toHaveLength(1);
    const op = plan.operations[0]!;
    expect(op.type).toBe('upgrade-transcode');
    if (op.type === 'upgrade-transcode') {
      expect(op.reason).toBe('format-upgrade');
      expect(op.preset).toBeDefined();
      expect(op.preset.name).toBe('high');
    }
  });

  it('creates upgrade operation for format-upgrade with max + ALAC device', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
          }),
          device: createIPodTrack('Artist', 'Song', 'Album', {
            filetype: 'MPEG audio file',
          }),
          reasons: ['format-upgrade'],
          changes: [{ field: 'fileType', from: 'mp3', to: 'flac' }],
        },
      ],
    };

    const plan = createMusicPlan(diff, {
      transcodeConfig: { quality: 'max' },
      deviceSupportsAlac: true,
    });

    const op = plan.operations[0]!;
    expect(op.type).toBe('upgrade-transcode');
    if (op.type === 'upgrade-transcode') {
      // FLAC to ALAC needs transcoding
      expect(op.preset).toBeDefined();
      expect(op.preset.name).toBe('lossless');
    }
  });

  it('creates upgrade operation without preset for compatible lossy source', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            bitrate: 320,
          }),
          device: createIPodTrack('Artist', 'Song', 'Album', {
            filetype: 'MPEG audio file',
            bitrate: 128,
          }),
          reasons: ['quality-upgrade'],
          changes: [{ field: 'bitrate', from: '128', to: '320' }],
        },
      ],
    };

    const plan = createMusicPlan(diff);

    const op = plan.operations[0]!;
    expect(op.type).toBe('upgrade-direct-copy');
    if (op.type === 'upgrade-direct-copy') {
      expect(op.reason).toBe('quality-upgrade');
    }
  });

  it('creates update-metadata operation for soundcheck-update reason', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            soundcheck: 1234,
          }),
          device: createIPodTrack('Artist', 'Song', 'Album'),
          reasons: ['soundcheck-update'],
          changes: [{ field: 'soundcheck', from: '', to: '1234' }],
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('update-metadata');
  });

  it('includes upgrade operations in size estimates', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            duration: 240000,
            lossless: true,
          }),
          device: createIPodTrack('Artist', 'Song', 'Album', {
            filetype: 'MPEG audio file',
          }),
          reasons: ['format-upgrade'],
          changes: [{ field: 'fileType', from: 'mp3', to: 'flac' }],
        },
      ],
    };

    const plan = createMusicPlan(diff, { transcodeConfig: { quality: 'high' } });

    expect(plan.estimatedSize).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('generates lossy-to-lossy warning for OGG upgrade source', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Song', 'Album', 'ogg'),
          device: createIPodTrack('Artist', 'Song', 'Album', {
            filetype: 'MPEG audio file',
          }),
          reasons: ['format-upgrade'],
          changes: [],
        },
      ],
    };

    const plan = createMusicPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
  });

  it('orders upgrade operations after removes and copies, before transcodes and updates', () => {
    const diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack> = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New', 'Album', 'flac')],
      toRemove: [createIPodTrack('Artist', 'Old', 'Album')],
      toUpdate: [
        {
          source: createCollectionTrack('Artist', 'Upgrade', 'Album', 'mp3', {
            bitrate: 320,
          }),
          device: createIPodTrack('Artist', 'Upgrade', 'Album', {
            filetype: 'MPEG audio file',
            bitrate: 128,
          }),
          reasons: ['quality-upgrade'],
          changes: [{ field: 'bitrate', from: '128', to: '320' }],
        },
        {
          source: createCollectionTrack('Artist', 'MetaUpdate', 'Album', 'mp3'),
          device: createIPodTrack('Artist', 'MetaUpdate', 'Album'),
          reasons: ['soundcheck-update'],
          changes: [{ field: 'soundcheck', from: '', to: '1234' }],
        },
      ],
    };

    const plan = createMusicPlan(diff, { removeOrphans: true });
    const types = plan.operations.map((op) => op.type);

    // Order: remove, upgrade (copy-like), transcode, update-metadata
    expect(types.indexOf('remove')).toBeLessThan(types.indexOf('upgrade-direct-copy'));
    expect(types.indexOf('upgrade-direct-copy')).toBeLessThan(types.indexOf('add-transcode'));
    expect(types.indexOf('add-transcode')).toBeLessThan(types.indexOf('update-metadata'));
  });
});
