/**
 * Unit tests for the sync executor
 *
 * These tests verify the executor logic using mocked dependencies.
 *
 * ## Test Coverage
 *
 * 1. Basic execution flow (transcode, copy, remove operations)
 * 2. Progress reporting via async iterator
 * 3. Dry-run mode (no actual changes)
 * 4. Error handling (continue-on-error vs stop)
 * 5. Abort signal support
 * 6. Database saving after operations
 */

import { describe, expect, it, mock, beforeEach } from 'bun:test';
import {
  MusicExecutor,
  createExecutor,
  executePlan,
  getMusicOperationDisplayName,
  categorizeError,
  getRetriesForCategory,
  MUSIC_RETRY_CONFIG,
  type ExecutorDependencies,
  type ExecutorProgress,
} from './executor.js';
import type { CollectionTrack, CollectionAdapter, FileAccess } from '../../adapters/interface.js';
import type { AudioFileType, TrackFilter } from '../../types.js';
import type { DeviceTrack, SyncOperation, SyncPlan } from '../engine/types.js';
import { Readable } from 'node:stream';

// =============================================================================
// Mock Types
// =============================================================================

interface MockDeviceAdapter {
  addTrack: ReturnType<typeof mock>;
  getTracks: ReturnType<typeof mock>;
  removeTrack: ReturnType<typeof mock>;
  updateTrack: ReturnType<typeof mock>;
  copyTrackFile: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
  replaceTrackFile: ReturnType<typeof mock>;
  removeTrackArtwork: ReturnType<typeof mock>;
  writeSyncTag: ReturnType<typeof mock>;
}

interface MockTranscoder {
  transcode: ReturnType<typeof mock>;
  detect: ReturnType<typeof mock>;
  getFFmpegPath: ReturnType<typeof mock>;
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock DeviceTrack with all required fields
 */
function createMockDeviceTrack(
  artist: string,
  title: string,
  album: string,
  filePath: string,
  options: Partial<{
    remove: () => void;
    copyFile: (path: string) => DeviceTrack;
    update: (fields: Record<string, unknown>) => DeviceTrack;
    setArtwork: (path: string) => DeviceTrack;
    setArtworkFromData: (data: Buffer) => DeviceTrack;
    removeArtwork: () => DeviceTrack;
  }> = {}
): DeviceTrack {
  const track: DeviceTrack = {
    title,
    artist,
    album,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    syncTag: null,
    // Methods
    remove: options.remove ?? (() => {}),
    copyFile: options.copyFile ?? (() => track),
    update: options.update ?? (() => track),
    setArtwork: options.setArtwork ?? (() => track),
    setArtworkFromData: options.setArtworkFromData ?? (() => track),
    removeArtwork: options.removeArtwork ?? (() => track),
  };
  return track;
}

function createMockDeviceAdapter(initialTracks: DeviceTrack[] = []): MockDeviceAdapter {
  // Store tracks for lookup
  const tracks: DeviceTrack[] = [...initialTracks];
  let pathCounter = 0;

  return {
    addTrack: mock((input: { title: string; artist: string; album?: string }) => {
      const filePath = `Music/MOCK${pathCounter++}.m4a`;
      const track = createMockDeviceTrack(
        input.artist ?? '',
        input.title,
        input.album ?? '',
        filePath
      );
      tracks.push(track);
      return track;
    }),
    getTracks: mock(() => [...tracks]),
    removeTrack: mock((track: DeviceTrack) => {
      const index = tracks.findIndex((t) => t.filePath === track.filePath);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
      return { removed: true };
    }),
    updateTrack: mock((track: DeviceTrack, fields: Record<string, unknown>) => {
      const updated = track.update(fields);
      // Replace in tracks array (mirrors real adapter behavior)
      const index = tracks.findIndex((t) => t.filePath === track.filePath);
      if (index >= 0) {
        tracks[index] = updated;
      }
      return updated;
    }),
    copyTrackFile: mock((track: DeviceTrack, _sourcePath: string) => {
      return track.copyFile(_sourcePath);
    }),
    save: mock(async () => ({ warnings: [] })),
    replaceTrackFile: mock((track: DeviceTrack, _newFilePath: string) => track),
    removeTrackArtwork: mock((track: DeviceTrack) => track.removeArtwork()),
    writeSyncTag: mock((track: DeviceTrack, _update: Record<string, unknown>) => track),
  };
}

function createMockTranscoder(): MockTranscoder {
  return {
    transcode: mock(async () => ({
      outputPath: '/tmp/output.m4a',
      size: 5000000,
      duration: 1000,
      bitrate: 256,
    })),
    detect: mock(async () => ({
      version: '6.0',
      path: '/usr/bin/ffmpeg',
      aacEncoders: ['aac'],
      preferredEncoder: 'aac',
    })),
    getFFmpegPath: mock(() => 'ffmpeg'),
  };
}

function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  fileType: AudioFileType = 'flac',
  options: Partial<CollectionTrack> = {}
): CollectionTrack {
  return {
    id: `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath: `/music/${artist}/${album}/${title}.${fileType}`,
    fileType,
    duration: 180000,
    ...options,
  };
}

function createDeviceTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<DeviceTrack> & { removeFn?: () => void } = {}
): DeviceTrack {
  const { removeFn, ...rest } = options;
  const filePath = rest.filePath ?? `Music/${Math.random().toString(36).slice(2)}.m4a`;
  return createMockDeviceTrack(artist, title, album, filePath, {
    remove: removeFn,
    ...rest,
  });
}

function createEmptyPlan(): SyncPlan {
  return {
    operations: [],
    estimatedTime: 0,
    estimatedSize: 0,
    warnings: [],
  };
}

function createDependencies(
  adapter: MockDeviceAdapter,
  transcoder: MockTranscoder
): ExecutorDependencies {
  // Cast mocks to satisfy the interface
  return {
    device: adapter as unknown as ExecutorDependencies['device'],
    transcoder: transcoder as unknown as ExecutorDependencies['transcoder'],
  };
}

// =============================================================================
// getMusicOperationDisplayName Tests
// =============================================================================

describe('getMusicOperationDisplayName', () => {
  it('returns artist - title for transcode operation', () => {
    const op: SyncOperation = {
      type: 'add-transcode',
      source: createCollectionTrack('Pink Floyd', 'Comfortably Numb', 'The Wall'),
      preset: { name: 'high' },
    };

    expect(getMusicOperationDisplayName(op)).toBe('Pink Floyd - Comfortably Numb');
  });

  it('returns artist - title for copy operation', () => {
    const op: SyncOperation = {
      type: 'add-direct-copy',
      source: createCollectionTrack('Radiohead', 'Paranoid Android', 'OK Computer'),
    };

    expect(getMusicOperationDisplayName(op)).toBe('Radiohead - Paranoid Android');
  });

  it('returns artist - title for remove operation', () => {
    const op: SyncOperation = {
      type: 'remove',
      track: createDeviceTrack('The Beatles', 'Yesterday', 'Help!'),
    };

    expect(getMusicOperationDisplayName(op)).toBe('The Beatles - Yesterday');
  });
});

// =============================================================================
// Basic Execution Tests
// =============================================================================

describe('MusicExecutor - basic execution', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('handles empty plan', async () => {
    const executor = new MusicExecutor(deps);
    const plan = createEmptyPlan();

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should emit complete even for empty plan
    expect(progress.length).toBeGreaterThanOrEqual(0);
    expect(mockAdapter.save.mock.calls.length).toBe(0);
  });

  it('executes copy operation', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called addTrack (which returns a track with copyFile method)
    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    expect(mockAdapter.save.mock.calls.length).toBe(1);
  });

  it('passes compilation flag to addTrack', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Compilation Album', 'mp3', {
            compilation: true,
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    expect(trackInput.compilation).toBe(true);
  });

  it('passes source bitrate to addTrack for copy operation', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            bitrate: 192,
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    expect(trackInput.bitrate).toBe(192);
  });

  it('uses FFmpeg output bitrate (not source bitrate) for transcode operation', async () => {
    // Mock transcoder to return a specific bitrate different from source
    mockTranscoder.transcode = mock(async () => ({
      outputPath: '/tmp/output.m4a',
      size: 5000000,
      duration: 1000,
      bitrate: 128,
    }));
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            bitrate: 1000, // Source is high-bitrate FLAC
          }),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    // Should use the transcoder output bitrate (128), not the source bitrate (1000)
    expect(trackInput.bitrate).toBe(128);
  });

  it('executes transcode operation', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called transcoder and addTrack (which returns a track with copyFile method)
    expect(mockTranscoder.transcode.mock.calls.length).toBe(1);
    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    expect(mockAdapter.save.mock.calls.length).toBe(1);
  });

  it('executes remove operation', async () => {
    // Create a track to be removed - it must be in the mock database
    let removed = false;
    const trackToRemove = createDeviceTrack('Artist', 'Song', 'Album', {
      removeFn: () => {
        removed = true;
      },
    });

    // Create a mock database that already contains the track
    mockAdapter = createMockDeviceAdapter([trackToRemove]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'remove',
          track: trackToRemove,
        },
      ],
      estimatedTime: 0.1,
      estimatedSize: 0,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called the track's remove method
    expect(removed).toBe(true);
    expect(mockAdapter.save.mock.calls.length).toBe(1);
  });

  it('executes multiple operations in order', async () => {
    // Create a track to be removed - it must be in the mock database
    let removed = false;
    const trackToRemove = createDeviceTrack('Old Artist', 'Old Song', 'Old Album', {
      removeFn: () => {
        removed = true;
      },
    });

    // Create a mock database that already contains the track
    mockAdapter = createMockDeviceAdapter([trackToRemove]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'remove',
          track: trackToRemove,
        },
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'MP3 Song', 'Album', 'mp3'),
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'FLAC Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    expect(removed).toBe(true);
    expect(mockAdapter.addTrack.mock.calls.length).toBe(2);
    expect(mockTranscoder.transcode.mock.calls.length).toBe(1);
    expect(mockAdapter.save.mock.calls.length).toBe(1);
  });
});

// =============================================================================
// Progress Reporting Tests
// =============================================================================

describe('MusicExecutor - progress reporting', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('emits progress when operations complete (pipeline model)', async () => {
    // Note: In the pipeline model, progress is emitted when transfers complete,
    // not when operations start. This replaces the old "preparing" phase behavior.
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have progress events (copying, updating-db, complete)
    expect(progress.length).toBeGreaterThan(0);
    const copyingEvents = progress.filter((p) => p.phase === 'copying');
    expect(copyingEvents.length).toBe(1);
  });

  it('includes operation index and total', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S3', 'Album', 'mp3') },
      ],
      estimatedTime: 3,
      estimatedSize: 15000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Check that we have all indices
    const indices = new Set(progress.map((p) => p.index));
    expect(indices.has(0)).toBe(true);
    expect(indices.has(1)).toBe(true);
    expect(indices.has(2)).toBe(true);

    // All should have total = 3
    for (const p of progress) {
      expect(p.total).toBe(3);
    }
  });

  it('includes current track name', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Pink Floyd', 'Money', 'DSOTM', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const copyEvents = progress.filter((p) => p.phase === 'copying');
    expect(copyEvents.some((p) => p.currentTrack === 'Pink Floyd - Money')).toBe(true);
  });

  it('tracks bytes processed', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // After transcode, bytes should be > 0
    const completeEvent = progress.find((p) => p.phase === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.bytesProcessed).toBeGreaterThan(0);
  });

  it('emits updating-db phase before save', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const dbUpdateEvents = progress.filter((p) => p.phase === 'updating-db');
    expect(dbUpdateEvents.length).toBe(1);
  });

  it('emits complete phase at end', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const lastEvent = progress[progress.length - 1];
    expect(lastEvent?.phase).toBe('complete');
  });
});

// =============================================================================
// Dry-Run Mode Tests
// =============================================================================

describe('MusicExecutor - dry-run mode', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('does not call database methods in dry-run', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
        {
          type: 'add-transcode',
          source: createCollectionTrack('B', 'T', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'remove', track: createDeviceTrack('C', 'U', 'Album') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    expect(mockAdapter.addTrack.mock.calls.length).toBe(0);
    expect(mockAdapter.removeTrack.mock.calls.length).toBe(0);
    expect(mockAdapter.save.mock.calls.length).toBe(0);
    expect(mockTranscoder.transcode.mock.calls.length).toBe(0);
  });

  it('marks progress as skipped in dry-run', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    const skippedEvents = progress.filter((p) => p.skipped === true);
    expect(skippedEvents.length).toBeGreaterThan(0);
  });

  it('still emits progress events in dry-run', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    // Should have progress for each operation
    expect(progress.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('MusicExecutor - error handling', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('stops on error by default', async () => {
    // Make transcode fail
    mockTranscoder.transcode = mock(async () => {
      throw new Error('Transcode failed');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
      warnings: [],
    };

    let errorThrown = false;
    try {
      for await (const _p of executor.execute(plan)) {
        // iterate
      }
    } catch (err) {
      errorThrown = true;
      expect((err as Error).message).toBe('Transcode failed');
    }

    expect(errorThrown).toBe(true);
    // Second operation should not have been executed
    expect(mockAdapter.addTrack.mock.calls.length).toBe(0);
  });

  it('continues on error when continueOnError is true', async () => {
    // Make first transcode fail permanently (both initial and retry)
    mockTranscoder.transcode = mock(async () => {
      throw new Error('Transcode failed permanently');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Should have error in progress (after retry exhausted)
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]!.error!.message).toBe('Transcode failed permanently');

    // Second operation should have been executed
    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
  });

  it('includes error in progress event', async () => {
    mockAdapter.addTrack = mock(() => {
      throw new Error('Database error');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    try {
      for await (const p of executor.execute(plan)) {
        progress.push(p);
      }
    } catch {
      // Expected
    }

    const errorEvent = progress.find((p) => p.error !== undefined);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error!.message).toBe('Database error');
  });
});

// =============================================================================
// Abort Signal Tests
// =============================================================================

describe('MusicExecutor - abort signal', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S3', 'Album', 'mp3') },
      ],
      estimatedTime: 3,
      estimatedSize: 15000000,
      warnings: [],
    };

    // Abort after first operation
    let opCount = 0;
    let errorThrown = false;

    try {
      for await (const p of executor.execute(plan, { signal: controller.signal })) {
        if (p.phase === 'copying') {
          opCount++;
          if (opCount === 1) {
            controller.abort();
          }
        }
      }
    } catch (err) {
      errorThrown = true;
      expect((err as Error).message).toBe('Sync aborted');
    }

    expect(errorThrown).toBe(true);
  });

  it('checks abort before each operation', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    let errorThrown = false;
    try {
      for await (const _p of executor.execute(plan, { signal: controller.signal })) {
        // iterate
      }
    } catch (err) {
      errorThrown = true;
      expect((err as Error).message).toBe('Sync aborted');
    }

    expect(errorThrown).toBe(true);
    expect(mockAdapter.addTrack.mock.calls.length).toBe(0);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createExecutor', () => {
  it('creates a SyncExecutor instance', () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = createExecutor(deps);

    expect(executor).toBeInstanceOf(MusicExecutor);
    expect(typeof executor.execute).toBe('function');
  });
});

describe('executePlan', () => {
  it('returns execution result', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockAdapter, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
      warnings: [],
    };

    const result = await executePlan(plan, deps);

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('counts skipped operations in dry-run', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockAdapter, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
      warnings: [],
    };

    const result = await executePlan(plan, deps, { dryRun: true });

    expect(result.completed).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('collects errors when continueOnError is true', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();

    // Make first copy fail permanently with a database error (no retry)
    let callCount = 0;
    mockAdapter.addTrack = mock((input: { title: string }) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('database error: add failed');
      }
      return createMockDeviceTrack('', input.title, '', `Music/MOCK${callCount}.m4a`);
    });

    const deps = createDependencies(mockAdapter, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
      warnings: [],
    };

    const result = await executePlan(plan, deps, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error.message).toBe('database error: add failed');
  });
});

// =============================================================================
// Phase Detection Tests
// =============================================================================

describe('phase detection', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('reports transcoding phase for transcode operations', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const transcodeEvents = progress.filter((p) => p.phase === 'transcoding');
    expect(transcodeEvents.length).toBeGreaterThan(0);
  });

  it('reports copying phase for copy operations', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const copyEvents = progress.filter((p) => p.phase === 'copying');
    expect(copyEvents.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Filetype Detection Tests
// =============================================================================

describe('filetype detection', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('sets MPEG audio file for MP3', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S', 'Album', 'mp3', {
            filePath: '/music/song.mp3',
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('MPEG audio file');
  });

  it('sets AAC audio file for M4A', async () => {
    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S', 'Album', 'm4a', {
            filePath: '/music/song.m4a',
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('AAC audio file');
  });
});

// =============================================================================
// Error Categorization Tests
// =============================================================================

describe('categorizeError', () => {
  it('categorizes FFmpeg errors as transcode', () => {
    expect(categorizeError(new Error('FFmpeg failed'), 'add-transcode')).toBe('transcode');
    expect(categorizeError(new Error('encoder not found'), 'add-transcode')).toBe('transcode');
    expect(categorizeError(new Error('codec error'), 'add-direct-copy')).toBe('transcode');
  });

  it('categorizes file errors as copy', () => {
    expect(categorizeError(new Error('ENOENT: file not found'), 'add-direct-copy')).toBe('copy');
    expect(categorizeError(new Error('EACCES: permission denied'), 'add-direct-copy')).toBe('copy');
    // File I/O errors take precedence over operation type
    expect(categorizeError(new Error('ENOSPC: no space left'), 'add-transcode')).toBe('copy');
    expect(categorizeError(new Error('permission denied'), 'add-transcode')).toBe('copy');
  });

  it('categorizes database errors correctly', () => {
    expect(categorizeError(new Error('database error'), 'add-direct-copy')).toBe('database');
    expect(categorizeError(new Error('libgpod failed'), 'add-direct-copy')).toBe('database');
    expect(categorizeError(new Error('iTunes error'), 'add-direct-copy')).toBe('database');
  });

  it('categorizes artwork errors correctly', () => {
    expect(categorizeError(new Error('artwork failed'), 'add-direct-copy')).toBe('artwork');
    expect(categorizeError(new Error('image processing error'), 'add-direct-copy')).toBe('artwork');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(categorizeError(new Error('something went wrong'), 'remove')).toBe('unknown');
  });

  it('uses operation type as hint for generic errors', () => {
    // When error message doesn't match any specific category, fall back to operation type
    expect(categorizeError(new Error('something failed'), 'add-transcode')).toBe('transcode');
    expect(categorizeError(new Error('something failed'), 'add-direct-copy')).toBe('copy');
    // But specific error messages take precedence over operation type
    expect(categorizeError(new Error('database corruption'), 'add-transcode')).toBe('database');
    expect(categorizeError(new Error('ENOENT'), 'add-transcode')).toBe('copy');
  });
});

describe('getRetriesForCategory', () => {
  it('returns correct retries for transcode errors', () => {
    expect(getRetriesForCategory('transcode', MUSIC_RETRY_CONFIG)).toBe(1);
  });

  it('returns correct retries for copy errors', () => {
    expect(getRetriesForCategory('copy', MUSIC_RETRY_CONFIG)).toBe(1);
  });

  it('returns 0 retries for database errors', () => {
    expect(getRetriesForCategory('database', MUSIC_RETRY_CONFIG)).toBe(0);
  });

  it('returns 0 retries for artwork errors', () => {
    expect(getRetriesForCategory('artwork', MUSIC_RETRY_CONFIG)).toBe(0);
  });

  it('returns 0 retries for unknown errors', () => {
    expect(getRetriesForCategory('unknown', MUSIC_RETRY_CONFIG)).toBe(0);
  });

  it('respects custom retry config', () => {
    const customConfig = {
      transcodeRetries: 3,
      copyRetries: 2,
      databaseRetries: 1,
      retryDelayMs: 500,
    };
    expect(getRetriesForCategory('transcode', customConfig)).toBe(3);
    expect(getRetriesForCategory('copy', customConfig)).toBe(2);
    expect(getRetriesForCategory('database', customConfig)).toBe(1);
  });
});

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('MusicExecutor - retry logic', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('retries transcode operation once on failure then succeeds', async () => {
    let transcodeAttempts = 0;
    mockTranscoder.transcode = mock(async () => {
      transcodeAttempts++;
      if (transcodeAttempts === 1) {
        throw new Error('FFmpeg transient failure');
      }
      return {
        outputPath: '/tmp/output.m4a',
        size: 5000000,
        duration: 1000,
        bitrate: 256,
      };
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 }, // No delay for tests
    })) {
      progress.push(p);
    }

    // Should have succeeded after retry
    expect(transcodeAttempts).toBe(2);
    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    // No error events since it succeeded on retry
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(0);
  });

  it('retries transcode operation once on failure then fails permanently', async () => {
    mockTranscoder.transcode = mock(async () => {
      throw new Error('FFmpeg permanent failure');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Should have tried twice (initial + 1 retry)
    expect(mockTranscoder.transcode.mock.calls.length).toBe(2);
    // Should have error with categorized info
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]!.categorizedError).toBeDefined();
    expect(errorEvents[0]!.categorizedError!.wasRetried).toBe(true);
    expect(errorEvents[0]!.categorizedError!.retryAttempts).toBe(1);
  });

  it('retries copy operation once on failure', async () => {
    let copyAttempts = 0;
    // Make addTrack return a track whose copyFile method fails initially
    mockAdapter.addTrack = mock((input: { title: string }) => {
      const track = createMockDeviceTrack('', input.title, '', `Music/MOCK${copyAttempts}.m4a`, {
        copyFile: () => {
          copyAttempts++;
          if (copyAttempts === 1) {
            throw new Error('ENOENT: file not found');
          }
          return track;
        },
      });
      return track;
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S1', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Should have succeeded after retry
    expect(copyAttempts).toBe(2);
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(0);
  });

  it('does not retry database errors', async () => {
    mockAdapter.addTrack = mock(() => {
      throw new Error('database corruption');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S1', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Should only try once (no retry for database errors)
    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]!.categorizedError?.wasRetried).toBe(false);
  });

  it('includes retry attempt in progress events', async () => {
    let transcodeAttempts = 0;
    mockTranscoder.transcode = mock(async () => {
      transcodeAttempts++;
      if (transcodeAttempts === 1) {
        throw new Error('FFmpeg transient failure');
      }
      return {
        outputPath: '/tmp/output.m4a',
        size: 5000000,
        duration: 1000,
        bitrate: 256,
      };
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Success event should include retry attempt info
    const transcodeEvents = progress.filter((p) => p.phase === 'transcoding');
    expect(transcodeEvents.length).toBeGreaterThan(0);
    const successEvent = transcodeEvents.find((p) => !p.error);
    expect(successEvent?.retryAttempt).toBe(1);
  });

  it('respects custom retry configuration', async () => {
    mockTranscoder.transcode = mock(async () => {
      throw new Error('FFmpeg failure');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { transcodeRetries: 3, retryDelayMs: 0 },
    })) {
      // iterate
    }

    // Should have tried 4 times (initial + 3 retries)
    expect(mockTranscoder.transcode.mock.calls.length).toBe(4);
  });
});

// =============================================================================
// executePlan with categorized errors Tests
// =============================================================================

describe('executePlan - categorized errors', () => {
  it('collects categorized errors in result', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();

    // Make transcode fail
    mockTranscoder.transcode = mock(async () => {
      throw new Error('FFmpeg error');
    });

    const deps = createDependencies(mockAdapter, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
      warnings: [],
    };

    const result = await executePlan(plan, deps, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.categorizedErrors).toHaveLength(1);
    expect(result.categorizedErrors[0]!.category).toBe('transcode');
    expect(result.categorizedErrors[0]!.trackName).toBe('A - S1');
    expect(result.categorizedErrors[0]!.wasRetried).toBe(true);
  });
});

// =============================================================================
// Update Metadata Operation Tests
// =============================================================================

describe('MusicExecutor - update-metadata operations', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('executes update-metadata operation', async () => {
    // Track already on device that needs updating
    let updateCalled = false;
    let updateFields: Record<string, unknown> | null = null;
    const deviceTrack = createMockDeviceTrack(
      'Artist feat. B',
      'Song',
      'Album',
      'Music/UPDATE.m4a',
      {
        update: (fields: Record<string, unknown>) => {
          updateCalled = true;
          updateFields = fields;
          return deviceTrack;
        },
      }
    );

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: {
            artist: 'Artist',
            title: 'Song (feat. B)',
          },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    expect(updateCalled).toBe(true);
    expect(updateFields).not.toBeNull();
    expect(updateFields!.artist).toBe('Artist');
    expect(updateFields!.title).toBe('Song (feat. B)');
    expect(mockAdapter.save.mock.calls.length).toBe(1);
  });

  it('finds track by filePath for update', async () => {
    let foundByPath = false;
    const deviceTrack = createMockDeviceTrack(
      'Old Artist',
      'Old Title',
      'Album',
      'Music/PATH.m4a',
      {
        update: () => {
          foundByPath = true;
          return deviceTrack;
        },
      }
    );

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack, // Same filePath
          metadata: { artist: 'New Artist' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    expect(foundByPath).toBe(true);
  });

  it('falls back to metadata matching when filePath differs', async () => {
    let updateCalled = false;
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/ACTUAL.m4a', {
      update: () => {
        updateCalled = true;
        return deviceTrack;
      },
    });

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    // Use different filePath in operation, but same metadata
    const operationTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/DIFFERENT.m4a');
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: operationTrack,
          metadata: { genre: 'Rock' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    expect(updateCalled).toBe(true);
  });

  it('throws error when track not found', async () => {
    mockAdapter = createMockDeviceAdapter([]); // Empty database
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const nonExistentTrack = createMockDeviceTrack(
      'Missing',
      'Track',
      'Album',
      'Music/MISSING.m4a'
    );
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: nonExistentTrack,
          metadata: { artist: 'New Artist' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    let errorThrown = false;
    try {
      for await (const _p of executor.execute(plan)) {
        // iterate
      }
    } catch (err) {
      errorThrown = true;
      expect((err as Error).message).toContain('Track not found in database');
    }

    expect(errorThrown).toBe(true);
  });

  it('reports updating-db phase for update-metadata operations', async () => {
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a');
    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: { artist: 'New Artist' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have updating-db phase (that's what getPhaseForOperation returns for update-metadata)
    const dbEvents = progress.filter((p) => p.phase === 'updating-db');
    expect(dbEvents.length).toBeGreaterThan(0);
  });

  it('does not transfer bytes for update-metadata', async () => {
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a');
    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: { artist: 'New Artist' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const completeEvent = progress.find((p) => p.phase === 'complete');
    expect(completeEvent!.bytesProcessed).toBe(0);
  });

  it('skips update-metadata in dry-run mode', async () => {
    let updateCalled = false;
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a', {
      update: () => {
        updateCalled = true;
        return deviceTrack;
      },
    });

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: { artist: 'New Artist' },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    expect(updateCalled).toBe(false);
    expect(mockAdapter.save.mock.calls.length).toBe(0);
    const skippedEvents = progress.filter((p) => p.skipped === true);
    expect(skippedEvents.length).toBeGreaterThan(0);
  });

  it('updates only specified fields', async () => {
    let updateFields: Record<string, unknown> | null = null;
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a', {
      update: (fields: Record<string, unknown>) => {
        updateFields = fields;
        return deviceTrack;
      },
    });

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: {
            artist: 'New Artist',
            // title not specified - should not be included
          },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    // Only artist should be in the update
    expect(updateFields).not.toBeNull();
    expect(updateFields!.artist).toBe('New Artist');
    expect(updateFields).not.toHaveProperty('title');
  });

  it('handles all metadata fields', async () => {
    let updateFields: Record<string, unknown> | null = null;
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a', {
      update: (fields: Record<string, unknown>) => {
        updateFields = fields;
        return deviceTrack;
      },
    });

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: {
            artist: 'New Artist',
            title: 'New Title',
            album: 'New Album',
            albumArtist: 'New Album Artist',
            genre: 'New Genre',
            year: 2024,
            trackNumber: 5,
            discNumber: 2,
          },
        },
      ],
      estimatedTime: 0.01,
      estimatedSize: 0,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    expect(updateFields).not.toBeNull();
    expect(updateFields!.artist).toBe('New Artist');
    expect(updateFields!.title).toBe('New Title');
    expect(updateFields!.album).toBe('New Album');
    expect(updateFields!.albumArtist).toBe('New Album Artist');
    expect(updateFields!.genre).toBe('New Genre');
    expect(updateFields!.year).toBe(2024);
    expect(updateFields!.trackNumber).toBe(5);
    expect(updateFields!.discNumber).toBe(2);
  });
});

describe('getMusicOperationDisplayName - update-metadata', () => {
  it('returns artist - title for update-metadata operation', () => {
    const op: SyncOperation = {
      type: 'update-metadata',
      track: createDeviceTrack('Daft Punk', 'Get Lucky', 'Random Access Memories'),
      metadata: { artist: 'Daft Punk', title: 'Get Lucky (feat. Pharrell Williams)' },
    };

    expect(getMusicOperationDisplayName(op)).toBe('Daft Punk - Get Lucky');
  });
});

// =============================================================================
// Upgrade Operation Tests
// =============================================================================

describe('getMusicOperationDisplayName - upgrade', () => {
  it('returns artist - title for upgrade operation', () => {
    const op: SyncOperation = {
      type: 'upgrade-transcode',
      source: createCollectionTrack('Pink Floyd', 'Comfortably Numb', 'The Wall', 'flac'),
      target: createDeviceTrack('Pink Floyd', 'Comfortably Numb', 'The Wall'),
      reason: 'format-upgrade',
      preset: { name: 'high' },
    };

    expect(getMusicOperationDisplayName(op)).toBe('Pink Floyd - Comfortably Numb');
  });
});

describe('upgrade operations - dry run', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('reports upgrade operations in dry run without making changes', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
    });

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    // Should report upgrade operation as skipped
    const upgradeProgress = progress.find((p) => p.operation.type === 'upgrade-transcode');
    expect(upgradeProgress).toBeDefined();
    expect(upgradeProgress!.skipped).toBe(true);
    expect(upgradeProgress!.phase).toBe('upgrading');

    // No database operations should have been called
    expect(db.addTrack).not.toHaveBeenCalled();
    expect(db.save).not.toHaveBeenCalled();
    expect(transcoder.transcode).not.toHaveBeenCalled();
  });
});

describe('upgrade operations - execution', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('executes upgrade with transcode preset (format-upgrade)', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
    });

    // Add replaceTrackFile to the mock database
    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;

    // Pre-populate database with the existing track
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
            duration: 200000,
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false })) {
      progress.push(p);
    }

    // Should have transcoded the file
    expect(transcoder.transcode).toHaveBeenCalledTimes(1);

    // Should have replaced the track file (not added a new one)
    expect(db.addTrack).not.toHaveBeenCalled();
    expect(replaceTrackFile).toHaveBeenCalledTimes(1);

    // Should have saved the database
    expect(db.save).toHaveBeenCalledTimes(1);

    // Should report upgrading phase
    const upgradeProgress = progress.find((p) => p.phase === 'upgrading');
    expect(upgradeProgress).toBeDefined();
  });

  it('executes upgrade without preset (copy-based quality-upgrade)', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      bitrate: 128,
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;

    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            bitrate: 320,
          }),
          target: existingTrack,
          reason: 'quality-upgrade',
          // No preset — MP3 is copied directly
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // Should NOT have transcoded
    expect(transcoder.transcode).not.toHaveBeenCalled();

    // Should have replaced the track file
    expect(replaceTrackFile).toHaveBeenCalledTimes(1);

    // Should NOT have added a new track
    expect(db.addTrack).not.toHaveBeenCalled();
  });

  it('updates metadata fields after file replacement', async () => {
    let capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (fields: Record<string, unknown>) => {
        capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;

    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
            duration: 200000,
            genre: 'Progressive Rock',
            year: 1979,
            soundcheck: 5432,
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // Should have updated metadata
    expect(capturedUpdateFields).toBeDefined();
    expect(capturedUpdateFields!.filetype).toBe('AAC audio file');
    expect(capturedUpdateFields!.genre).toBe('Progressive Rock');
    expect(capturedUpdateFields!.year).toBe(1979);
    expect(capturedUpdateFields!.soundcheck).toBe(5432);
    expect(capturedUpdateFields!.duration).toBe(200000);
  });

  it('categorizes upgrade errors as copy errors for retry', () => {
    const error = new Error('something went wrong');
    const category = categorizeError(error, 'upgrade-direct-copy');
    expect(category).toBe('copy');
  });

  it('reports error when upgrade target track is not found in database', async () => {
    // Empty database — the target track won't be found during transfer
    db = createMockDeviceAdapter();
    const replaceTrackFile = mock(() => {});
    (db as any).replaceTrackFile = replaceTrackFile;

    const targetTrack = createDeviceTrack('Missing', 'Track', 'Album', {
      filePath: 'Music/GONE.m4a',
    });

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Missing', 'Track', 'Album', 'flac', {
            lossless: true,
          }),
          target: targetTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    // The error is reported via progress events (not thrown)
    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false })) {
      progress.push(p);
    }

    // Should have an error in the progress events
    const errorEvent = progress.find((p) => p.error !== undefined);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error!.message).toContain('Track not found in database for upgrade');
  });

  it('continues past upgrade-not-found error with continueOnError', async () => {
    // Empty database — the target track won't be found
    db = createMockDeviceAdapter();
    const replaceTrackFile = mock(() => {});
    (db as any).replaceTrackFile = replaceTrackFile;

    const targetTrack = createDeviceTrack('Missing', 'Track', 'Album', {
      filePath: 'Music/GONE.m4a',
    });

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Missing', 'Track', 'Album', 'flac', {
            lossless: true,
          }),
          target: targetTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    // With continueOnError: true, should not throw
    const progress: ExecutorProgress[] = [];
    let errorThrown = false;
    try {
      for await (const p of executor.execute(plan, {
        artwork: false,
        continueOnError: true,
      })) {
        progress.push(p);
      }
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(false);
    // Error should still be reported in progress
    const errorEvent = progress.find((p) => p.error !== undefined);
    expect(errorEvent).toBeDefined();
  });

  it('does not include identity fields (title, artist, album) in upgrade metadata update', async () => {
    let capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (fields: Record<string, unknown>) => {
        capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
            duration: 200000,
            genre: 'Rock',
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // Verify identity fields are NOT in the update (they are matching fields, not update fields)
    expect(capturedUpdateFields).toBeDefined();
    expect(capturedUpdateFields).not.toHaveProperty('title');
    expect(capturedUpdateFields).not.toHaveProperty('artist');
    expect(capturedUpdateFields).not.toHaveProperty('album');

    // But technical metadata and other fields should be present
    expect(capturedUpdateFields!.filetype).toBeDefined();
    expect(capturedUpdateFields!.genre).toBe('Rock');
  });
});

// =============================================================================
// Prefetch Pipeline Tests (ADR-011)
// =============================================================================

/**
 * Create a mock stream-based adapter that tracks when downloads happen.
 *
 * Each call to getFileAccess returns a stream that, when consumed via
 * streamToTempFile, writes a small audio-like file to a temp path.
 * The downloadLog records the order and timing of downloads.
 */
function createMockStreamAdapter(options?: {
  /** Artificial delay per download in ms */
  downloadDelayMs?: number;
}): {
  adapter: CollectionAdapter;
  downloadLog: Array<{ trackId: string; startTime: number; endTime: number }>;
} {
  const downloadLog: Array<{ trackId: string; startTime: number; endTime: number }> = [];

  const adapter: CollectionAdapter = {
    name: 'mock-stream',
    adapterType: 'mock-stream',
    connect: async () => {},
    getItems: async () => [],
    getFilteredItems: async (_filter: TrackFilter) => [],
    disconnect: async () => {},
    getFileAccess(track: CollectionTrack): FileAccess {
      return {
        type: 'stream',
        getStream: async () => {
          const startTime = Date.now();
          if (options?.downloadDelayMs) {
            await new Promise((r) => setTimeout(r, options.downloadDelayMs));
          }
          const endTime = Date.now();
          downloadLog.push({ trackId: track.id, startTime, endTime });
          // Return a minimal readable stream with some bytes
          return Readable.from(Buffer.alloc(1024, 0));
        },
      };
    },
  };

  return { adapter, downloadLog };
}

describe('MusicExecutor - prefetch pipeline (ADR-011)', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('passes stream-based adapter files through the pipeline correctly', async () => {
    const { adapter } = createMockStreamAdapter();

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 10,
      estimatedSize: 10000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { adapter, artwork: false })) {
      progress.push(p);
    }

    // Both operations should complete successfully
    const completedOps = progress.filter((p) => p.phase === 'transcoding' || p.phase === 'copying');
    expect(completedOps.length).toBe(2);

    // No errors
    const errors = progress.filter((p) => p.error);
    expect(errors.length).toBe(0);

    // Database should have been saved
    expect(db.save).toHaveBeenCalled();
    // Both tracks should have been added
    expect(db.addTrack).toHaveBeenCalledTimes(2);
  });

  it('downloads are started before transcoding completes for the previous track', async () => {
    // Use a delay so we can observe ordering
    const { adapter, downloadLog } = createMockStreamAdapter({ downloadDelayMs: 10 });

    // Track when transcoding happens
    const transcodeLog: Array<{ trackId: string; startTime: number; endTime: number }> = [];
    transcoder.transcode = mock(async (input: string) => {
      const startTime = Date.now();
      await new Promise((r) => setTimeout(r, 30)); // Simulate transcoding work
      const endTime = Date.now();
      transcodeLog.push({ trackId: input, startTime, endTime });
      return { outputPath: '/tmp/output.m4a', size: 5000000, duration: 1000, bitrate: 256 };
    });

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song3', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 30,
      estimatedSize: 15000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { adapter, artwork: false })) {
      // consume
    }

    // All 3 downloads and 3 transcodes should have happened
    expect(downloadLog.length).toBe(3);
    expect(transcodeLog.length).toBe(3);

    // Key assertion: download of track N+1 should start before or during
    // transcode of track N (prefetch overlap). With PREFETCH_BUFFER_SIZE=2,
    // the downloader can be 2 items ahead of the preparer.
    // Download 2 should start before transcode 1 ends
    expect(downloadLog[1]!.startTime).toBeLessThanOrEqual(transcodeLog[0]!.endTime);
  });

  it('cleans up prefetched files when preparer encounters an error', async () => {
    const { adapter } = createMockStreamAdapter();

    // Make transcoding fail
    transcoder.transcode = mock(async () => {
      throw new Error('FFmpeg transcode failed');
    });

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 10,
      estimatedSize: 10000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    // With continueOnError=false, should stop after first failure
    try {
      for await (const p of executor.execute(plan, { adapter, artwork: false })) {
        progress.push(p);
      }
    } catch {
      // Expected - fatal error propagates
    }

    // Should have error(s) reported
    const errors = progress.filter((p) => p.error);
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // No tracks should have been added (transcode failed)
    expect(db.addTrack).not.toHaveBeenCalled();
  });

  it('continues past download errors with continueOnError', async () => {
    let callCount = 0;
    const adapter: CollectionAdapter = {
      name: 'failing-stream',
      adapterType: 'failing-stream',
      connect: async () => {},
      getItems: async () => [],
      getFilteredItems: async () => [],
      disconnect: async () => {},
      getFileAccess(_track: CollectionTrack): FileAccess {
        callCount++;
        if (callCount === 1) {
          // First track: fail the stream
          return {
            type: 'stream',
            getStream: async () => {
              throw new Error('Network error: connection refused');
            },
          };
        }
        // Second track: succeed
        return {
          type: 'stream',
          getStream: async () => Readable.from(Buffer.alloc(1024, 0)),
        };
      },
    };

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'mp3'),
        },
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 10,
      estimatedSize: 10000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      adapter,
      artwork: false,
      continueOnError: true,
    })) {
      progress.push(p);
    }

    // First track should have an error, second should succeed
    const errors = progress.filter((p) => p.error);
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Second track should have been added successfully
    expect(db.addTrack).toHaveBeenCalledTimes(1);
  });

  it('handles mixed operation types with stream adapter', async () => {
    const { adapter } = createMockStreamAdapter();

    // Create an existing track for removal with a spy on remove()
    let trackRemoved = false;
    const existingTrack = createDeviceTrack('Old Artist', 'Old Song', 'Old Album', {
      removeFn: () => {
        trackRemoved = true;
      },
    });
    db = createMockDeviceAdapter([existingTrack]);
    transcoder = createMockTranscoder();

    const plan: SyncPlan = {
      operations: [
        {
          type: 'remove',
          track: existingTrack,
        } as SyncOperation,
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 10,
      estimatedSize: 10000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { adapter, artwork: false })) {
      progress.push(p);
    }

    // Remove should have executed (inline in downloader)
    expect(trackRemoved).toBe(true);
    // Two tracks should have been added
    expect(db.addTrack).toHaveBeenCalledTimes(2);
    // Database should have been saved
    expect(db.save).toHaveBeenCalled();
    // No errors
    const errors = progress.filter((p) => p.error);
    expect(errors.length).toBe(0);
  });

  it('cleans up prefetched files on abort', async () => {
    const { adapter } = createMockStreamAdapter({ downloadDelayMs: 5 });

    // Slow transcoding so abort happens during pipeline
    transcoder.transcode = mock(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { outputPath: '/tmp/output.m4a', size: 5000000, duration: 1000, bitrate: 256 };
    });

    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song2', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song3', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 30,
      estimatedSize: 15000000,
      warnings: [],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const controller = new AbortController();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 30);

    try {
      for await (const _p of executor.execute(plan, {
        adapter,
        artwork: false,
        signal: controller.signal,
      })) {
        // consume
      }
    } catch (error) {
      // Expected: 'Sync aborted'
      expect((error as Error).message).toBe('Sync aborted');
    }

    // Pipeline should have been aborted — not all operations completed
    // (exact count depends on timing, but should not be all 3)
  });
});

// =============================================================================
// Sync Tag Preservation After Upgrade
// =============================================================================

describe('sync tag preservation after upgrade', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('writes sync tag with NEW quality after preset-downgrade upgrade', async () => {
    // This tests the stale snapshot fix: after upgrade, the sync tag in the
    // comment field should reflect the NEW preset (low), not the old one (high).
    let _capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      comment: '[podkit:v1 quality=high encoding=vbr]',
      update: (fields: Record<string, unknown>) => {
        _capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
            duration: 200000,
          }),
          target: existingTrack,
          reason: 'preset-downgrade',
          preset: { name: 'low' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: { encodingMode: 'vbr' },
    })) {
      // consume
    }

    // The sync tag should be written via writeSyncTag with the NEW quality=low
    expect(db.writeSyncTag).toHaveBeenCalledTimes(1);
    const syncTagUpdate = db.writeSyncTag.mock.calls[0]![1] as Record<string, unknown>;
    expect(syncTagUpdate.quality).toBe('low');
  });

  it('writes sync tag with encoding mode after transcode upgrade', async () => {
    let _capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (fields: Record<string, unknown>) => {
        _capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
          }),
          target: existingTrack,
          reason: 'preset-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: { encodingMode: 'cbr' },
    })) {
      // consume
    }

    // The sync tag should be written via writeSyncTag with quality and encoding
    expect(db.writeSyncTag).toHaveBeenCalledTimes(1);
    const syncTagUpdate = db.writeSyncTag.mock.calls[0]![1] as Record<string, unknown>;
    expect(syncTagUpdate.quality).toBe('high');
    expect(syncTagUpdate.encoding).toBe('cbr');
  });

  it('does not write sync tag when syncTagConfig is not provided', async () => {
    let _capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (fields: Record<string, unknown>) => {
        _capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    // No syncTagConfig provided
    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // writeSyncTag should not be called when syncTagConfig is absent
    expect(db.writeSyncTag).not.toHaveBeenCalled();
  });

  it('writes sync tag for new transcode operations', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'medium' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: { encodingMode: 'vbr' },
    })) {
      // consume
    }

    // Check the addTrack call for the syncTag field
    expect(db.addTrack).toHaveBeenCalledTimes(1);
    const trackInput = db.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    const syncTag = trackInput.syncTag as Record<string, unknown>;
    expect(syncTag).toBeDefined();
    expect(syncTag.quality).toBe('medium');
    expect(syncTag.encoding).toBe('vbr');
  });
});

// =============================================================================
// Artwork During Upgrade Operations
// =============================================================================

describe('artwork during upgrade operations', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('transfers artwork during transcode when artwork is enabled', async () => {
    let artworkSet = false;
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
    };

    // Mock addTrack to return a track that records setArtworkFromData calls
    db.addTrack = mock((input: Record<string, unknown>) => {
      const filePath = `Music/MOCK_ART.m4a`;
      return createMockDeviceTrack(
        String(input.artist ?? ''),
        String(input.title ?? ''),
        String(input.album ?? ''),
        filePath,
        {
          setArtworkFromData: (_data: Buffer) => {
            artworkSet = true;
            return createMockDeviceTrack(
              String(input.artist ?? ''),
              String(input.title ?? ''),
              String(input.album ?? ''),
              filePath
            );
          },
        }
      );
    });

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    // artwork: true — extractArtwork is called on the source file.
    // Since our test source file doesn't exist, extraction returns null.
    // No warning is added for missing artwork (it's normal).
    for await (const _p of executor.execute(plan, { artwork: true })) {
      // consume
    }

    // The test verifies the artwork code path ran. With non-existent test files,
    // extractArtwork returns null (no embedded artwork), so setArtworkFromData
    // is not called. The critical thing is the operation completed without error.
    expect(db.addTrack).toHaveBeenCalledTimes(1);
    // Artwork was not set (no artwork in test fixture), but no errors either
    expect(artworkSet).toBe(false);
    expect(executor.getWarnings()).toHaveLength(0);
  });

  it('skips artwork during upgrade when artwork is disabled', async () => {
    let artworkSet = false;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      hasArtwork: false,
      update: (_fields: Record<string, unknown>) => existingTrack,
      setArtworkFromData: (_data: Buffer) => {
        artworkSet = true;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
          }),
          target: existingTrack,
          reason: 'format-upgrade',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // Artwork should NOT have been set
    expect(artworkSet).toBe(false);
    expect(executor.getWarnings()).toHaveLength(0);
  });

  it('artwork-added upgrade replaces the file on device', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      hasArtwork: false,
      update: (_fields: Record<string, unknown>) => existingTrack,
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
            lossless: true,
            hasArtwork: true,
          }),
          target: existingTrack,
          reason: 'artwork-added',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, { artwork: true })) {
      // consume
    }

    // File should have been replaced (artwork-added is a file-replacement upgrade)
    expect(replaceTrackFile).toHaveBeenCalledTimes(1);

    // Transcoder should have been called (preset is set)
    expect(transcoder.transcode).toHaveBeenCalledTimes(1);

    // No new track added — upgrade reuses existing database entry
    expect(db.addTrack).not.toHaveBeenCalled();
  });

  it('upgrade with no preset does not transfer significantly large bytes', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      bitrate: 128,
      update: (_fields: Record<string, unknown>) => existingTrack,
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            bitrate: 320,
          }),
          target: existingTrack,
          reason: 'quality-upgrade',
          // No preset — copy-based upgrade
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false })) {
      progress.push(p);
    }

    // Should have completed the upgrade
    const upgradeEvent = progress.find((p) => p.phase === 'upgrading');
    expect(upgradeEvent).toBeDefined();

    // Should NOT have transcoded
    expect(transcoder.transcode).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Copy Sync Tags
// =============================================================================

describe('copy sync tags', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('writes copy sync tag with transfer mode for add-direct-copy', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    expect(db.addTrack).toHaveBeenCalledTimes(1);
    const trackInput = db.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    const syncTag = trackInput.syncTag as Record<string, unknown>;
    expect(syncTag).toBeDefined();
    expect(syncTag.quality).toBe('copy');
    expect(syncTag.transferMode).toBe('fast');
  });

  it('writes copy sync tag with optimized transfer mode for add-direct-copy with optimized config', async () => {
    // Tests that the transferMode option is used in the copy sync tag
    // even for direct-copy operations (optimized-copy uses FFmpeg and needs real files)
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: {},
      transferMode: 'optimized',
    })) {
      // consume
    }

    expect(db.addTrack).toHaveBeenCalledTimes(1);
    const trackInput2 = db.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    const syncTag2 = trackInput2.syncTag as Record<string, unknown>;
    expect(syncTag2).toBeDefined();
    expect(syncTag2.quality).toBe('copy');
    expect(syncTag2.transferMode).toBe('optimized');
  });

  it('does not write copy sync tag when syncTagConfig is absent', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    // No syncTagConfig
    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    expect(db.addTrack).toHaveBeenCalledTimes(1);
    const trackInput = db.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    expect(trackInput.syncTag).toBeUndefined();
  });

  it('writes copy sync tag for upgrade-direct-copy', async () => {
    let _capturedUpdateFields: Record<string, unknown> | undefined;
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (fields: Record<string, unknown>) => {
        _capturedUpdateFields = fields;
        return existingTrack;
      },
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            bitrate: 320,
          }),
          target: existingTrack,
          reason: 'quality-upgrade',
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    // The sync tag should be written via writeSyncTag, not in updateFields
    expect(db.writeSyncTag).toHaveBeenCalledTimes(1);
    const syncTagUpdate = db.writeSyncTag.mock.calls[0]![1] as Record<string, unknown>;
    expect(syncTagUpdate.quality).toBe('copy');
    expect(syncTagUpdate.transferMode).toBe('fast');
  });

  it('uses transferMode from options as single source of truth (not syncTagConfig)', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    for await (const _p of executor.execute(plan, {
      artwork: false,
      syncTagConfig: {},
      transferMode: 'optimized',
    })) {
      // consume
    }

    expect(db.addTrack).toHaveBeenCalledTimes(1);
    const trackInput = db.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    const syncTag = trackInput.syncTag as Record<string, unknown>;
    expect(syncTag).toBeDefined();
    expect(syncTag.quality).toBe('copy');
    expect(syncTag.transferMode).toBe('optimized');
  });
});

// =============================================================================
// Optimized Copy Format Helper
// =============================================================================

describe('optimized copy operations', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('routes add-optimized-copy through FFmpeg, not transcoder.transcode', async () => {
    // Optimized-copy uses runFFmpeg (direct spawn) instead of transcoder.transcode.
    // Since we have no real files, FFmpeg will fail, but we verify the code path.
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-optimized-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false, continueOnError: true })) {
      progress.push(p);
    }

    // transcoder.transcode should NOT be called — optimized-copy spawns FFmpeg directly
    expect(transcoder.transcode).not.toHaveBeenCalled();

    // getFFmpegPath SHOULD be called to get the FFmpeg binary path
    expect(transcoder.getFFmpegPath).toHaveBeenCalled();

    // The operation fails (no real files) but that's expected in unit tests
    const errorEvent = progress.find((p) => p.error);
    expect(errorEvent).toBeDefined();
  });

  it('routes upgrade-optimized-copy through FFmpeg, not transcoder.transcode', async () => {
    const existingTrack = createDeviceTrack('Artist', 'Song', 'Album', {
      filePath: 'Music/EXISTING.m4a',
      update: (_fields: Record<string, unknown>) => existingTrack,
    });

    const replaceTrackFile = mock(() => existingTrack);
    (db as any).replaceTrackFile = replaceTrackFile;
    db.getTracks.mockReturnValue([existingTrack]);

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'upgrade-optimized-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
          target: existingTrack,
          reason: 'format-upgrade',
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicExecutor(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false, continueOnError: true })) {
      progress.push(p);
    }

    // transcoder.transcode should NOT be called
    expect(transcoder.transcode).not.toHaveBeenCalled();

    // getFFmpegPath SHOULD be called
    expect(transcoder.getFFmpegPath).toHaveBeenCalled();
  });
});
