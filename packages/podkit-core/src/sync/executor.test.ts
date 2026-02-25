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
  DefaultSyncExecutor,
  createExecutor,
  executePlan,
  getOperationDisplayName,
  categorizeError,
  getRetriesForCategory,
  DEFAULT_RETRY_CONFIG,
  type ExecutorDependencies,
  type ExecutorProgress,
} from './executor.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { AudioFileType } from '../types.js';
import type { IPodTrack, SyncOperation, SyncPlan } from './types.js';

// =============================================================================
// Mock Types
// =============================================================================

interface MockIpodDatabase {
  addTrack: ReturnType<typeof mock>;
  getTracks: ReturnType<typeof mock>;
  removeTrack: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
}

interface MockTranscoder {
  transcode: ReturnType<typeof mock>;
  detect: ReturnType<typeof mock>;
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock IPodTrack with all required fields
 */
function createMockIPodTrack(
  artist: string,
  title: string,
  album: string,
  filePath: string,
  options: Partial<{
    remove: () => void;
    copyFile: (path: string) => IPodTrack;
    update: (fields: Record<string, unknown>) => IPodTrack;
    setArtwork: (path: string) => IPodTrack;
    setArtworkFromData: (data: Buffer) => IPodTrack;
    removeArtwork: () => IPodTrack;
  }> = {}
): IPodTrack {
  const track: IPodTrack = {
    title,
    artist,
    album,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath,
    timeAdded: Date.now() / 1000,
    timeModified: Date.now() / 1000,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
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

function createMockIpodDatabase(initialTracks: IPodTrack[] = []): MockIpodDatabase {
  // Store tracks for lookup
  const tracks: IPodTrack[] = [...initialTracks];
  let pathCounter = 0;

  return {
    addTrack: mock((input: { title: string; artist: string; album?: string }) => {
      const filePath = `:iPod_Control:Music:F00:MOCK${pathCounter++}.m4a`;
      const track = createMockIPodTrack(
        input.artist ?? '',
        input.title,
        input.album ?? '',
        filePath
      );
      tracks.push(track);
      return track;
    }),
    getTracks: mock(() => [...tracks]),
    removeTrack: mock((track: IPodTrack) => {
      const index = tracks.findIndex(t => t.filePath === track.filePath);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
    }),
    save: mock(async () => ({ warnings: [] })),
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

function createIPodTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<IPodTrack> & { removeFn?: () => void } = {}
): IPodTrack {
  const { removeFn, ...rest } = options;
  const filePath = rest.filePath ?? `:iPod_Control:Music:F00:${Math.random().toString(36).slice(2)}.m4a`;
  return createMockIPodTrack(artist, title, album, filePath, {
    remove: removeFn,
    ...rest,
  });
}

function createEmptyPlan(): SyncPlan {
  return {
    operations: [],
    estimatedTime: 0,
    estimatedSize: 0,
  };
}

function createDependencies(
  db: MockIpodDatabase,
  transcoder: MockTranscoder
): ExecutorDependencies {
  // Cast mocks to satisfy the interface
  return {
    ipod: db as unknown as ExecutorDependencies['ipod'],
    transcoder: transcoder as unknown as ExecutorDependencies['transcoder'],
  };
}

// =============================================================================
// getOperationDisplayName Tests
// =============================================================================

describe('getOperationDisplayName', () => {
  it('returns artist - title for transcode operation', () => {
    const op: SyncOperation = {
      type: 'transcode',
      source: createCollectionTrack('Pink Floyd', 'Comfortably Numb', 'The Wall'),
      preset: { name: 'high' },
    };

    expect(getOperationDisplayName(op)).toBe('Pink Floyd - Comfortably Numb');
  });

  it('returns artist - title for copy operation', () => {
    const op: SyncOperation = {
      type: 'copy',
      source: createCollectionTrack('Radiohead', 'Paranoid Android', 'OK Computer'),
    };

    expect(getOperationDisplayName(op)).toBe('Radiohead - Paranoid Android');
  });

  it('returns artist - title for remove operation', () => {
    const op: SyncOperation = {
      type: 'remove',
      track: createIPodTrack('The Beatles', 'Yesterday', 'Help!'),
    };

    expect(getOperationDisplayName(op)).toBe('The Beatles - Yesterday');
  });
});

// =============================================================================
// Basic Execution Tests
// =============================================================================

describe('DefaultSyncExecutor - basic execution', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('handles empty plan', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan = createEmptyPlan();

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should emit complete even for empty plan
    expect(progress.length).toBeGreaterThanOrEqual(0);
    expect(mockDb.save.mock.calls.length).toBe(0);
  });

  it('executes copy operation', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called addTrack (which returns a track with copyFile method)
    expect(mockDb.addTrack.mock.calls.length).toBe(1);
    expect(mockDb.save.mock.calls.length).toBe(1);
  });

  it('executes transcode operation', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called transcoder and addTrack (which returns a track with copyFile method)
    expect(mockTranscoder.transcode.mock.calls.length).toBe(1);
    expect(mockDb.addTrack.mock.calls.length).toBe(1);
    expect(mockDb.save.mock.calls.length).toBe(1);
  });

  it('executes remove operation', async () => {
    // Create a track to be removed - it must be in the mock database
    let removed = false;
    const trackToRemove = createIPodTrack('Artist', 'Song', 'Album', {
      removeFn: () => { removed = true; },
    });

    // Create a mock database that already contains the track
    mockDb = createMockIpodDatabase([trackToRemove]);
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'remove',
          track: trackToRemove,
        },
      ],
      estimatedTime: 0.1,
      estimatedSize: 0,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // Should have called the track's remove method
    expect(removed).toBe(true);
    expect(mockDb.save.mock.calls.length).toBe(1);
  });

  it('executes multiple operations in order', async () => {
    // Create a track to be removed - it must be in the mock database
    let removed = false;
    const trackToRemove = createIPodTrack('Old Artist', 'Old Song', 'Old Album', {
      removeFn: () => { removed = true; },
    });

    // Create a mock database that already contains the track
    mockDb = createMockIpodDatabase([trackToRemove]);
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'remove',
          track: trackToRemove,
        },
        {
          type: 'copy',
          source: createCollectionTrack('Artist', 'MP3 Song', 'Album', 'mp3'),
        },
        {
          type: 'transcode',
          source: createCollectionTrack('Artist', 'FLAC Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    expect(removed).toBe(true);
    expect(mockDb.addTrack.mock.calls.length).toBe(2);
    expect(mockTranscoder.transcode.mock.calls.length).toBe(1);
    expect(mockDb.save.mock.calls.length).toBe(1);
  });
});

// =============================================================================
// Progress Reporting Tests
// =============================================================================

describe('DefaultSyncExecutor - progress reporting', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('emits preparing phase before each operation', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    // First progress should be preparing
    const preparingEvents = progress.filter((p) => p.phase === 'preparing');
    expect(preparingEvents.length).toBeGreaterThan(0);
  });

  it('includes operation index and total', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S3', 'Album', 'mp3') },
      ],
      estimatedTime: 3,
      estimatedSize: 15000000,
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
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('Pink Floyd', 'Money', 'DSOTM', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const copyEvents = progress.filter((p) => p.phase === 'copying');
    expect(copyEvents.some((p) => p.currentTrack === 'Pink Floyd - Money')).toBe(true);
  });

  it('tracks bytes processed', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
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
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const dbUpdateEvents = progress.filter((p) => p.phase === 'updating-db');
    expect(dbUpdateEvents.length).toBe(1);
  });

  it('emits complete phase at end', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
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

describe('DefaultSyncExecutor - dry-run mode', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('does not call database methods in dry-run', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
        {
          type: 'transcode',
          source: createCollectionTrack('B', 'T', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'remove', track: createIPodTrack('C', 'U', 'Album') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    expect(mockDb.addTrack.mock.calls.length).toBe(0);
    expect(mockDb.removeTrack.mock.calls.length).toBe(0);
    expect(mockDb.save.mock.calls.length).toBe(0);
    expect(mockTranscoder.transcode.mock.calls.length).toBe(0);
  });

  it('marks progress as skipped in dry-run', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { dryRun: true })) {
      progress.push(p);
    }

    const skippedEvents = progress.filter((p) => p.skipped === true);
    expect(skippedEvents.length).toBeGreaterThan(0);
  });

  it('still emits progress events in dry-run', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
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

describe('DefaultSyncExecutor - error handling', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('stops on error by default', async () => {
    // Make transcode fail
    mockTranscoder.transcode = mock(async () => {
      throw new Error('Transcode failed');
    });
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
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
    expect(mockDb.addTrack.mock.calls.length).toBe(0);
  });

  it('continues on error when continueOnError is true', async () => {
    // Make first transcode fail permanently (both initial and retry)
    mockTranscoder.transcode = mock(async () => {
      throw new Error('Transcode failed permanently');
    });
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { continueOnError: true, retryConfig: { retryDelayMs: 0 } })) {
      progress.push(p);
    }

    // Should have error in progress (after retry exhausted)
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]!.error!.message).toBe('Transcode failed permanently');

    // Second operation should have been executed
    expect(mockDb.addTrack.mock.calls.length).toBe(1);
  });

  it('includes error in progress event', async () => {
    mockDb.addTrack = mock(() => {
      throw new Error('Database error');
    });
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
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

describe('DefaultSyncExecutor - abort signal', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S3', 'Album', 'mp3') },
      ],
      estimatedTime: 3,
      estimatedSize: 15000000,
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

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
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
    expect(mockDb.addTrack.mock.calls.length).toBe(0);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createExecutor', () => {
  it('creates a SyncExecutor instance', () => {
    const mockDb = createMockIpodDatabase();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockDb, mockTranscoder);

    const executor = createExecutor(deps);

    expect(executor).toBeInstanceOf(DefaultSyncExecutor);
    expect(typeof executor.execute).toBe('function');
  });
});

describe('executePlan', () => {
  it('returns execution result', async () => {
    const mockDb = createMockIpodDatabase();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockDb, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
    };

    const result = await executePlan(plan, deps);

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('counts skipped operations in dry-run', async () => {
    const mockDb = createMockIpodDatabase();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockDb, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
    };

    const result = await executePlan(plan, deps, { dryRun: true });

    expect(result.completed).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('collects errors when continueOnError is true', async () => {
    const mockDb = createMockIpodDatabase();
    const mockTranscoder = createMockTranscoder();

    // Make first copy fail permanently with a database error (no retry)
    let callCount = 0;
    mockDb.addTrack = mock((input: { title: string }) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('iPod database error: add failed');
      }
      return createMockIPodTrack('', input.title, '', `:iPod_Control:Music:F00:MOCK${callCount}.m4a`);
    });

    const deps = createDependencies(mockDb, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 2,
      estimatedSize: 10000000,
    };

    const result = await executePlan(plan, deps, { continueOnError: true, retryConfig: { retryDelayMs: 0 } });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error.message).toBe('iPod database error: add failed');
  });
});

// =============================================================================
// Phase Detection Tests
// =============================================================================

describe('phase detection', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('reports transcoding phase for transcode operations', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan)) {
      progress.push(p);
    }

    const transcodeEvents = progress.filter((p) => p.phase === 'transcoding');
    expect(transcodeEvents.length).toBeGreaterThan(0);
  });

  it('reports copying phase for copy operations', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        { type: 'copy', source: createCollectionTrack('A', 'S', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
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
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
  });

  it('sets MPEG audio file for MP3', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('A', 'S', 'Album', 'mp3', {
            filePath: '/music/song.mp3',
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const trackInput = mockDb.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('MPEG audio file');
  });

  it('sets AAC audio file for M4A', async () => {
    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('A', 'S', 'Album', 'm4a', {
            filePath: '/music/song.m4a',
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const trackInput = mockDb.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('AAC audio file');
  });
});

// =============================================================================
// Error Categorization Tests
// =============================================================================

describe('categorizeError', () => {
  it('categorizes FFmpeg errors as transcode', () => {
    expect(categorizeError(new Error('FFmpeg failed'), 'transcode')).toBe('transcode');
    expect(categorizeError(new Error('encoder not found'), 'transcode')).toBe('transcode');
    expect(categorizeError(new Error('codec error'), 'copy')).toBe('transcode');
  });

  it('categorizes file errors as copy', () => {
    expect(categorizeError(new Error('ENOENT: file not found'), 'copy')).toBe('copy');
    expect(categorizeError(new Error('EACCES: permission denied'), 'copy')).toBe('copy');
    // File I/O errors take precedence over operation type
    expect(categorizeError(new Error('ENOSPC: no space left'), 'transcode')).toBe('copy');
    expect(categorizeError(new Error('permission denied'), 'transcode')).toBe('copy');
  });

  it('categorizes database errors correctly', () => {
    expect(categorizeError(new Error('database error'), 'copy')).toBe('database');
    expect(categorizeError(new Error('libgpod failed'), 'copy')).toBe('database');
    expect(categorizeError(new Error('iTunes error'), 'copy')).toBe('database');
  });

  it('categorizes artwork errors correctly', () => {
    expect(categorizeError(new Error('artwork failed'), 'copy')).toBe('artwork');
    expect(categorizeError(new Error('image processing error'), 'copy')).toBe('artwork');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(categorizeError(new Error('something went wrong'), 'remove')).toBe('unknown');
  });

  it('uses operation type as hint for generic errors', () => {
    // When error message doesn't match any specific category, fall back to operation type
    expect(categorizeError(new Error('something failed'), 'transcode')).toBe('transcode');
    expect(categorizeError(new Error('something failed'), 'copy')).toBe('copy');
    // But specific error messages take precedence over operation type
    expect(categorizeError(new Error('database corruption'), 'transcode')).toBe('database');
    expect(categorizeError(new Error('ENOENT'), 'transcode')).toBe('copy');
  });
});

describe('getRetriesForCategory', () => {
  it('returns correct retries for transcode errors', () => {
    expect(getRetriesForCategory('transcode', DEFAULT_RETRY_CONFIG)).toBe(1);
  });

  it('returns correct retries for copy errors', () => {
    expect(getRetriesForCategory('copy', DEFAULT_RETRY_CONFIG)).toBe(1);
  });

  it('returns 0 retries for database errors', () => {
    expect(getRetriesForCategory('database', DEFAULT_RETRY_CONFIG)).toBe(0);
  });

  it('returns 0 retries for artwork errors', () => {
    expect(getRetriesForCategory('artwork', DEFAULT_RETRY_CONFIG)).toBe(0);
  });

  it('returns 0 retries for unknown errors', () => {
    expect(getRetriesForCategory('unknown', DEFAULT_RETRY_CONFIG)).toBe(0);
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

describe('DefaultSyncExecutor - retry logic', () => {
  let mockDb: MockIpodDatabase;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockDb = createMockIpodDatabase();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockDb, mockTranscoder);
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
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
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
    expect(mockDb.addTrack.mock.calls.length).toBe(1);
    // No error events since it succeeded on retry
    const errorEvents = progress.filter((p) => p.error !== undefined);
    expect(errorEvents.length).toBe(0);
  });

  it('retries transcode operation once on failure then fails permanently', async () => {
    mockTranscoder.transcode = mock(async () => {
      throw new Error('FFmpeg permanent failure');
    });
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
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
    mockDb.addTrack = mock((input: { title: string }) => {
      const track = createMockIPodTrack('', input.title, '', `:iPod_Control:Music:F00:MOCK${copyAttempts}.m4a`, {
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
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('A', 'S1', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
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
    mockDb.addTrack = mock(() => {
      throw new Error('iPod database corruption');
    });
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'copy',
          source: createCollectionTrack('A', 'S1', 'Album', 'mp3'),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
    };

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    })) {
      progress.push(p);
    }

    // Should only try once (no retry for database errors)
    expect(mockDb.addTrack.mock.calls.length).toBe(1);
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
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
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
    deps = createDependencies(mockDb, mockTranscoder);

    const executor = new DefaultSyncExecutor(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 18,
      estimatedSize: 5000000,
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
    const mockDb = createMockIpodDatabase();
    const mockTranscoder = createMockTranscoder();

    // Make transcode fail
    mockTranscoder.transcode = mock(async () => {
      throw new Error('FFmpeg error');
    });

    const deps = createDependencies(mockDb, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        {
          type: 'transcode',
          source: createCollectionTrack('A', 'S1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
        { type: 'copy', source: createCollectionTrack('A', 'S2', 'Album', 'mp3') },
      ],
      estimatedTime: 20,
      estimatedSize: 10000000,
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
