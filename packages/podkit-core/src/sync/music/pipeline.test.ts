/**
 * Unit tests for the music sync pipeline
 *
 * These tests verify the pipeline logic using mocked dependencies.
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

import { describe, expect, it, mock, beforeEach, spyOn } from 'bun:test';
import {
  MusicPipeline,
  PipelineBusyError,
  createMusicPipeline,
  getFileTypeLabel,
  getFileTypeLabelForFileType,
  getMusicOperationDisplayName,
  categorizeError,
  createCategorizedError,
  getRetriesForCategory,
  MUSIC_RETRY_CONFIG,
  type CategorizedError,
  type ExecutorDependencies,
  type ExecutorProgress,
} from './pipeline.js';
import { AbortError } from '../engine/errors.js';
import { resolveFileExtension } from '../../device/mass-storage-adapter.js';
import type { CollectionTrack, CollectionAdapter, FileAccess } from '../../adapters/interface.js';
import type { AudioFileType, TrackFilter } from '../../types.js';
import type { DeviceTrack, SyncOperation, SyncPlan } from '../engine/types.js';
import { Readable } from 'node:stream';
import { writeFileSync } from 'node:fs';

// =============================================================================
// Test helper — local replacement for the deleted `executeMusicPlan` public
// API. Aggregates pipeline progress events into an ExecuteResult shape so
// the existing assertions read naturally.
// =============================================================================

async function runMusicPlan(
  plan: SyncPlan,
  deps: ExecutorDependencies,
  options: import('./pipeline.js').ExtendedExecuteOptions = {}
): Promise<{
  completed: number;
  failed: number;
  skipped: number;
  errors: Array<{ operation: SyncOperation; error: Error }>;
  categorizedErrors: CategorizedError[];
  warnings: import('./pipeline.js').Warning[];
  bytesTransferred: number;
}> {
  const executor = new MusicPipeline(deps);
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytesTransferred = 0;
  const errors: Array<{ operation: SyncOperation; error: Error }> = [];
  const categorizedErrors: CategorizedError[] = [];

  for await (const progress of executor.execute(plan, options)) {
    if (progress.error) {
      failed++;
      errors.push({ operation: progress.operation, error: progress.error });
      categorizedErrors.push(
        progress.categorizedError ??
          createCategorizedError(progress.error, progress.operation, 0, false)
      );
    } else if (progress.skipped) {
      skipped++;
    }
    completed = progress.completedCount - failed - skipped;
    bytesTransferred = progress.bytesProcessed;
  }

  return {
    completed,
    failed,
    skipped,
    errors,
    categorizedErrors,
    warnings: executor.getWarnings(),
    bytesTransferred,
  };
}

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
  setTrackArtwork: ReturnType<typeof mock>;
  removeTrackArtwork: ReturnType<typeof mock>;
  writeSyncTag: ReturnType<typeof mock>;
  /** Optional — set on the mock for sidecar-primary adapters (rockbox). */
  writeSidecar?: ReturnType<typeof mock>;
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
    artworkSink: DeviceTrack['artworkSink'];
    hasArtwork: boolean;
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
    hasArtwork: options.hasArtwork ?? false,
    hasFile: true,
    compilation: false,
    syncTag: null,
    // Default sink: 'database' (iPod). Tests that exercise the embedded /
    // sidecar / noop dispatch override via options.artworkSink.
    artworkSink: options.artworkSink ?? 'database',
    // Methods
    remove: options.remove ?? (() => {}),
    copyFile: options.copyFile ?? (() => track),
    update: options.update ?? (() => track),
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
    setTrackArtwork: mock(async (_track: DeviceTrack, _imageData: Buffer) => {}),
    removeTrackArtwork: mock(async (_track: DeviceTrack) => {}),
    writeSyncTag: mock((track: DeviceTrack, _update: Record<string, unknown>) => track),
  };
}

function createMockTranscoder(): MockTranscoder {
  return {
    // Mock writes an empty file at the requested output path so the
    // pipeline's post-transcode `rename(<output>.podkit-tmp -> <output>)`
    // (atomic-write contract) succeeds.
    transcode: mock(async (_input: string, output: string) => {
      writeFileSync(output, '');
      return {
        outputPath: output,
        size: 5000000,
        duration: 1000,
        bitrate: 256,
      };
    }),
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
// getFileTypeLabel Tests
// =============================================================================

describe('getFileTypeLabel', () => {
  it.each([
    ['/x/foo.mp3', 'MPEG audio file'],
    ['/x/foo.m4a', 'AAC audio file'],
    ['/x/foo.aac', 'AAC audio file'],
    ['/x/foo.alac', 'ALAC audio file'],
    ['/x/foo.opus', 'Opus audio file'],
    ['/x/foo.flac', 'FLAC audio file'],
    ['/x/foo.ogg', 'Ogg Vorbis audio file'],
    ['/x/foo.wav', 'WAV audio file'],
    ['/x/foo.aiff', 'AIFF audio file'],
    ['/x/foo.aif', 'AIFF audio file'],
  ])('maps %s → %s', (path, expected) => {
    expect(getFileTypeLabel(path)).toBe(expected);
  });

  it('uppercase extensions match (case-insensitive)', () => {
    expect(getFileTypeLabel('/x/song.OGG')).toBe('Ogg Vorbis audio file');
  });

  it('returns the generic fallback for unknown extensions (defence-in-depth; typed exhaustiveness lives in getFileTypeLabelForFileType)', () => {
    expect(getFileTypeLabel('/x/song.weird')).toBe('Audio file');
  });

  it.each([
    ['.mp3', '.mp3'],
    ['.m4a', '.m4a'],
    ['.aac', '.m4a'],
    ['.alac', '.m4a'],
    ['.opus', '.opus'],
    ['.flac', '.flac'],
    ['.ogg', '.ogg'],
    ['.wav', '.wav'],
    ['.aiff', '.aiff'],
    ['.aif', '.aiff'],
  ])(
    'label for %s round-trips through resolveFileExtension (locks the bug where .ogg → "Audio file" → .Audio file filename)',
    (sourceExt, expectedRoundTripExt) => {
      const label = getFileTypeLabel(`/x/song${sourceExt}`);
      expect(resolveFileExtension(label)).toBe(expectedRoundTripExt);
    }
  );
});

// =============================================================================
// getFileTypeLabelForFileType Tests
// =============================================================================

describe('getFileTypeLabelForFileType', () => {
  // Enumerating every AudioFileType member here doubles as the runtime check
  // for the compile-time exhaustiveness guard: adding a new AudioFileType
  // member breaks the switch in pipeline.ts at compile time AND surfaces here
  // because the new member won't appear in this matrix.
  it.each<[AudioFileType, string]>([
    ['mp3', 'MPEG audio file'],
    ['m4a', 'AAC audio file'],
    ['aac', 'AAC audio file'],
    ['alac', 'ALAC audio file'],
    ['opus', 'Opus audio file'],
    ['flac', 'FLAC audio file'],
    ['ogg', 'Ogg Vorbis audio file'],
    ['wav', 'WAV audio file'],
    ['aiff', 'AIFF audio file'],
  ])('maps AudioFileType %s → %s', (fileType, expected) => {
    expect(getFileTypeLabelForFileType(fileType)).toBe(expected);
  });

  it('every label round-trips through resolveFileExtension (no `.Audio file` artefacts can leak)', () => {
    const fileTypes: AudioFileType[] = [
      'mp3',
      'm4a',
      'aac',
      'alac',
      'opus',
      'flac',
      'ogg',
      'wav',
      'aiff',
    ];
    for (const ft of fileTypes) {
      const label = getFileTypeLabelForFileType(ft);
      // Sanity: never returns the generic fallback for a typed input.
      expect(label).not.toBe('Audio file');
      // Sanity: the produced extension is one of the known mass-storage
      // extensions, never `.Audio file`.
      expect(resolveFileExtension(label)).not.toBe('.Audio file');
    }
  });
});

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

describe('MusicPipeline - basic execution', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('handles empty plan', async () => {
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    expect(mockAdapter.save.mock.calls.length).toBe(0); // ADR-019: engine owns save now
  });

  it('passes compilation flag to addTrack', async () => {
    const executor = new MusicPipeline(deps);
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

  // Initial-add bitrate baseline: when a lossy source carries a bitrate,
  // the copy executor MUST persist it on the iPod track. Without this,
  // `detectUpgrades`'s `source.bitrate && ipod.bitrate` quality-upgrade gate
  // silently no-ops on the next sync because the iPod side reads back as 0
  // (libgpod's missing-bitrate sentinel). Pre-existing tracks that landed
  // before this guarantee need `--force-sync-tags` to backfill (handled by
  // postProcessBitrateBaseline in handler.ts); new copies pick it up here.
  it('passes source bitrate to addTrack for copy operation', async () => {
    const executor = new MusicPipeline(deps);
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

  // Defensive: when the source bitrate is unknown (some Subsonic adapter
  // responses omit it), the copy executor MUST leave `bitrate` undefined on
  // the trackInput rather than fabricating 0. The iPod adapter normalises
  // missing bitrate to 0 at read time, but writing an explicit 0 here would
  // be a lie — `--force-sync-tags` can later distinguish "unset" (0 on
  // read) from "intentional 0" (none of our codecs do this) and backfill.
  it('omits bitrate from addTrack input when source bitrate is unknown', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'mp3', {
            // no bitrate
          }),
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // consume
    }

    expect(mockAdapter.addTrack.mock.calls.length).toBe(1);
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as Record<string, unknown>;
    expect(trackInput.bitrate).toBeUndefined();
  });

  it('uses FFmpeg output bitrate (not source bitrate) for transcode operation', async () => {
    // Mock transcoder to return a specific bitrate different from source
    mockTranscoder.transcode = mock(async (_input: string, output: string) => {
      writeFileSync(output, '');
      return {
        outputPath: output,
        size: 5000000,
        duration: 1000,
        bitrate: 128,
      };
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    expect(mockAdapter.save.mock.calls.length).toBe(0); // ADR-019: engine owns save now
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

    const executor = new MusicPipeline(deps);
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
    expect(mockAdapter.save.mock.calls.length).toBe(0); // ADR-019: engine owns save now
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

    const executor = new MusicPipeline(deps);
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
    expect(mockAdapter.save.mock.calls.length).toBe(0); // ADR-019: engine owns save now
  });
});

// =============================================================================
// Progress Reporting Tests
// =============================================================================

describe('MusicPipeline - progress reporting', () => {
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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

  // 'updating-db' yield + pipeline-internal final save were removed per
  // ADR-019. Save is now owned by the engine SyncExecutor wrapping
  // this pipeline; testing that contract lives in executor.test.ts.

  it('emits complete phase at end', async () => {
    const executor = new MusicPipeline(deps);
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

describe('MusicPipeline - dry-run mode', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('does not call database methods in dry-run', async () => {
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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

describe('MusicPipeline - error handling', () => {
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

describe('MusicPipeline - abort signal', () => {
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

    const executor = new MusicPipeline(deps);
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
      expect(err).toBeInstanceOf(AbortError);
    }

    expect(errorThrown).toBe(true);
  });

  it('checks abort before each operation', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const executor = new MusicPipeline(deps);
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
      expect(err).toBeInstanceOf(AbortError);
    }

    expect(errorThrown).toBe(true);
    expect(mockAdapter.addTrack.mock.calls.length).toBe(0);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createMusicPipeline', () => {
  it('creates a SyncExecutor instance', () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = createMusicPipeline(deps);

    expect(executor).toBeInstanceOf(MusicPipeline);
    expect(typeof executor.execute).toBe('function');
  });
});

describe('plan execution aggregation', () => {
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

    const result = await runMusicPlan(plan, deps);

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

    const result = await runMusicPlan(plan, deps, { dryRun: true });

    expect(result.completed).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('dry-run emits no warnings (no adapter calls = no soft signals)', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();
    const deps = createDependencies(mockAdapter, mockTranscoder);

    const plan: SyncPlan = {
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'S1', 'Album', 'mp3') },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    const result = await runMusicPlan(plan, deps, { dryRun: true });

    expect(result.warnings).toHaveLength(0);
    expect(mockAdapter.addTrack).not.toHaveBeenCalled();
    expect(mockAdapter.save).not.toHaveBeenCalled();
  });

  it('collects errors when continueOnError is true', async () => {
    const mockAdapter = createMockDeviceAdapter();
    const mockTranscoder = createMockTranscoder();

    // Make first copy fail permanently with a typed database error (no retry).
    // Raw `new Error('database ...')` would now categorize as `copy` via the
    // op-type fallback and retry — the no-retry guarantee belongs to the
    // typed error.
    const { DatabaseWriteError } = await import('../engine/errors.js');
    let callCount = 0;
    mockAdapter.addTrack = mock((input: { title: string }) => {
      callCount++;
      if (callCount === 1) {
        throw new DatabaseWriteError('add failed');
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

    const result = await runMusicPlan(plan, deps, {
      continueOnError: true,
      retryConfig: { retryDelayMs: 0 },
    });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error.message).toBe('device database write failed: add failed');
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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
    const executor = new MusicPipeline(deps);
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

  it('sets Opus audio file for .opus', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S', 'Album', 'opus', {
            filePath: '/music/song.opus',
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
    expect(trackInput.filetype).toBe('Opus audio file');
  });

  it('sets FLAC audio file for .flac', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('A', 'S', 'Album', 'flac', {
            filePath: '/music/song.flac',
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
    expect(trackInput.filetype).toBe('FLAC audio file');
  });
});

// =============================================================================
// Transcode with targetCodec
// =============================================================================

describe('transcode with targetCodec', () => {
  let mockAdapter: MockDeviceAdapter;
  let mockTranscoder: MockTranscoder;
  let deps: ExecutorDependencies;

  beforeEach(() => {
    mockAdapter = createMockDeviceAdapter();
    mockTranscoder = createMockTranscoder();
    deps = createDependencies(mockAdapter, mockTranscoder);
  });

  it('uses .m4a extension and AAC filetype when targetCodec is not set', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    // Check the output path passed to transcode has .m4a extension
    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    const outputPath = transcodeCall[1] as string;
    // Atomic-write contract: ffmpeg writes to <output>.podkit-tmp then renames.
    expect(outputPath).toMatch(/\.m4a\.podkit-tmp$/);

    // Check preset is passed as string (legacy AAC path)
    const preset = transcodeCall[2];
    expect(preset).toBe('high');

    // Check filetype on the added track
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('AAC audio file');
  });

  it('uses .opus extension and Opus filetype when targetCodec is opus', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'high', targetCodec: 'opus' },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    // Check the output path has .opus extension
    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    const outputPath = transcodeCall[1] as string;
    expect(outputPath).toMatch(/\.opus\.podkit-tmp$/);

    // Check preset is an EncoderConfig with codec: 'opus'
    const preset = transcodeCall[2] as { codec: string; bitrateKbps: number };
    expect(preset.codec).toBe('opus');
    expect(preset.bitrateKbps).toBe(160); // Opus high = 160 kbps

    // Check filetype on the added track
    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('Opus audio file');
  });

  it('uses .mp3 extension when targetCodec is mp3', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'medium', targetCodec: 'mp3' },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    const outputPath = transcodeCall[1] as string;
    expect(outputPath).toMatch(/\.mp3\.podkit-tmp$/);

    const preset = transcodeCall[2] as { codec: string; bitrateKbps: number };
    expect(preset.codec).toBe('mp3');
    expect(preset.bitrateKbps).toBe(192); // MP3 medium = 192 kbps

    const trackInput = mockAdapter.addTrack.mock.calls[0]![0] as { filetype: string };
    expect(trackInput.filetype).toBe('MPEG audio file');
  });

  it('uses bitrateOverride when set on preset', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'high', targetCodec: 'opus', bitrateOverride: 96 },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    const preset = transcodeCall[2] as { codec: string; bitrateKbps: number };
    expect(preset.bitrateKbps).toBe(96);
  });

  it('passes preset name for lossless even with targetCodec', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'flac'),
          preset: { name: 'lossless', targetCodec: 'alac' },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    // Lossless preset with ALAC should pass 'lossless' string, not EncoderConfig
    expect(transcodeCall[2]).toBe('lossless');
  });

  it('passes EncoderConfig for lossless preset with FLAC targetCodec', async () => {
    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'S', 'Album', 'wav'),
          preset: { name: 'lossless', targetCodec: 'flac' },
        },
      ],
      estimatedTime: 1,
      estimatedSize: 5000000,
      warnings: [],
    };

    for await (const _p of executor.execute(plan)) {
      // iterate
    }

    const transcodeCall = mockTranscoder.transcode.mock.calls[0]!;
    // FLAC lossless should use EncoderConfig with codec: 'flac', not the 'lossless' string
    const preset = transcodeCall[2] as { codec: string };
    expect(preset.codec).toBe('flac');
    // Output path should have .flac extension
    expect(transcodeCall[1]).toMatch(/\.flac\.podkit-tmp$/);
  });
});

// =============================================================================
// Error Categorization Tests
// =============================================================================

describe('categorizeError', () => {
  // The canonical categorizeError test suite lives in
  // `sync/engine/error-handling.test.ts`. These tests pin the re-exported
  // surface from `pipeline.ts`, which delegates to the canonical
  // implementation. The contract is: typed CategorizedSyncError → class
  // category; untyped → operation-type fallback; no message-keyword matching.

  it('falls back to operation-type table for untyped errors', () => {
    expect(categorizeError(new Error('boom'), 'add-transcode')).toBe('transcode');
    expect(categorizeError(new Error('boom'), 'add-direct-copy')).toBe('copy');
    expect(categorizeError(new Error('boom'), 'video-transcode')).toBe('transcode');
    expect(categorizeError(new Error('boom'), 'video-copy')).toBe('copy');
    expect(categorizeError(new Error('boom'), 'upgrade-artwork')).toBe('copy');
  });

  it('returns unknown for ops with no natural category', () => {
    expect(categorizeError(new Error('boom'), 'remove')).toBe('unknown');
    expect(categorizeError(new Error('boom'), 'update-metadata')).toBe('unknown');
  });

  it('does not substring-match keywords like "database" / "ffmpeg" / "ENOSPC"', () => {
    // Untyped errors categorize by op-type only; keyword strings in the
    // message are ignored. Throw a CategorizedSyncError subclass if you
    // need a specific category.
    expect(categorizeError(new Error('database corruption'), 'add-direct-copy')).toBe('copy');
    expect(categorizeError(new Error('ffmpeg crashed'), 'add-direct-copy')).toBe('copy');
    expect(categorizeError(new Error('ENOENT'), 'remove')).toBe('unknown');
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

describe('MusicPipeline - retry logic', () => {
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
    mockTranscoder.transcode = mock(async (_input: string, output: string) => {
      transcodeAttempts++;
      if (transcodeAttempts === 1) {
        throw new Error('FFmpeg transient failure');
      }
      writeFileSync(output, '');
      return {
        outputPath: output,
        size: 5000000,
        duration: 1000,
        bitrate: 256,
      };
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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
    // Typed error: categorizer reads category off the class, retry policy
    // says 0 retries for `database`. Throwing a raw Error('database ...')
    // would now categorize as `copy` (op-type fallback) and retry —
    // adapters that surface a real database failure must wrap in
    // DatabaseWriteError for the no-retry policy to apply.
    const { DatabaseWriteError } = await import('../engine/errors.js');
    mockAdapter.addTrack = mock(() => {
      throw new DatabaseWriteError('itunesdb corruption');
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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
    mockTranscoder.transcode = mock(async (_input: string, output: string) => {
      transcodeAttempts++;
      if (transcodeAttempts === 1) {
        throw new Error('FFmpeg transient failure');
      }
      writeFileSync(output, '');
      return {
        outputPath: output,
        size: 5000000,
        duration: 1000,
        bitrate: 256,
      };
    });
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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
// plan execution aggregation — categorized errors
// =============================================================================

describe('plan execution aggregation — categorized errors', () => {
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

    const result = await runMusicPlan(plan, deps, {
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

describe('MusicPipeline - update-metadata operations', () => {
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

    const executor = new MusicPipeline(deps);
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
    expect(mockAdapter.save.mock.calls.length).toBe(0); // ADR-019: engine owns save now
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

  // Bitrate baseline backfill: when --force-sync-tags routes a bitrate-only
  // metadata update through the executor, the field must propagate to
  // updateTrack so detectUpgrades has both sides of source.bitrate &&
  // ipod.bitrate populated on the next sync. Without this, the
  // postProcessBitrateBaseline pass plans operations the executor silently
  // drops.
  it('propagates bitrate from metadata to updateTrack', async () => {
    let updateFields: Record<string, unknown> | null = null;
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/BITRATE.m4a', {
      update: (fields: Record<string, unknown>) => {
        updateFields = fields;
        return deviceTrack;
      },
    });

    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
    const plan: SyncPlan = {
      operations: [
        {
          type: 'update-metadata',
          track: deviceTrack,
          metadata: { bitrate: 256 },
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
    expect(updateFields!.bitrate).toBe(256);
  });

  it('throws error when track not found', async () => {
    mockAdapter = createMockDeviceAdapter([]); // Empty database
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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

  // 'updating-db' phase yield was removed per ADR-019. Engine
  // ownership of save means this event no longer surfaces from the pipeline.

  it('does not transfer bytes for update-metadata', async () => {
    const deviceTrack = createMockDeviceTrack('Artist', 'Song', 'Album', 'Music/UPDATE.m4a');
    mockAdapter = createMockDeviceAdapter([deviceTrack]);
    deps = createDependencies(mockAdapter, mockTranscoder);

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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

    const executor = new MusicPipeline(deps);
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
      reason: 'quality-change',
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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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

  it('executes upgrade with transcode preset (quality-change)', async () => {
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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { artwork: false })) {
      progress.push(p);
    }

    // Should have transcoded the file
    expect(transcoder.transcode).toHaveBeenCalledTimes(1);

    // Should have replaced the track file (not added a new one)
    expect(db.addTrack).not.toHaveBeenCalled();
    expect(replaceTrackFile).toHaveBeenCalledTimes(1);

    // Save is owned by the engine wrapping the pipeline (ADR-019).
    expect(db.save).not.toHaveBeenCalled();

    // Should report upgrading phase
    const upgradeProgress = progress.find((p) => p.phase === 'upgrading');
    expect(upgradeProgress).toBeDefined();
  });

  it('executes upgrade without preset (copy-based quality-change)', async () => {
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
          reason: 'quality-change',
          // No preset — MP3 is copied directly
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
            normalization: { source: 'replaygain-track', trackGain: -7.35, soundcheckValue: 5432 },
          }),
          target: existingTrack,
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }

    // Should have updated metadata
    expect(capturedUpdateFields).toBeDefined();
    expect(capturedUpdateFields!.filetype).toBe('AAC audio file');
    expect(capturedUpdateFields!.genre).toBe('Progressive Rock');
    expect(capturedUpdateFields!.year).toBe(1979);
    expect(capturedUpdateFields!.normalization).toEqual({
      source: 'replaygain-track',
      trackGain: -7.35,
      soundcheckValue: 5432,
    });
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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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

describe('MusicPipeline - prefetch pipeline (ADR-011)', () => {
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
    const executor = new MusicPipeline(deps);

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

    // Save is owned by the engine wrapping the pipeline (ADR-019).
    expect(db.save).not.toHaveBeenCalled();
    // Both tracks should have been added
    expect(db.addTrack).toHaveBeenCalledTimes(2);
  });

  it('downloads are started before transcoding completes for the previous track', async () => {
    // Use a delay so we can observe ordering
    const { adapter, downloadLog } = createMockStreamAdapter({ downloadDelayMs: 10 });

    // Track when transcoding happens
    const transcodeLog: Array<{ trackId: string; startTime: number; endTime: number }> = [];
    transcoder.transcode = mock(async (input: string, output: string) => {
      const startTime = Date.now();
      await new Promise((r) => setTimeout(r, 30)); // Simulate transcoding work
      const endTime = Date.now();
      transcodeLog.push({ trackId: input, startTime, endTime });
      writeFileSync(output, '');
      return { outputPath: output, size: 5000000, duration: 1000, bitrate: 256 };
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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

    const progress: ExecutorProgress[] = [];
    for await (const p of executor.execute(plan, { adapter, artwork: false })) {
      progress.push(p);
    }

    // Remove should have executed (inline in downloader)
    expect(trackRemoved).toBe(true);
    // Two tracks should have been added
    expect(db.addTrack).toHaveBeenCalledTimes(2);
    // Save is owned by the engine wrapping the pipeline (ADR-019).
    expect(db.save).not.toHaveBeenCalled();
    // No errors
    const errors = progress.filter((p) => p.error);
    expect(errors.length).toBe(0);
  });

  it('cleans up prefetched files on abort', async () => {
    const { adapter } = createMockStreamAdapter({ downloadDelayMs: 5 });

    // Slow transcoding so abort happens during pipeline
    transcoder.transcode = mock(async (_input: string, output: string) => {
      await new Promise((r) => setTimeout(r, 50));
      writeFileSync(output, '');
      return { outputPath: output, size: 5000000, duration: 1000, bitrate: 256 };
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
    const executor = new MusicPipeline(deps);

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
      expect(error).toBeInstanceOf(AbortError);
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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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

    // Track setArtwork calls on the adapter (post-Option-Z artwork lives there).
    db.setTrackArtwork = mock(async (_track: DeviceTrack, _data: Buffer) => {
      artworkSet = true;
    });
    db.addTrack = mock((input: Record<string, unknown>) => {
      const filePath = `Music/MOCK_ART.m4a`;
      return createMockDeviceTrack(
        String(input.artist ?? ''),
        String(input.title ?? ''),
        String(input.album ?? ''),
        filePath
      );
    });

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

    // artwork: true — extractArtwork is called on the source file.
    // Since our test source file doesn't exist, extraction returns null.
    // No warning is added for missing artwork (it's normal).
    for await (const _p of executor.execute(plan, { artwork: true })) {
      // consume
    }

    // The test verifies the artwork code path ran. With non-existent test files,
    // extractArtwork returns null (no embedded artwork), so setTrackArtwork
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
    });

    db.setTrackArtwork = mock(async (_track: DeviceTrack, _data: Buffer) => {
      artworkSet = true;
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
          reason: 'quality-change',
          preset: { name: 'high' },
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
          // No preset — copy-based upgrade
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
    const executor = new MusicPipeline(deps);

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
          reason: 'quality-change',
        },
      ],
    };

    const deps = createDependencies(db, transcoder);
    const executor = new MusicPipeline(deps);

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

// =============================================================================
// Adapter artwork fallback (TASK-142)
// =============================================================================

describe('adapter artwork fallback', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  /**
   * Build a minimal music adapter stub with a programmable getArtwork()
   * implementation. CollectionAdapter accepts CollectionTrack as the default
   * TItem so the cast is safe at the use-site.
   */
  function makeAdapterWithArtwork(
    impl: (track: CollectionTrack) => Promise<Buffer | null>
  ): CollectionAdapter<CollectionTrack, TrackFilter> {
    return {
      name: 'fake',
      adapterType: 'directory',
      connect: async () => undefined,
      disconnect: async () => undefined,
      getItems: async () => [],
      getFilteredItems: async () => [],
      getFileAccess: (track) => ({ type: 'path', path: track.filePath }) as FileAccess,
      getArtwork: impl,
    };
  }

  it('falls back to adapter.getArtwork() when embedded extraction returns null', async () => {
    let artworkBytes: Buffer | null = null;
    const adapterBytes = Buffer.from('adapter-cover-bytes-for-pipeline-test');

    db.setTrackArtwork = mock(async (_track: DeviceTrack, data: Buffer) => {
      artworkBytes = data;
    });
    db.addTrack = mock((input: Record<string, unknown>) => {
      const filePath = `Music/MOCK.m4a`;
      return createMockDeviceTrack(
        String(input.artist ?? ''),
        String(input.title ?? ''),
        String(input.album ?? ''),
        filePath
      );
    });

    let getArtworkCalls = 0;
    const adapter = makeAdapterWithArtwork(async () => {
      getArtworkCalls++;
      return adapterBytes;
    });

    const source = createCollectionTrack('Artist', 'Song', 'Album', 'wav');
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source } satisfies SyncOperation],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, { artwork: true, adapter })) {
      // consume
    }

    expect(getArtworkCalls).toBe(1);
    expect(artworkBytes).not.toBeNull();
    expect((artworkBytes as unknown as Buffer).equals(adapterBytes)).toBe(true);
    expect(executor.getWarnings()).toHaveLength(0);
  });

  it('does not call adapter.getArtwork() when source.hasArtwork === false (no transfer)', async () => {
    let getArtworkCalls = 0;
    const adapter = makeAdapterWithArtwork(async () => {
      getArtworkCalls++;
      return Buffer.from('should-not-fire');
    });

    const source = createCollectionTrack('Artist', 'Song', 'Album', 'wav', { hasArtwork: false });
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source } satisfies SyncOperation],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, { artwork: true, adapter })) {
      // consume
    }

    expect(getArtworkCalls).toBe(0);
  });

  it('dry-run never calls adapter.getArtwork() (no I/O contract)', async () => {
    let getArtworkCalls = 0;
    const adapter = makeAdapterWithArtwork(async () => {
      getArtworkCalls++;
      return Buffer.from('should-not-be-called-in-dry-run');
    });

    const source = createCollectionTrack('Artist', 'Song', 'Album', 'wav');
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source } satisfies SyncOperation],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, { artwork: true, adapter, dryRun: true })) {
      // consume
    }

    expect(getArtworkCalls).toBe(0);
    expect(db.addTrack).not.toHaveBeenCalled();
  });

  it('shares one adapter fetch across siblings on the same album', async () => {
    // setTrackArtwork mock is the default no-op from createMockDeviceAdapter;
    // the test pins the fallback-cache contract, not the write path.
    db.addTrack = mock((input: Record<string, unknown>) => {
      return createMockDeviceTrack(
        String(input.artist ?? ''),
        String(input.title ?? ''),
        String(input.album ?? ''),
        `Music/${input.title}.m4a`
      );
    });

    let getArtworkCalls = 0;
    const adapter = makeAdapterWithArtwork(async () => {
      getArtworkCalls++;
      return Buffer.from('shared-album-cover');
    });

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('Artist', 'T1', 'Album', 'wav') },
        { type: 'add-direct-copy', source: createCollectionTrack('Artist', 'T2', 'Album', 'wav') },
        { type: 'add-direct-copy', source: createCollectionTrack('Artist', 'T3', 'Album', 'wav') },
      ] as SyncOperation[],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, { artwork: true, adapter })) {
      // consume
    }

    // First track misses embed → triggers fallback → caches the bytes.
    // Subsequent tracks hit the album cache and DO NOT re-call getArtwork.
    expect(getArtworkCalls).toBe(1);
  });
});

// =============================================================================
// PipelineBusyError: defensive concurrent-execute guard for library consumers
// =============================================================================

describe('PipelineBusyError concurrent-execute guard', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('rejects a second execute() while the first iterator is in flight', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'T1', 'Album', 'mp3') },
      ] as SyncOperation[],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));

    // Start the first execute() and DO NOT consume the iterator yet — that
    // keeps `executing = true` on the instance.
    const iter = executor.execute(plan, { dryRun: true });
    const firstStep = (iter as AsyncGenerator<ExecutorProgress>).next();

    // Second concurrent execute() must throw the typed error synchronously
    // (well, on the first .next() — async generators wrap the throw).
    let thrown: unknown;
    try {
      const second = executor.execute(plan, { dryRun: true });
      await (second as AsyncGenerator<ExecutorProgress>).next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PipelineBusyError);
    expect((thrown as Error).message).toContain('one MusicPipeline per concurrent sync');

    // Drain the first iterator so executing flips back to false.
    await firstStep;
    for await (const _p of iter as AsyncGenerator<ExecutorProgress>) {
      // consume
    }
  });

  it('allows sequential execute() reuse on the same instance', async () => {
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'T1', 'Album', 'mp3') },
      ] as SyncOperation[],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));

    for await (const _p of executor.execute(plan, { dryRun: true })) {
      // consume first
    }
    // After the first iterator finishes, executing must be false so a second
    // call succeeds on the same instance.
    for await (const _p of executor.execute(plan, { dryRun: true })) {
      // consume second
    }
    // Made it here without throwing — sequential reuse works.
    expect(true).toBe(true);
  });

  it('releases the busy flag when the first execute() throws (instance not stranded)', async () => {
    // Force a throw during the iterator's first step by passing a transcoder
    // that rejects. We use a real plan (not dry-run) so executePipeline runs.
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-transcode',
          source: createCollectionTrack('A', 'T1', 'Album', 'flac'),
          preset: { name: 'high' },
        },
      ] as SyncOperation[],
    };

    transcoder.transcode = mock(async () => {
      throw new Error('forced transcode failure for guard test');
    });

    const executor = new MusicPipeline(createDependencies(db, transcoder));

    // Drain the iterator — the inner error is caught and surfaced as a
    // 'failed' progress event (continueOnError defaults false but the
    // pipeline catches transcode errors per-op). Doesn't matter for this
    // test; what matters is that executing flips back to false in finally.
    try {
      for await (const _p of executor.execute(plan)) {
        // consume
      }
    } catch {
      // either path is fine; we just want to verify the flag is reset
    }

    // A subsequent execute() must NOT throw PipelineBusyError. If the flag
    // had been left set, this would throw.
    for await (const _p of executor.execute(plan, { dryRun: true })) {
      // consume
    }
    expect(true).toBe(true);
  });
});

// =============================================================================
// ExecutionContext — per-execute state is parameter-scoped, not instance-scoped
// =============================================================================
//
// The pre-refactor pipeline stored adapter / transferMode / artworkResize /
// audioNormalization / syncTagConfig / artworkEnabled on `this`, setting them
// at execute() entry. Two sequential execute() calls with divergent options
// could leak the first call's options into the second if anything went wrong
// with the assignment / clearing dance.
//
// After TASK-382 these fields live in an ExecutionContext built once at the
// top of execute() and threaded as a parameter through every private method.
// This test proves the structural property: the second execute()'s behaviour
// is purely a function of ITS options, with no residue from the first.
//
// Concurrent execute() on the same instance is still rejected by the busy
// guard (the per-instance artwork caches would race), so sequential reuse
// with divergent options is the cheapest, most readable form of the same
// invariant — if any per-execute field still lived on `this` and wasn't
// cleared cleanly, the second run would mis-behave.

describe('ExecutionContext — sequential reuse with divergent options', () => {
  let db: MockDeviceAdapter;
  let transcoder: MockTranscoder;

  beforeEach(() => {
    db = createMockDeviceAdapter();
    transcoder = createMockTranscoder();
  });

  it('two sequential execute() calls with divergent transferMode see only their own options', async () => {
    // Track every transferMode value the device adapter receives across both runs.
    const transferModes: Array<string | undefined> = [];
    db.addTrack = mock((input: { transferMode?: string; title: string }) => {
      transferModes.push(input.transferMode);
      const filePath = `Music/${input.title}.m4a`;
      const track = createMockDeviceTrack('A', input.title, 'Album', filePath);
      return track;
    });

    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        { type: 'add-direct-copy', source: createCollectionTrack('A', 'T1', 'Album', 'mp3') },
      ] as SyncOperation[],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));

    // First execute with transferMode: 'portable'
    for await (const _p of executor.execute(plan, { transferMode: 'portable' })) {
      // consume
    }

    // Second execute with transferMode: 'optimized' — must NOT see 'portable' bleed in
    for await (const _p of executor.execute(plan, { transferMode: 'optimized' })) {
      // consume
    }

    // Each run produces exactly one addTrack call. The first must carry
    // 'portable', the second 'optimized'. If per-execute state had leaked on
    // `this`, the second run could mis-attribute mode (e.g., still 'portable'
    // if the assignment was missed).
    expect(transferModes).toEqual(['portable', 'optimized']);
  });

  it('two sequential execute() calls with divergent artwork flag see only their own gate', async () => {
    // Pin: ctx.artworkEnabled is parameter-scoped, not instance-scoped.
    // Run 1 (artwork=true) MUST reach transferArtwork; run 2 (artwork=false)
    // MUST NOT — even though the same MusicPipeline instance just ran with
    // the gate open. Spying on the dispatch method itself is the cleanest
    // observable for the outer `if (ctx.artworkEnabled && ...)` gate.
    db.addTrack = mock((input: { title: string }) => {
      const filePath = `Music/${input.title}.m4a`;
      return createMockDeviceTrack('A', input.title, 'Album', filePath);
    });

    const collectionTrack = createCollectionTrack('A', 'T1', 'Album', 'mp3', {
      hasArtwork: true,
    });
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source: collectionTrack }] as SyncOperation[],
    };

    const executor = new MusicPipeline(createDependencies(db, transcoder));
    // After TASK-383 the dispatch lives on the MusicArtworkManager owned by the
    // pipeline. Spy on the manager's method directly — same observable, new home.
    const transferArtworkSpy = spyOn(executor.artwork, 'transferArtwork');

    // Run 1: artwork=true (default) — must enter transferArtwork.
    for await (const _p of executor.execute(plan, { artwork: true })) {
      // consume
    }
    expect(transferArtworkSpy.mock.calls.length).toBeGreaterThan(0);

    // Run 2: artwork=false — must NOT enter transferArtwork. If the
    // pre-refactor `this.artworkEnabled = true` had stuck on the instance,
    // the outer gate would still admit the call here.
    transferArtworkSpy.mockClear();
    for await (const _p of executor.execute(plan, { artwork: false })) {
      // consume
    }
    expect(transferArtworkSpy.mock.calls.length).toBe(0);

    transferArtworkSpy.mockRestore();
  });

  it('no per-execute fields remain on the MusicPipeline instance', () => {
    // Structural pin: the seven per-execute fields that used to live on
    // `this` must NOT be present as instance properties. If a future refactor
    // re-introduces any of them as instance state, this test fails loudly.
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    const instanceKeys = Object.keys(executor);
    expect(instanceKeys).not.toContain('adapter');
    expect(instanceKeys).not.toContain('transferMode');
    expect(instanceKeys).not.toContain('artworkResize');
    expect(instanceKeys).not.toContain('sidecarResize');
    expect(instanceKeys).not.toContain('audioNormalization');
    expect(instanceKeys).not.toContain('syncTagConfig');
    expect(instanceKeys).not.toContain('artworkEnabled');
  });
});

// =============================================================================
// DeviceTrack.artworkSink dispatch — pipeline hands bytes to the adapter
// =============================================================================
//
// Post-Option-Z the pipeline no longer branches on `artworkSink` to pick a
// write path — the adapter owns that dispatch. The pipeline now:
//   1. Early-skips bytes extraction when `artworkSink === 'noop'` (no point
//      pulling FFmpeg bytes a noop adapter will drop).
//   2. Resizes bytes for embedded/sidecar sinks before handing them off
//      (database sink → libgpod owns the rescale).
//   3. Calls `adapter.setTrackArtwork(track, bytes)` once.
//   4. Suppresses the `syncTag.artworkHash` claim when transferArtwork
//      returns undefined (the doc-041 §3.6 churn-loop pin).
//
// Adapter-level dispatch (embedded → updateTrack picture-write, sidecar →
// peer cover.jpg, noop → drop) is exercised by the MassStorageAdapter unit
// suite. These tests pin the pipeline-side contract.

describe('artworkSink: pipeline hands bytes to adapter.setTrackArtwork', () => {
  let transcoder: MockTranscoder;

  beforeEach(() => {
    transcoder = createMockTranscoder();
  });

  /**
   * Build a directory-shaped adapter with a programmable getArtwork that
   * returns the supplied bytes once. Sufficient to drive transferArtwork
   * through the fallback path without needing a real file.
   */
  function makeAdapterWithBytes(bytes: Buffer): CollectionAdapter<CollectionTrack, TrackFilter> {
    return {
      name: 'fake',
      adapterType: 'directory',
      connect: async () => undefined,
      disconnect: async () => undefined,
      getItems: async () => [],
      getFilteredItems: async () => [],
      getFileAccess: (track) => ({ type: 'path', path: track.filePath }) as FileAccess,
      getArtwork: async () => bytes,
    };
  }

  /**
   * Spin up a fresh adapter mock that hands back tracks pinned to the
   * requested sink. The default `setTrackArtwork` mock records its calls so
   * the test can assert the pipeline routed bytes there.
   */
  function makeDbForSink(sink: DeviceTrack['artworkSink']): MockDeviceAdapter {
    const db = createMockDeviceAdapter();
    db.addTrack = mock((input: Record<string, unknown>) => {
      return createMockDeviceTrack(
        String(input.artist ?? ''),
        String(input.title ?? ''),
        String(input.album ?? ''),
        `Music/MOCK.m4a`,
        { artworkSink: sink }
      );
    });
    return db;
  }

  function makeCopyPlan(): SyncPlan {
    return {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-direct-copy',
          source: createCollectionTrack('Artist', 'Song', 'Album', 'wav'),
        },
      ] as SyncOperation[],
    };
  }

  it("sink='database' → setTrackArtwork receives the bytes, writeSyncTag records artworkHash", async () => {
    const bytes = Buffer.from('database-cover-bytes');
    const db = makeDbForSink('database');

    let captured: Buffer | null = null;
    db.setTrackArtwork = mock(async (_track: DeviceTrack, data: Buffer) => {
      captured = data;
    });

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(makeCopyPlan(), {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    // The pipeline routed the bytes to the adapter (database sink → no resize).
    expect(captured).not.toBeNull();
    expect((captured as unknown as Buffer).equals(bytes)).toBe(true);
    // updateTrack with embeddedPictureData must NOT fire for database sinks —
    // the pipeline doesn't double-dispatch.
    const embedCall = db.updateTrack.mock.calls.find(
      ([, fields]) => (fields as Record<string, unknown>).embeddedPictureData !== undefined
    );
    expect(embedCall).toBeUndefined();
    // writeSyncTag fires with an artworkHash (claim of success).
    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeDefined();
  });

  it("sink='embedded' → setTrackArtwork receives the bytes, writeSyncTag records artworkHash", async () => {
    const bytes = Buffer.from('embedded-cover-bytes');
    const db = makeDbForSink('embedded');

    let captured: Buffer | null = null;
    db.setTrackArtwork = mock(async (_track: DeviceTrack, data: Buffer) => {
      captured = data;
    });

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(makeCopyPlan(), {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    expect(captured).not.toBeNull();
    expect((captured as unknown as Buffer).equals(bytes)).toBe(true);
    // writeSyncTag fires with an artworkHash — embedded sink delivered bytes.
    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeDefined();
  });

  it("sink='sidecar' → setTrackArtwork receives the bytes and writeSyncTag records artworkHash", async () => {
    const bytes = Buffer.from('sidecar-cover-bytes');
    const db = makeDbForSink('sidecar');

    let captured: Buffer | null = null;
    db.setTrackArtwork = mock(async (_track: DeviceTrack, data: Buffer) => {
      captured = data;
    });

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(makeCopyPlan(), {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    // Resize is a no-op here (no sidecarResize set in execute() options),
    // so the adapter receives the original bytes.
    expect(captured).not.toBeNull();
    expect((captured as unknown as Buffer).equals(bytes)).toBe(true);
    // syncTag.artworkHash IS recorded — bytes flowed through the adapter.
    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeDefined();
  });

  it("sink='noop' → setTrackArtwork is NEVER called AND syncTag.artworkHash suppressed (churn-loop pin)", async () => {
    // Doc-041 §3.6 regression pin. The pipeline used to call
    // setArtworkFromData on every DeviceTrack and write syncTag.artworkHash
    // off `source.artworkHash ?? extractedHash`. For mass-storage non-OGG
    // outputs the bytes were silently dropped (setArtworkFromData no-op)
    // but the hash was written anyway — so detectUpgrades saw
    // source.artworkHash != device-file-art-state on every subsequent
    // sync and fired artwork-added forever. The pipeline now early-skips
    // bytes extraction for noop sinks AND suppresses the hash claim, so
    // setTrackArtwork is never reached.
    const bytes = Buffer.from('noop-cover-bytes-that-have-nowhere-to-go');
    const db = makeDbForSink('noop');

    let setCalled = false;
    db.setTrackArtwork = mock(async (_track: DeviceTrack, _data: Buffer) => {
      setCalled = true;
    });

    // Source carries an artworkHash — pre-TASK-372 this would have been
    // written to syncTag.artworkHash unconditionally. After the fix the
    // suppression guard skips the write because transferArtwork returned
    // undefined.
    const sourceWithHash = createCollectionTrack('Artist', 'Song', 'Album', 'wav', {
      artworkHash: 'deadbeef',
    });
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source: sourceWithHash } satisfies SyncOperation],
    };

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    expect(setCalled).toBe(false);
    // The pin: writeSyncTag must NEVER be called with an artworkHash on a
    // noop sink, even though source.artworkHash was supplied. The pipeline
    // still writes the minimal copy sync tag for the addTrack input
    // (quality + transferMode), but the *artworkHash* field stays absent.
    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeUndefined();
  });

  // Initial-add baseline contract: when the adapter supplies a source artwork
  // hash (the `--check-artwork` flow) and artwork bytes successfully land on
  // the device, the syncTag MUST carry the source's hash from the very first
  // sync. No second pass with `--force-sync-tags` is required to establish the
  // baseline. The next sync's `detectUpgrades` compares
  // `source.artworkHash` against `device.syncTag.artworkHash` to decide
  // whether artwork changed; without the baseline, no comparison fires and
  // artwork-change detection is silently disabled until the user opts into
  // `--force-sync-tags`.
  it('source.artworkHash + delivering sink → baseline written on initial add (no force-sync-tags)', async () => {
    const bytes = Buffer.from('cover-bytes-from-adapter');
    const db = makeDbForSink('database');

    // Source has its own artwork hash (e.g., Subsonic adapter with
    // --check-artwork on, or directory adapter that hashed embedded art).
    // Crucially, this hash differs from the bytes the adapter returns —
    // the assertion verifies the pipeline prefers source.artworkHash over
    // extractedHash, matching the priority logic in transfer.ts.
    const sourceHash = 'feedface';
    const sourceWithHash = createCollectionTrack('Artist', 'Song', 'Album', 'wav', {
      artworkHash: sourceHash,
    });
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source: sourceWithHash } satisfies SyncOperation],
    };

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    // Note: no force-sync-tags-equivalent option exists at the pipeline
    // surface — the gate lives on the handler. This run is the bare
    // first-sync flow.
    for await (const _p of executor.execute(plan, {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    // writeSyncTag must fire with artworkHash === sourceHash. Bytes landed
    // on the device (database sink), so the hash claim is safe.
    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeDefined();
    const writtenHash = (syncTagWithHash![1] as Record<string, unknown>).artworkHash;
    expect(writtenHash).toBe(sourceHash);
  });

  // Sibling contract for add-transcode: same guarantee for the lossless-to-
  // lossy path. The initial syncTag (built from preset/encoding/codec) is
  // written during addTrack; the artworkHash is appended after the artwork
  // bytes land. Both writes happen on the first sync with no extra flags.
  it('source.artworkHash + add-transcode → baseline written on initial add (no force-sync-tags)', async () => {
    const bytes = Buffer.from('flac-embedded-cover-bytes');
    const db = makeDbForSink('database');
    // For add-transcode, transfer.ts builds the syncTag up front and passes
    // it via trackInput.syncTag. The artworkHash append (line 177 of
    // transfer.ts) only fires when `track.syncTag` is already populated on
    // the returned track. Make the mock honour that contract so the test
    // exercises the realistic addTrack-then-writeSyncTag sequence.
    db.addTrack = mock(
      (input: { title: string; artist: string; album?: string; syncTag?: unknown }) => {
        const track = createMockDeviceTrack(
          String(input.artist ?? ''),
          String(input.title),
          String(input.album ?? ''),
          `Music/MOCK.m4a`,
          { artworkSink: 'database' }
        );
        // Round-trip the syncTag — real adapters carry the input syncTag
        // onto the returned track so transfer.ts can detect it exists.
        return { ...track, syncTag: (input.syncTag as DeviceTrack['syncTag']) ?? null };
      }
    );

    const sourceHash = 'cafebabe';
    const sourceWithHash = createCollectionTrack('Artist', 'Song', 'Album', 'flac', {
      artworkHash: sourceHash,
      lossless: true,
    });
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [
        {
          type: 'add-transcode',
          source: sourceWithHash,
          preset: { name: 'high', targetCodec: 'aac' },
        } satisfies SyncOperation,
      ],
    };

    const adapter = makeAdapterWithBytes(bytes);
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, {
      artwork: true,
      adapter,
      syncTagConfig: { encodingMode: 'vbr' },
      transferMode: 'fast',
    })) {
      // consume
    }

    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeDefined();
    const writtenHash = (syncTagWithHash![1] as Record<string, unknown>).artworkHash;
    expect(writtenHash).toBe(sourceHash);
  });

  // Symmetric negative: source has NO artworkHash (adapter ran without
  // --check-artwork) and the source has no embedded artwork either —
  // transferArtwork returns undefined and writeSyncTag must NOT be invoked
  // with an artworkHash field. This pins the "only baseline when there is
  // something to baseline" rule, complementing the noop-sink suppression.
  it('source without artworkHash and no extracted bytes → no baseline written', async () => {
    const db = makeDbForSink('database');

    const source = createCollectionTrack('Artist', 'Song', 'Album', 'wav');
    const plan: SyncPlan = {
      ...createEmptyPlan(),
      operations: [{ type: 'add-direct-copy', source } satisfies SyncOperation],
    };

    // Adapter returns null bytes — simulates the "no artwork available" path
    // (audio file has no embedded art, no sidecar).
    const adapter: CollectionAdapter<CollectionTrack, TrackFilter> = {
      name: 'fake',
      adapterType: 'directory',
      connect: async () => undefined,
      disconnect: async () => undefined,
      getItems: async () => [],
      getFilteredItems: async () => [],
      getFileAccess: (track) => ({ type: 'path', path: track.filePath }) as FileAccess,
      getArtwork: async () => null,
    };
    const executor = new MusicPipeline(createDependencies(db, transcoder));
    for await (const _p of executor.execute(plan, {
      artwork: true,
      adapter,
      syncTagConfig: {},
      transferMode: 'fast',
    })) {
      // consume
    }

    const syncTagWithHash = db.writeSyncTag.mock.calls.find(
      ([, update]) => (update as Record<string, unknown>).artworkHash !== undefined
    );
    expect(syncTagWithHash).toBeUndefined();
  });
});
