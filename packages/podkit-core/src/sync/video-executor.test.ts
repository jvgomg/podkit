/**
 * Unit tests for the video sync executor
 *
 * These tests verify checkpoint save behavior during video sync execution.
 *
 * ## Test Coverage
 *
 * 1. Checkpoint saves trigger at the correct interval
 * 2. Only transcode and copy operations count toward the interval
 * 3. Save is skipped when saveInterval is 0
 * 4. Save is skipped when signal is aborted
 * 5. Custom saveInterval values are respected
 */

import { describe, expect, it, mock, beforeEach } from 'bun:test';

// =============================================================================
// Mocks — must be set up before importing the module under test
// =============================================================================

const mockTranscodeVideo = mock(() => Promise.resolve());
const mockProbeVideo = mock(() =>
  Promise.resolve({
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 320,
    height: 240,
    duration: 120,
    videoBitrate: 500,
    audioBitrate: 128,
    container: 'mp4',
  })
);
const mockStat = mock(() => Promise.resolve({ size: 50_000_000 }));
const mockMkdir = mock(() => Promise.resolve());
const mockRm = mock(() => Promise.resolve());

mock.module('../video/transcode.js', () => ({
  transcodeVideo: mockTranscodeVideo,
}));

mock.module('../video/probe.js', () => ({
  probeVideo: mockProbeVideo,
}));

mock.module('node:fs/promises', () => ({
  stat: mockStat,
  mkdir: mockMkdir,
  rm: mockRm,
}));

mock.module('../ipod/video.js', () => ({
  createVideoTrackInput: () => ({
    title: 'Test Video',
    artist: 'Test Artist',
    album: 'Test Album',
    mediaType: 2,
  }),
}));

// Import after mocks
import { DefaultVideoSyncExecutor } from './video-executor.js';
import type { VideoSyncPlan } from './video-planner.js';
import type { SyncOperation } from './types.js';
import type { CollectionVideo } from '../video/directory-adapter.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockIpod() {
  const mockTrack = {
    copyFile: mock(() => mockTrack),
    update: mock(() => mockTrack),
    remove: mock(() => {}),
    filePath: '/iPod_Control/Music/test.m4v',
    title: 'Test',
    tvShow: 'Test Show',
  };

  return {
    addTrack: mock(() => mockTrack),
    getTracks: mock(() => [mockTrack]),
    save: mock(() => Promise.resolve({ warnings: [] })),
    removeTrack: mock(() => {}),
  };
}

function createVideoSource(title: string): CollectionVideo {
  return {
    id: `/videos/${title}.mkv`,
    filePath: `/videos/${title}.mkv`,
    contentType: 'movie',
    title,
    container: 'mkv',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    duration: 7200,
  };
}

function createTranscodeOp(title: string): SyncOperation {
  return {
    type: 'video-transcode',
    source: createVideoSource(title),
    settings: {
      targetWidth: 320,
      targetHeight: 240,
      targetVideoBitrate: 500,
      targetAudioBitrate: 128,
      videoProfile: 'baseline' as const,
      videoLevel: '3.0',
      crf: 23,
      frameRate: 30,
      useHardwareAcceleration: false,
    },
  };
}

function createCopyOp(title: string): SyncOperation {
  return {
    type: 'video-copy',
    source: createVideoSource(title),
  };
}

function createRemoveOp(title: string): SyncOperation {
  return {
    type: 'video-remove',
    video: {
      id: `/iPod_Control/Music/${title}.m4v`,
      filePath: `/iPod_Control/Music/${title}.m4v`,
      contentType: 'movie',
      title,
      duration: 7200,
    },
  };
}

function createUpdateMetadataOp(title: string): SyncOperation {
  return {
    type: 'video-update-metadata',
    source: createVideoSource(title),
    video: {
      id: `/iPod_Control/Music/${title}.m4v`,
      filePath: `/iPod_Control/Music/${title}.m4v`,
      contentType: 'movie',
      title,
      duration: 7200,
    },
  };
}

function createPlan(operations: SyncOperation[]): VideoSyncPlan {
  return {
    operations,
    estimatedTime: 60,
    estimatedSize: 100_000_000,
    warnings: [],
  };
}

/** Drain an async iterable to collect all yielded values */
async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

// =============================================================================
// Tests
// =============================================================================

describe('DefaultVideoSyncExecutor', () => {
  let mockIpod: ReturnType<typeof createMockIpod>;
  let executor: DefaultVideoSyncExecutor;

  beforeEach(() => {
    mockIpod = createMockIpod();
    executor = new DefaultVideoSyncExecutor({ ipod: mockIpod as any });

    // Reset mocks
    mockTranscodeVideo.mockClear();
    mockProbeVideo.mockClear();
    mockStat.mockClear();
    mockMkdir.mockClear();
    mockRm.mockClear();
  });

  describe('checkpoint saves', () => {
    it('saves after every 10 operations by default', async () => {
      // 10 transcode operations should trigger exactly 1 save
      const ops = Array.from({ length: 10 }, (_, i) => createTranscodeOp(`video-${i}`));
      const plan = createPlan(ops);

      await drain(executor.execute(plan));

      expect(mockIpod.save).toHaveBeenCalledTimes(1);
    });

    it('saves after every N operations with custom saveInterval', async () => {
      // 6 operations with saveInterval=3 should trigger 2 saves
      const ops = Array.from({ length: 6 }, (_, i) => createTranscodeOp(`video-${i}`));
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 3 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(2);
    });

    it('counts both transcode and copy operations toward save interval', async () => {
      // Mix of transcode and copy operations: 3 total with saveInterval=3
      const ops: SyncOperation[] = [
        createTranscodeOp('video-1'),
        createCopyOp('video-2'),
        createTranscodeOp('video-3'),
      ];
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 3 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(1);
    });

    it('does not count remove operations toward save interval', async () => {
      // 2 transcodes + 1 remove with saveInterval=3 should NOT trigger save
      // (only 2 counted operations)

      // Mock getTracks to return a track matching the remove operation
      const removeTrack = {
        filePath: '/iPod_Control/Music/video-2.m4v',
        title: 'video-2',
        tvShow: '',
        remove: mock(() => {}),
        copyFile: mock(() => removeTrack),
        update: mock(() => removeTrack),
      };
      mockIpod.getTracks.mockReturnValue([removeTrack]);

      const ops: SyncOperation[] = [
        createTranscodeOp('video-1'),
        createRemoveOp('video-2'),
        createTranscodeOp('video-3'),
      ];
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 3 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('does not count update-metadata operations toward save interval', async () => {
      // 2 copies + 1 update-metadata with saveInterval=3 should NOT trigger save

      // Mock getTracks to return a track matching the update-metadata operation
      const updateTrack = {
        filePath: '/iPod_Control/Music/video-2.m4v',
        title: 'video-2',
        tvShow: '',
        remove: mock(() => {}),
        copyFile: mock(() => updateTrack),
        update: mock(() => updateTrack),
      };
      mockIpod.getTracks.mockReturnValue([updateTrack]);

      const ops: SyncOperation[] = [
        createCopyOp('video-1'),
        createUpdateMetadataOp('video-2'),
        createCopyOp('video-3'),
      ];
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 3 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('does not save when saveInterval is 0', async () => {
      const ops = Array.from({ length: 20 }, (_, i) => createTranscodeOp(`video-${i}`));
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 0 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('skips checkpoint save when signal is aborted', async () => {
      const controller = new AbortController();

      // Create 2 operations with saveInterval=1
      // Abort after the first operation completes
      const ops: SyncOperation[] = [createTranscodeOp('video-1'), createTranscodeOp('video-2')];
      const plan = createPlan(ops);

      // Abort after the first transcode mock is called
      let callCount = 0;
      mockTranscodeVideo.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Abort after first operation — the checkpoint save should be skipped
          controller.abort();
        }
      });

      // With saveInterval=1, normally every operation would save.
      // But after abort, the loop should throw before the second operation,
      // and the first save should be skipped because signal is aborted.
      try {
        await drain(executor.execute(plan, { saveInterval: 1, signal: controller.signal }));
      } catch {
        // Expected: 'Video sync aborted'
      }

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('does not save in dry-run mode', async () => {
      const ops = Array.from({ length: 10 }, (_, i) => createTranscodeOp(`video-${i}`));
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { dryRun: true }));

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('does not count failed operations toward save interval with continueOnError', async () => {
      // 10 transcode operations where the 5th throws an error
      // With saveInterval=10 and continueOnError=true, only 9 succeed — no save triggered
      const ops = Array.from({ length: 10 }, (_, i) => createTranscodeOp(`video-${i}`));
      const plan = createPlan(ops);

      let callCount = 0;
      mockTranscodeVideo.mockImplementation(async () => {
        callCount++;
        if (callCount === 5) {
          throw new Error('Transcode failed');
        }
      });

      await drain(executor.execute(plan, { saveInterval: 10, continueOnError: true }));

      expect(mockIpod.save).toHaveBeenCalledTimes(0);
    });

    it('triggers multiple saves for many operations', async () => {
      // 25 copy operations with saveInterval=10 should trigger 2 saves (at 10 and 20)
      const ops = Array.from({ length: 25 }, (_, i) => createCopyOp(`video-${i}`));
      const plan = createPlan(ops);

      await drain(executor.execute(plan, { saveInterval: 10 }));

      expect(mockIpod.save).toHaveBeenCalledTimes(2);
    });
  });
});
