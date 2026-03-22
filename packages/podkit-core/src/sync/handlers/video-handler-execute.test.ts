/**
 * Tests for VideoHandler execution methods
 *
 * Verifies that VideoHandler.execute() yields OperationProgress events
 * with transcodeProgress data during video transcoding.
 *
 * Uses module mocks to avoid requiring real FFmpeg/iPod dependencies.
 */

import { describe, expect, it, mock, beforeEach } from 'bun:test';

// =============================================================================
// Mocks — must be set up before importing the module under test
// =============================================================================

const mockTranscodeVideo = mock(
  (_input: string, _output: string, _settings: any, options?: any) => {
    // Simulate progress callbacks
    if (options?.onProgress) {
      options.onProgress({ time: 5, duration: 10, percent: 50, speed: 2.0 });
      options.onProgress({ time: 10, duration: 10, percent: 100, speed: 2.0 });
    }
    return Promise.resolve();
  }
);

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

mock.module('../../video/transcode.js', () => ({
  transcodeVideo: mockTranscodeVideo,
}));

mock.module('../../video/probe.js', () => ({
  probeVideo: mockProbeVideo,
}));

mock.module('../video-executor-fs.js', () => ({
  stat: mockStat,
  mkdir: mockMkdir,
  rm: mockRm,
}));

mock.module('../../ipod/video.js', () => ({
  createVideoTrackInput: () => ({
    title: 'Test Video',
    artist: 'Test Artist',
    album: 'Test Album',
    mediaType: 2,
  }),
  isVideoMediaType: (mt: number) => (mt & 0x0002) !== 0 || (mt & 0x0040) !== 0,
}));

// Import after mocks
import { VideoHandler } from './video-handler.js';
import type { SyncOperation } from '../types.js';
import type { OperationProgress, ExecutionContext } from '../content-type.js';
import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { VideoTranscodeSettings } from '../../video/types.js';

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
    save: mock(() => Promise.resolve()),
    mockTrack,
  };
}

function makeVideoSource(overrides: Partial<CollectionVideo> = {}): CollectionVideo {
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

const defaultSettings: VideoTranscodeSettings = {
  targetVideoBitrate: 1500,
  targetAudioBitrate: 128,
  targetWidth: 640,
  targetHeight: 480,
  videoProfile: 'baseline',
  videoLevel: '3.0',
  crf: 23,
  frameRate: 30,
  useHardwareAcceleration: false,
};

function makeCtx(ipod?: any): ExecutionContext {
  return {
    ipod: ipod ?? createMockIpod(),
    tempDir: '/tmp/test',
  };
}

/**
 * Collect all yielded OperationProgress events from the handler's execute generator
 */
async function collectProgress(
  gen: AsyncGenerator<OperationProgress>
): Promise<OperationProgress[]> {
  const events: OperationProgress[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// =============================================================================
// Tests
// =============================================================================

describe('VideoHandler execution', () => {
  let handler: VideoHandler;

  beforeEach(() => {
    handler = new VideoHandler();
    mockTranscodeVideo.mockClear();
    mockProbeVideo.mockClear();
    mockStat.mockClear();
  });

  describe('executeTranscode (video-transcode)', () => {
    it('yields starting, in-progress with transcodeProgress, and complete', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeVideoSource(),
        settings: defaultSettings,
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      // Should have starting + progress events + complete
      expect(events.length).toBeGreaterThanOrEqual(3);

      // First event: starting
      expect(events[0]!.phase).toBe('starting');

      // Last event: complete
      expect(events[events.length - 1]!.phase).toBe('complete');

      // Middle events: in-progress with transcodeProgress
      const progressEvents = events.filter((e) => e.phase === 'in-progress');
      expect(progressEvents.length).toBeGreaterThanOrEqual(1);

      const firstProgress = progressEvents[0]!;
      expect(firstProgress.transcodeProgress).toBeDefined();
      expect(firstProgress.transcodeProgress!.percent).toBe(50);
      expect(firstProgress.transcodeProgress!.speed).toBe(2);
    });

    it('calls transcodeVideo with correct arguments', async () => {
      const mockIpod = createMockIpod();
      const source = makeVideoSource({ filePath: '/videos/my-movie.mkv' });
      const op: SyncOperation = {
        type: 'video-transcode',
        source,
        settings: defaultSettings,
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(mockTranscodeVideo).toHaveBeenCalledTimes(1);
      const [inputPath, _outputPath, settings, options] = mockTranscodeVideo.mock.calls[0]!;
      expect(inputPath).toBe('/videos/my-movie.mkv');
      expect(settings).toBe(defaultSettings);
      expect(options.onProgress).toBeFunction();
    });

    it('adds track to iPod database', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeVideoSource(),
        settings: defaultSettings,
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(mockIpod.addTrack).toHaveBeenCalledTimes(1);
      expect(mockIpod.mockTrack.copyFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeCopy (video-copy)', () => {
    it('yields starting and complete', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-copy',
        source: makeVideoSource(),
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(events.length).toBe(2);
      expect(events[0]!.phase).toBe('starting');
      expect(events[1]!.phase).toBe('complete');
    });

    it('does not yield transcodeProgress', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-copy',
        source: makeVideoSource(),
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));
      const withProgress = events.filter((e) => e.transcodeProgress);
      expect(withProgress.length).toBe(0);
    });
  });

  describe('executeRemove (video-remove)', () => {
    it('yields starting and complete', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-remove',
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie' as const,
          title: 'Test',
        },
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(events.length).toBe(2);
      expect(events[0]!.phase).toBe('starting');
      expect(events[1]!.phase).toBe('complete');
    });

    it('throws when track not found', async () => {
      const mockIpod = createMockIpod();
      mockIpod.getTracks.mockReturnValue([]);

      const op: SyncOperation = {
        type: 'video-remove',
        video: {
          id: 'nonexistent',
          filePath: 'nonexistent',
          contentType: 'movie' as const,
          title: 'Missing',
        },
      };

      await expect(collectProgress(handler.execute(op, makeCtx(mockIpod)))).rejects.toThrow(
        'Video track not found'
      );
    });
  });

  describe('executeUpgrade (video-upgrade)', () => {
    it('yields transcodeProgress when upgrade requires transcoding', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-upgrade',
        source: makeVideoSource(),
        target: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie' as const,
          title: 'Test',
        },
        reason: 'preset-upgrade',
        settings: defaultSettings,
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      // Should have progress events with transcodeProgress
      const progressEvents = events.filter((e) => e.transcodeProgress);
      expect(progressEvents.length).toBeGreaterThanOrEqual(1);

      // All events should reference the upgrade operation
      for (const event of events) {
        expect(event.operation.type).toBe('video-upgrade');
      }
    });

    it('uses copy path when no settings provided', async () => {
      const mockIpod = createMockIpod();
      const op: SyncOperation = {
        type: 'video-upgrade',
        source: makeVideoSource(),
        target: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie' as const,
          title: 'Test',
        },
        reason: 'preset-upgrade',
        // No settings field — triggers copy path
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      // Old track should be removed
      expect(mockIpod.mockTrack.remove).toHaveBeenCalledTimes(1);

      // New track should be added via copy path (addTrack + copyFile, no transcodeVideo)
      expect(mockIpod.addTrack).toHaveBeenCalledTimes(1);
      expect(mockIpod.mockTrack.copyFile).toHaveBeenCalledTimes(1);
      expect(mockTranscodeVideo).not.toHaveBeenCalled();

      // All events reference the upgrade operation, not the internal copy op
      for (const event of events) {
        expect(event.operation.type).toBe('video-upgrade');
      }

      // Should not have transcodeProgress (copy path, not transcode)
      const withProgress = events.filter((e) => e.transcodeProgress);
      expect(withProgress.length).toBe(0);
    });
  });

  describe('executeUpdateMetadata (video-update-metadata)', () => {
    it('updates TV show metadata with tvshow-specific fields', async () => {
      const mockIpod = createMockIpod();
      const source = makeVideoSource({
        contentType: 'tvshow',
        title: 'Pilot',
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeId: 'S01E01',
      });
      const op: SyncOperation = {
        type: 'video-update-metadata',
        source,
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'tvshow',
          title: 'Pilot',
          seriesTitle: 'Breaking Bad',
        },
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(events.length).toBe(2);
      expect(events[0]!.phase).toBe('starting');
      expect(events[1]!.phase).toBe('complete');

      expect(mockIpod.mockTrack.update).toHaveBeenCalledTimes(1);
      const updateArg = mockIpod.mockTrack.update.mock.calls[0]![0];
      expect(updateArg.title).toBe('Pilot');
      expect(updateArg.artist).toBe('Breaking Bad');
      expect(updateArg.album).toBe('Breaking Bad, Season 1');
      expect(updateArg.tvShow).toBe('Breaking Bad');
      expect(updateArg.tvEpisode).toBe('Pilot');
      expect(updateArg.trackNumber).toBe(1);
      expect(updateArg.discNumber).toBe(1);
    });

    it('updates movie metadata with movie-specific fields', async () => {
      const mockIpod = createMockIpod();
      const source = makeVideoSource({
        contentType: 'movie',
        title: 'Inception',
        director: 'Christopher Nolan',
      });
      const op: SyncOperation = {
        type: 'video-update-metadata',
        source,
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie',
          title: 'Inception',
        },
      };

      const events = await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      expect(events.length).toBe(2);
      expect(mockIpod.mockTrack.update).toHaveBeenCalledTimes(1);
      const updateArg = mockIpod.mockTrack.update.mock.calls[0]![0];
      expect(updateArg.title).toBe('Inception');
      expect(updateArg.artist).toBe('Christopher Nolan');
      expect(updateArg.album).toBe('Inception');
    });

    it('updates movie metadata using studio when director is absent', async () => {
      const mockIpod = createMockIpod();
      const source = makeVideoSource({
        contentType: 'movie',
        title: 'Toy Story',
        studio: 'Pixar',
      });
      const op: SyncOperation = {
        type: 'video-update-metadata',
        source,
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie',
          title: 'Toy Story',
        },
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      const updateArg = mockIpod.mockTrack.update.mock.calls[0]![0];
      expect(updateArg.artist).toBe('Pixar');
    });

    it('updates with newSeriesTitle when set on operation', async () => {
      const mockIpod = createMockIpod();
      // Source is generic contentType (not tvshow or movie) but newSeriesTitle is set
      const source = makeVideoSource({
        contentType: 'tvshow' as any,
        title: 'Episode 1',
        seriesTitle: 'Original Name',
        seasonNumber: 2,
        episodeNumber: 3,
      });
      const op: SyncOperation = {
        type: 'video-update-metadata',
        source,
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'tvshow',
          title: 'Episode 1',
          seriesTitle: 'Original Name',
          seasonNumber: 2,
        },
        newSeriesTitle: 'Transformed Name',
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      const updateArg = mockIpod.mockTrack.update.mock.calls[0]![0];
      // For tvshow with newSeriesTitle, it uses newSeriesTitle
      expect(updateArg.artist).toBe('Transformed Name');
      expect(updateArg.album).toBe('Transformed Name, Season 2');
      expect(updateArg.tvShow).toBe('Transformed Name');
    });

    it('updates only series fields when newSeriesTitle set on non-tvshow/movie source', async () => {
      const mockIpod = createMockIpod();
      // Use a source with a contentType that is neither 'tvshow' nor 'movie'
      // to trigger the third branch (newSeriesTitle !== undefined)
      const source = makeVideoSource({
        contentType: undefined as any, // not tvshow or movie
        title: 'Test',
      });
      const op: SyncOperation = {
        type: 'video-update-metadata',
        source,
        video: {
          id: '/iPod_Control/Music/test.m4v',
          filePath: '/iPod_Control/Music/test.m4v',
          contentType: 'movie',
          title: 'Test',
          seasonNumber: 3,
        },
        newSeriesTitle: 'New Series',
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      const updateArg = mockIpod.mockTrack.update.mock.calls[0]![0];
      expect(updateArg.artist).toBe('New Series');
      expect(updateArg.album).toBe('New Series, Season 3');
      expect(updateArg.tvShow).toBe('New Series');
      // Should NOT have title, tvEpisode, trackNumber, discNumber (those are tvshow-branch-only)
      expect(updateArg.title).toBeUndefined();
    });

    it('throws when track not found in database', async () => {
      const mockIpod = createMockIpod();
      mockIpod.getTracks.mockReturnValue([]);

      const op: SyncOperation = {
        type: 'video-update-metadata',
        source: makeVideoSource(),
        video: {
          id: 'nonexistent',
          filePath: 'nonexistent',
          contentType: 'movie',
          title: 'Missing Video',
        },
      };

      await expect(collectProgress(handler.execute(op, makeCtx(mockIpod)))).rejects.toThrow(
        'Video track not found'
      );
    });
  });

  describe('executeBatch', () => {
    beforeEach(() => {
      mockMkdir.mockClear();
      mockRm.mockClear();
    });

    it('creates and cleans up temp dir for transcode operations', async () => {
      const mockIpod = createMockIpod();
      const ops: SyncOperation[] = [
        {
          type: 'video-transcode',
          source: makeVideoSource(),
          settings: defaultSettings,
        },
      ];

      const ctx: ExecutionContext = { ipod: mockIpod, tempDir: '/tmp/batch' };
      await collectProgress(handler.executeBatch!(ops, ctx));

      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockRm).toHaveBeenCalledTimes(1);
    });

    it('does not create temp dir for non-transcode operations', async () => {
      const mockIpod = createMockIpod();
      const ops: SyncOperation[] = [
        {
          type: 'video-remove',
          video: {
            id: '/iPod_Control/Music/test.m4v',
            filePath: '/iPod_Control/Music/test.m4v',
            contentType: 'movie' as const,
            title: 'Test',
          },
        },
      ];

      const ctx: ExecutionContext = { ipod: mockIpod, tempDir: '/tmp/batch' };
      await collectProgress(handler.executeBatch!(ops, ctx));

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('cleans up temp dir even when an operation throws', async () => {
      const mockIpod = createMockIpod();
      // First op: transcode (will trigger temp dir creation)
      // Second op: remove with nonexistent track (will throw)
      const ops: SyncOperation[] = [
        {
          type: 'video-transcode',
          source: makeVideoSource(),
          settings: defaultSettings,
        },
        {
          type: 'video-remove',
          video: {
            id: 'nonexistent',
            filePath: 'nonexistent',
            contentType: 'movie' as const,
            title: 'Missing',
          },
        },
      ];

      // Clear getTracks mock to make the second operation fail
      mockIpod.getTracks.mockReturnValue([]);

      const ctx: ExecutionContext = { ipod: mockIpod, tempDir: '/tmp/batch' };

      await expect(collectProgress(handler.executeBatch!(ops, ctx))).rejects.toThrow();

      // Even though an error occurred, cleanup should still happen (finally block)
      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockRm).toHaveBeenCalledTimes(1);
    });
  });

  describe('setVideoQuality (sync tag writing)', () => {
    it('writes sync tag to track comment when videoQuality is set', async () => {
      const mockIpod = createMockIpod();

      handler.setVideoQuality('medium');

      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeVideoSource(),
        settings: defaultSettings,
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      // Capture what addTrack was called with
      expect(mockIpod.addTrack).toHaveBeenCalledTimes(1);
      const trackInput = mockIpod.addTrack.mock.calls[0]![0];

      // The handler should have mutated the trackInput to include a sync tag
      expect(trackInput.comment).toBeDefined();
      expect(trackInput.comment).toContain('[podkit:v1');
      expect(trackInput.comment).toContain('quality=medium');
    });

    it('does not write sync tag when videoQuality is not set', async () => {
      const mockIpod = createMockIpod();

      // No setVideoQuality call — default behavior
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeVideoSource(),
        settings: defaultSettings,
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      const trackInput = mockIpod.addTrack.mock.calls[0]![0];
      // The mock createVideoTrackInput returns no comment field
      expect(trackInput.comment).toBeUndefined();
    });

    it('writes sync tag with different quality presets', async () => {
      const mockIpod = createMockIpod();

      handler.setVideoQuality('high');

      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeVideoSource(),
        settings: defaultSettings,
      };

      await collectProgress(handler.execute(op, makeCtx(mockIpod)));

      const trackInput = mockIpod.addTrack.mock.calls[0]![0];
      expect(trackInput.comment).toContain('quality=high');
    });
  });
});
