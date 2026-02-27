/**
 * Unit tests for the sync planner
 *
 * These tests verify the planning logic that converts a SyncDiff into
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
 */

import { describe, expect, it } from 'bun:test';
import {
  calculateOperationSize,
  categorizeSource,
  createPlan,
  createPlanner,
  DefaultSyncPlanner,
  estimateCopySize,
  estimateTranscodedSize,
  getPlanSummary,
  isIPodCompatible,
  isLosslessSource,
  requiresTranscoding,
  willFitInSpace,
  willWarnLossyToLossy,
} from './planner.js';
import type { SourceCategory } from './types.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { AudioFileType } from '../types.js';
import type { IPodTrack, SyncDiff, SyncOperation } from './types.js';

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
 * Create a minimal IPodTrack for testing.
 * The new IPodTrack interface from ipod/types.js includes methods and more fields.
 * Each track gets a unique filePath which serves as its identifier.
 */
function createIPodTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<Omit<IPodTrack, 'update' | 'remove' | 'copyFile' | 'setArtwork' | 'setArtworkFromData' | 'removeArtwork'>> = {}
): IPodTrack {
  // Generate unique filePath if not provided
  const uniquePath = options.filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
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
 * Create an empty SyncDiff for testing
 */
function createEmptyDiff(): SyncDiff {
  return {
    toAdd: [],
    toRemove: [],
    existing: [],
    conflicts: [],
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

describe('createPlan - operation types', () => {
  it('creates transcode operation for FLAC files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
  });

  it('creates transcode operation for OGG files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'ogg')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
  });

  it('creates transcode operation for OPUS files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'opus')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
  });

  it('creates transcode operation for WAV files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'wav')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
  });

  it('creates copy operation for MP3 files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('creates copy operation for M4A files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'm4a')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('creates copy operation for AAC files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'aac')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('transcodes ALAC files to AAC by default (for space efficiency)', () => {
    // ALAC is lossless, so with default quality='high', it gets transcoded to AAC
    // This is intentional - ALAC takes more space, and most users want smaller files
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'alac')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
  });

  it('copies ALAC files when quality=alac and source is ALAC', () => {
    // When user wants lossless output and source is already ALAC, just copy it
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'alac');
    track.codec = 'alac'; // Mark as ALAC codec
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('includes preset in transcode operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createPlan(diff);

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset).toBeDefined();
      expect(plan.operations[0]!.preset.name).toBe('high'); // default
    }
  });

  it('uses custom preset when provided', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'low' } });

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset.name).toBe('low');
    }
  });
});

// =============================================================================
// Remove Operations Tests
// =============================================================================

describe('createPlan - remove operations', () => {
  it('does not create remove operations by default', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(0);
  });

  it('creates remove operations when removeOrphans is true', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('remove');
  });

  it('creates remove operations for multiple tracks', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [
        createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
        createIPodTrack('Artist 2', 'Song 2', 'Album 2'),
        createIPodTrack('Artist 3', 'Song 3', 'Album 3'),
      ],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(3);
    expect(plan.operations.every((op) => op.type === 'remove')).toBe(true);
  });

  it('includes iPod track reference in remove operation', () => {
    const ipodTrack = createIPodTrack('Artist', 'Song', 'Album', { filePath: ':iPod_Control:Music:F00:0123.m4a' });
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [ipodTrack],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations[0]!.type).toBe('remove');
    if (plan.operations[0]!.type === 'remove') {
      expect(plan.operations[0]!.track.filePath).toBe(':iPod_Control:Music:F00:0123.m4a');
    }
  });
});

// =============================================================================
// Operation Ordering Tests
// =============================================================================

describe('createPlan - operation ordering', () => {
  it('orders removes before copies', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New Song', 'Album', 'mp3')],
      toRemove: [createIPodTrack('Artist', 'Old Song', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('copy');
  });

  it('orders removes before transcodes', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'New Song', 'Album', 'flac')],
      toRemove: [createIPodTrack('Artist', 'Old Song', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('transcode');
  });

  it('orders copies before transcodes', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC Song', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3 Song', 'Album', 'mp3'),
      ],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.type).toBe('copy');
    expect(plan.operations[1]!.type).toBe('transcode');
  });

  it('maintains full ordering: removes -> copies -> transcodes', () => {
    const diff: SyncDiff = {
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

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations).toHaveLength(6);

    // First two should be removes
    expect(plan.operations[0]!.type).toBe('remove');
    expect(plan.operations[1]!.type).toBe('remove');

    // Next two should be copies
    expect(plan.operations[2]!.type).toBe('copy');
    expect(plan.operations[3]!.type).toBe('copy');

    // Last two should be transcodes
    expect(plan.operations[4]!.type).toBe('transcode');
    expect(plan.operations[5]!.type).toBe('transcode');
  });
});

// =============================================================================
// Size and Time Calculation Tests
// =============================================================================

describe('createPlan - size calculation', () => {
  it('calculates total size for transcode operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);

    // 3 minutes at 256 kbps (high preset default) = ~5.76 MB
    expect(plan.estimatedSize).toBeGreaterThan(5000000);
    expect(plan.estimatedSize).toBeLessThan(6000000);
  });

  it('calculates total size for copy operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);

    expect(plan.estimatedSize).toBeGreaterThan(5000000);
    expect(plan.estimatedSize).toBeLessThan(6000000);
  });

  it('sums sizes for multiple operations', () => {
    const diff: SyncDiff = {
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

    const plan = createPlan(diff);

    // Two 3-minute tracks should be ~11.5 MB total
    expect(plan.estimatedSize).toBeGreaterThan(10000000);
    expect(plan.estimatedSize).toBeLessThan(12000000);
  });

  it('does not count remove operations in size', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [
        createIPodTrack('Artist', 'Song 1', 'Album'),
        createIPodTrack('Artist', 'Song 2', 'Album'),
      ],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.estimatedSize).toBe(0);
  });
});

describe('createPlan - time calculation', () => {
  it('estimates time for transcode operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000, // 3 minutes
        }),
      ],
    };

    const plan = createPlan(diff);

    // 3 minutes at 10x realtime = 18 seconds
    expect(plan.estimatedTime).toBeGreaterThan(15);
    expect(plan.estimatedTime).toBeLessThan(25);
  });

  it('estimates time for copy operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);

    // Copy time based on size / speed
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  it('includes small time for remove operations', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    // Remove is nearly instant
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.estimatedTime).toBeLessThan(1);
  });
});

// =============================================================================
// calculateOperationSize Tests
// =============================================================================

describe('calculateOperationSize', () => {
  it('calculates size for transcode operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      duration: 180000,
    });
    const op: SyncOperation = {
      type: 'transcode',
      source: track,
      preset: { name: 'high' },
    };

    const size = calculateOperationSize(op);

    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('calculates size for copy operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      duration: 180000,
    });
    const op: SyncOperation = {
      type: 'copy',
      source: track,
    };

    const size = calculateOperationSize(op);

    expect(size).toBeGreaterThan(5000000);
    expect(size).toBeLessThan(6000000);
  });

  it('returns 0 for remove operation', () => {
    const op: SyncOperation = {
      type: 'remove',
      track: createIPodTrack('Artist', 'Song', 'Album'),
    };

    const size = calculateOperationSize(op);

    expect(size).toBe(0);
  });

  it('returns 0 for update-metadata operation', () => {
    const op: SyncOperation = {
      type: 'update-metadata',
      track: createIPodTrack('Artist', 'Song', 'Album'),
      metadata: { genre: 'Rock' },
    };

    const size = calculateOperationSize(op);

    expect(size).toBe(0);
  });

  it('uses different bitrates for different presets', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      duration: 180000,
    });

    const highSize = calculateOperationSize({
      type: 'transcode',
      source: track,
      preset: { name: 'high' }, // 256 kbps
    });

    const lowSize = calculateOperationSize({
      type: 'transcode',
      source: track,
      preset: { name: 'low' }, // 128 kbps
    });

    // High should be roughly twice as large as low
    expect(highSize).toBeGreaterThan(lowSize * 1.8);
    expect(highSize).toBeLessThan(lowSize * 2.2);
  });
});

// =============================================================================
// Space Checking Tests
// =============================================================================

describe('willFitInSpace', () => {
  it('returns true when plan fits in available space', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);
    const availableSpace = 100 * 1024 * 1024; // 100 MB

    expect(willFitInSpace(plan, availableSpace)).toBe(true);
  });

  it('returns false when plan exceeds available space', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);
    const availableSpace = 1024; // 1 KB (too small)

    expect(willFitInSpace(plan, availableSpace)).toBe(false);
  });

  it('returns true when plan has zero size (only removes)', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [createIPodTrack('Artist', 'Song', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(willFitInSpace(plan, 0)).toBe(true);
  });

  it('handles exact fit scenario', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const plan = createPlan(diff);

    // Exact match
    expect(willFitInSpace(plan, plan.estimatedSize)).toBe(true);
  });
});

// =============================================================================
// Plan Summary Tests
// =============================================================================

describe('getPlanSummary', () => {
  it('counts operations by type', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC 1', 'Album', 'flac'),
        createCollectionTrack('Artist', 'FLAC 2', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3 1', 'Album', 'mp3'),
      ],
      toRemove: [createIPodTrack('Artist', 'Old', 'Album')],
    };

    const plan = createPlan(diff, { removeOrphans: true });
    const summary = getPlanSummary(plan);

    expect(summary.transcodeCount).toBe(2);
    expect(summary.copyCount).toBe(1);
    expect(summary.removeCount).toBe(1);
    expect(summary.updateCount).toBe(0);
  });

  it('returns zeros for empty plan', () => {
    const plan = createPlan(createEmptyDiff());
    const summary = getPlanSummary(plan);

    expect(summary.transcodeCount).toBe(0);
    expect(summary.copyCount).toBe(0);
    expect(summary.removeCount).toBe(0);
    expect(summary.updateCount).toBe(0);
  });
});

// =============================================================================
// Empty and Edge Case Tests
// =============================================================================

describe('createPlan - empty scenarios', () => {
  it('handles empty diff', () => {
    const plan = createPlan(createEmptyDiff());

    expect(plan.operations).toHaveLength(0);
    expect(plan.estimatedSize).toBe(0);
    expect(plan.estimatedTime).toBe(0);
  });

  it('handles diff with only existing matches', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      existing: [
        {
          collection: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
          ipod: createIPodTrack('Artist', 'Song', 'Album'),
        },
      ],
    };

    const plan = createPlan(diff);

    expect(plan.operations).toHaveLength(0);
  });

  it('handles diff with only conflicts', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      conflicts: [
        {
          collection: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            genre: 'Rock',
          }),
          ipod: createIPodTrack('Artist', 'Song', 'Album', { genre: 'Pop' }),
          conflicts: ['genre'],
        },
      ],
    };

    const plan = createPlan(diff);

    // Conflicts are not automatically handled - they need explicit resolution
    expect(plan.operations).toHaveLength(0);
  });
});

describe('createPlan - tracks without duration', () => {
  it('uses default duration for transcode size estimation', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: undefined,
        }),
      ],
    };

    const plan = createPlan(diff);

    // Should still produce valid size estimate (uses 4-minute default)
    expect(plan.estimatedSize).toBeGreaterThan(0);
  });

  it('uses default duration for copy size estimation', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
          duration: undefined,
        }),
      ],
    };

    const plan = createPlan(diff);

    expect(plan.estimatedSize).toBeGreaterThan(0);
  });
});

// =============================================================================
// Mixed Scenario Tests
// =============================================================================

describe('createPlan - mixed scenarios', () => {
  it('handles realistic mixed format collection', () => {
    const diff: SyncDiff = {
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

    const plan = createPlan(diff, { removeOrphans: true });
    const summary = getPlanSummary(plan);

    expect(summary.transcodeCount).toBe(3);
    expect(summary.copyCount).toBe(3);
    expect(summary.removeCount).toBe(2);
    expect(plan.operations).toHaveLength(8);

    // Verify ordering
    const types = plan.operations.map((op) => op.type);
    const firstRemove = types.indexOf('remove');
    const firstCopy = types.indexOf('copy');
    const firstTranscode = types.indexOf('transcode');

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

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd,
    };

    const startTime = performance.now();
    const plan = createPlan(diff);
    const endTime = performance.now();

    expect(plan.operations).toHaveLength(1000);
    expect(endTime - startTime).toBeLessThan(100); // Should be fast
  });
});

// =============================================================================
// DefaultSyncPlanner Class Tests
// =============================================================================

describe('DefaultSyncPlanner', () => {
  it('implements SyncPlanner interface', () => {
    const planner = new DefaultSyncPlanner();

    expect(typeof planner.plan).toBe('function');
  });

  it('produces same results as createPlan', () => {
    const planner = new DefaultSyncPlanner();

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC', 'Album', 'flac'),
        createCollectionTrack('Artist', 'MP3', 'Album', 'mp3'),
      ],
      toRemove: [createIPodTrack('Artist', 'Old', 'Album')],
    };

    const options = { removeOrphans: true };
    const directPlan = createPlan(diff, options);
    const classPlan = planner.plan(diff, options);

    expect(classPlan.operations).toHaveLength(directPlan.operations.length);
    expect(classPlan.estimatedSize).toBe(directPlan.estimatedSize);
    expect(classPlan.estimatedTime).toBe(directPlan.estimatedTime);
  });

  it('handles options correctly', () => {
    const planner = new DefaultSyncPlanner();

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const planHigh = planner.plan(diff, { transcodeConfig: { quality: 'high' } });
    const planLow = planner.plan(diff, { transcodeConfig: { quality: 'low' } });

    // High preset should produce larger estimated size (256 vs 128 kbps target)
    expect(planHigh.estimatedSize).toBeGreaterThan(planLow.estimatedSize);
  });
});

// =============================================================================
// createPlanner Factory Tests
// =============================================================================

describe('createPlanner', () => {
  it('creates a SyncPlanner instance', () => {
    const planner = createPlanner();

    expect(planner).toBeInstanceOf(DefaultSyncPlanner);
    expect(typeof planner.plan).toBe('function');
  });

  it('creates functional planner instances', () => {
    const planner = createPlanner();

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = planner.plan(diff);

    expect(plan.operations).toHaveLength(1);
    expect(plan.estimatedSize).toBeGreaterThan(0);
  });
});

// =============================================================================
// Source Track Reference Tests
// =============================================================================

describe('createPlan - source track references', () => {
  it('preserves source track in transcode operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      id: 'test-id-123',
      filePath: '/music/test.flac',
    });

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createPlan(diff);

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.source.id).toBe('test-id-123');
      expect(plan.operations[0]!.source.filePath).toBe('/music/test.flac');
    }
  });

  it('preserves source track in copy operation', () => {
    const track = createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
      id: 'test-id-456',
      filePath: '/music/test.mp3',
    });

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createPlan(diff);

    expect(plan.operations[0]!.type).toBe('copy');
    if (plan.operations[0]!.type === 'copy') {
      expect(plan.operations[0]!.source.id).toBe('test-id-456');
      expect(plan.operations[0]!.source.filePath).toBe('/music/test.mp3');
    }
  });

  it('preserves iPod track reference in remove operation', () => {
    const ipodTrack = createIPodTrack('Artist', 'Song', 'Album', {
      filePath: ':iPod_Control:Music:F00:test.m4a',
    });

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toRemove: [ipodTrack],
    };

    const plan = createPlan(diff, { removeOrphans: true });

    expect(plan.operations[0]!.type).toBe('remove');
    if (plan.operations[0]!.type === 'remove') {
      expect(plan.operations[0]!.track.filePath).toBe(
        ':iPod_Control:Music:F00:test.m4a'
      );
    }
  });
});

// =============================================================================
// Lossy-to-Lossy Warning Tests
// =============================================================================

describe('createPlan - lossy-to-lossy warnings', () => {
  it('generates warning for OGG files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'ogg')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(1);
    expect(plan.warnings[0]!.message).toContain('1 track');
    expect(plan.warnings[0]!.message).toContain('lossy-to-lossy');
  });

  it('generates warning for Opus files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'opus')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(1);
  });

  it('generates warning for multiple OGG/Opus files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song 1', 'Album', 'ogg'),
        createCollectionTrack('Artist', 'Song 2', 'Album', 'opus'),
        createCollectionTrack('Artist', 'Song 3', 'Album', 'ogg'),
      ],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.type).toBe('lossy-to-lossy');
    expect(plan.warnings[0]!.tracks).toHaveLength(3);
    expect(plan.warnings[0]!.message).toContain('3 tracks');
  });

  it('does not generate warning for FLAC files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(0);
  });

  it('does not generate warning for MP3 files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'mp3')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(0);
  });

  it('does not generate warning for M4A/AAC files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'm4a')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(0);
  });

  it('does not generate warning for WAV files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'wav')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(0);
  });

  it('does not generate warning for AIFF files', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'aiff')],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(0);
  });

  it('generates warning only for incompatible lossy in mixed collection', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        // Lossless (no warning)
        createCollectionTrack('Artist', 'FLAC', 'Album', 'flac'),
        createCollectionTrack('Artist', 'WAV', 'Album', 'wav'),
        // Compatible lossy (no warning)
        createCollectionTrack('Artist', 'MP3', 'Album', 'mp3'),
        createCollectionTrack('Artist', 'AAC', 'Album', 'm4a'),
        // Incompatible lossy (warning)
        createCollectionTrack('Artist', 'OGG', 'Album', 'ogg'),
        createCollectionTrack('Artist', 'Opus', 'Album', 'opus'),
      ],
    };

    const plan = createPlan(diff);

    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.tracks).toHaveLength(2);
    expect(plan.warnings[0]!.tracks.map((t) => t.title)).toContain('OGG');
    expect(plan.warnings[0]!.tracks.map((t) => t.title)).toContain('Opus');
  });

  it('includes correct tracks in warning', () => {
    const oggTrack = createCollectionTrack('OGG Artist', 'OGG Song', 'Album', 'ogg');
    const opusTrack = createCollectionTrack('Opus Artist', 'Opus Song', 'Album', 'opus');

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [oggTrack, opusTrack],
    };

    const plan = createPlan(diff);

    expect(plan.warnings[0]!.tracks).toContain(oggTrack);
    expect(plan.warnings[0]!.tracks).toContain(opusTrack);
  });
});

// =============================================================================
// ALAC Preset with Fallback Tests
// =============================================================================

describe('createPlan - ALAC preset with fallback', () => {
  it('uses ALAC for lossless sources with quality=alac', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'FLAC', 'Album', 'flac')],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset.name).toBe('alac');
    }
  });

  it('uses ALAC for WAV sources with quality=alac', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'WAV', 'Album', 'wav')],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset.name).toBe('alac');
    }
  });

  it('uses default fallback (max) for lossy sources with quality=alac', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'OGG', 'Album', 'ogg')],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset.name).toBe('max');
    }
  });

  it('uses custom fallback for lossy sources with quality=alac', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'OGG', 'Album', 'ogg')],
    };

    const plan = createPlan(diff, {
      transcodeConfig: { quality: 'alac', fallback: 'high' },
    });

    expect(plan.operations[0]!.type).toBe('transcode');
    if (plan.operations[0]!.type === 'transcode') {
      expect(plan.operations[0]!.preset.name).toBe('high');
    }
  });

  it('copies compatible lossy sources even with quality=alac', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [createCollectionTrack('Artist', 'MP3', 'Album', 'mp3')],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('copies ALAC sources when quality=alac', () => {
    const track = createCollectionTrack('Artist', 'ALAC', 'Album', 'alac');
    track.codec = 'alac';

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [track],
    };

    const plan = createPlan(diff, { transcodeConfig: { quality: 'alac' } });

    expect(plan.operations[0]!.type).toBe('copy');
  });

  it('handles mixed collection with ALAC quality correctly', () => {
    const alacTrack = createCollectionTrack('Artist', 'Existing ALAC', 'Album', 'm4a', {
      codec: 'alac',
    });

    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'FLAC', 'Album', 'flac'),
        createCollectionTrack('Artist', 'WAV', 'Album', 'wav'),
        alacTrack,
        createCollectionTrack('Artist', 'MP3', 'Album', 'mp3'),
        createCollectionTrack('Artist', 'OGG', 'Album', 'ogg'),
      ],
    };

    const plan = createPlan(diff, {
      transcodeConfig: { quality: 'alac', fallback: 'high' },
    });
    const summary = getPlanSummary(plan);

    // FLAC, WAV -> transcode to ALAC (2 transcodes)
    // OGG -> transcode to fallback high (1 transcode)
    // Existing ALAC, MP3 -> copy (2 copies)
    expect(summary.transcodeCount).toBe(3);
    expect(summary.copyCount).toBe(2);

    // Verify presets
    const transcodeOps = plan.operations.filter((op) => op.type === 'transcode');
    const presets = transcodeOps.map((op) =>
      op.type === 'transcode' ? op.preset.name : ''
    );

    // Should have 2 ALAC and 1 high
    expect(presets.filter((p) => p === 'alac')).toHaveLength(2);
    expect(presets.filter((p) => p === 'high')).toHaveLength(1);
  });
});

// =============================================================================
// Quality Preset Tests (VBR/CBR variants)
// =============================================================================

describe('createPlan - quality presets', () => {
  const presets = [
    'max',
    'max-cbr',
    'high',
    'high-cbr',
    'medium',
    'medium-cbr',
    'low',
    'low-cbr',
  ] as const;

  for (const preset of presets) {
    it(`uses ${preset} preset when configured`, () => {
      const diff: SyncDiff = {
        ...createEmptyDiff(),
        toAdd: [createCollectionTrack('Artist', 'Song', 'Album', 'flac')],
      };

      const plan = createPlan(diff, { transcodeConfig: { quality: preset } });

      expect(plan.operations[0]!.type).toBe('transcode');
      if (plan.operations[0]!.type === 'transcode') {
        expect(plan.operations[0]!.preset.name).toBe(preset);
      }
    });
  }

  it('estimates larger size for max than low preset', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planMax = createPlan(diff, { transcodeConfig: { quality: 'max' } });
    const planLow = createPlan(diff, { transcodeConfig: { quality: 'low' } });

    // Max is 320 kbps, Low is 128 kbps
    expect(planMax.estimatedSize).toBeGreaterThan(planLow.estimatedSize * 2);
  });

  it('estimates same size for VBR and CBR at same bitrate', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planHigh = createPlan(diff, { transcodeConfig: { quality: 'high' } });
    const planHighCbr = createPlan(diff, {
      transcodeConfig: { quality: 'high-cbr' },
    });

    // Both are 256 kbps target
    expect(planHigh.estimatedSize).toBe(planHighCbr.estimatedSize);
  });

  it('estimates larger size for ALAC than AAC', () => {
    const diff: SyncDiff = {
      ...createEmptyDiff(),
      toAdd: [
        createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
          duration: 180000,
        }),
      ],
    };

    const planAlac = createPlan(diff, { transcodeConfig: { quality: 'alac' } });
    const planHigh = createPlan(diff, { transcodeConfig: { quality: 'high' } });

    // ALAC ~900 kbps vs AAC ~256 kbps
    expect(planAlac.estimatedSize).toBeGreaterThan(planHigh.estimatedSize * 3);
  });
});
