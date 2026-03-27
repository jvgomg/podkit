/**
 * Tests for the empty source abort safety guard.
 *
 * When a collection adapter returns zero tracks, the sync should refuse
 * to proceed, preventing accidental mass deletion if --delete is enabled.
 */

import { describe, expect, it, mock } from 'bun:test';
import { OutputContext } from '../output/index.js';
import { VideoPresenter } from './video-presenter.js';
import { genericSyncCollection, type VideoContentConfig } from './sync-presenter.js';

/**
 * Create a silent OutputContext for testing (suppresses all output)
 */
function createTestOutput(mode: 'text' | 'json' = 'text'): OutputContext {
  return new OutputContext({
    mode,
    quiet: true,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
  });
}

/**
 * Create a mock video adapter that returns zero videos
 */
function createMockVideoAdapter() {
  return {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    getItems: mock(async () => []),
  };
}

/**
 * Create args for genericSyncCollection with VideoPresenter that returns zero videos.
 */
function createVideoSyncArgs(
  overrides: Partial<{
    collectionName: string;
    sourcePath: string;
    devicePath: string;
    mode: 'text' | 'json';
  }> = {}
) {
  const mockVideoAdapter = createMockVideoAdapter();
  const out = createTestOutput(overrides.mode ?? 'text');
  const collection = {
    name: overrides.collectionName ?? 'movies',
    type: 'video' as const,
    config: { path: overrides.sourcePath ?? '/fake/videos' },
  };
  const sourcePath = overrides.sourcePath ?? '/fake/videos';
  const devicePath = overrides.devicePath ?? '/fake/ipod';
  const videoConfig: VideoContentConfig = {
    type: 'video',
    effectiveVideoQuality: 'high' as const,
    effectiveVideoTransforms: {
      showLanguage: { enabled: false, format: '', expand: false },
    },
    effectiveTransferMode: undefined,
    forceMetadata: false,
  };
  const core = {
    createVideoDirectoryAdapter: () => mockVideoAdapter,
    createVideoHandler: () => ({ getDeviceItems: () => [] }),
  } as never;

  return {
    out,
    collection,
    sourcePath,
    devicePath,
    videoConfig,
    core,
    mockVideoAdapter,
  };
}

describe('empty source abort', () => {
  describe('video collection with zero tracks (genericSyncCollection)', () => {
    it('returns failure when adapter returns zero videos', async () => {
      const args = createVideoSyncArgs();
      const result = await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(result.success).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('error message includes collection name', async () => {
      const args = createVideoSyncArgs({ collectionName: 'tv-shows', mode: 'json' });
      const result = await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(result.success).toBe(false);
      expect(result.jsonOutput).toBeDefined();
      expect(result.jsonOutput!.success).toBe(false);
      expect(result.jsonOutput!.error).toContain("'tv-shows'");
      expect(result.jsonOutput!.error).toContain('zero videos');
      expect(result.jsonOutput!.error).toContain('Check your source configuration');
    });

    it('includes source and device in JSON output', async () => {
      const args = createVideoSyncArgs({
        sourcePath: '/videos/collection',
        devicePath: '/Volumes/iPod',
        mode: 'json',
      });
      const result = await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(result.jsonOutput!.source).toBe('/videos/collection');
      expect(result.jsonOutput!.device).toBe('/Volumes/iPod');
    });

    it('returns no JSON output in text mode', async () => {
      const args = createVideoSyncArgs({ mode: 'text' });
      const result = await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(result.success).toBe(false);
      expect(result.jsonOutput).toBeUndefined();
    });

    it('disconnects adapter after zero-track abort (text mode)', async () => {
      const args = createVideoSyncArgs({ mode: 'text' });
      await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(args.mockVideoAdapter.disconnect).toHaveBeenCalled();
    });

    it('disconnects adapter after zero-track abort (JSON mode)', async () => {
      const args = createVideoSyncArgs({ mode: 'json' });
      await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      expect(args.mockVideoAdapter.disconnect).toHaveBeenCalled();
    });

    it('JSON output has correct structure', async () => {
      const args = createVideoSyncArgs({ collectionName: 'main', mode: 'json' });
      const result = await genericSyncCollection(
        new VideoPresenter(),
        args.out,
        args.collection,
        args.sourcePath,
        args.devicePath,
        false,
        false,
        args.videoConfig,
        null as never,
        args.core
      );

      const json = result.jsonOutput!;
      expect(json).toEqual(
        expect.objectContaining({
          success: false,
          dryRun: false,
          source: '/fake/videos',
          device: '/fake/ipod',
          error: expect.stringContaining('zero videos'),
        })
      );
    });
  });
});
