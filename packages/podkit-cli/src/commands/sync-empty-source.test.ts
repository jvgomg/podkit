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
 * Build a complete args bag for `genericSyncCollection` plus the mock
 * adapter handle so tests can assert on its calls. Return type inferred so
 * `args.presenter` carries `VideoPresenter`'s concrete generics — no cast
 * needed at the `genericSyncCollection(args)` call site.
 */
function buildVideoSyncCall(
  overrides: Partial<{
    collectionName: string;
    sourcePath: string;
    devicePath: string;
    mode: 'text' | 'json';
  }> = {}
) {
  const mockVideoAdapter = createMockVideoAdapter();
  const videoConfig: VideoContentConfig = {
    type: 'video',
    effectiveVideoQuality: 'high' as const,
    effectiveVideoTransforms: {
      showLanguage: { enabled: false, format: '', expand: false },
    },
    effectiveTransferMode: undefined,
    forceMetadata: false,
  };

  return {
    args: {
      presenter: new VideoPresenter(),
      out: createTestOutput(overrides.mode ?? 'text'),
      collection: {
        name: overrides.collectionName ?? 'movies',
        type: 'video' as const,
        config: { path: overrides.sourcePath ?? '/fake/videos' },
      },
      sourcePath: overrides.sourcePath ?? '/fake/videos',
      devicePath: overrides.devicePath ?? '/fake/ipod',
      dryRun: false,
      removeOrphans: false,
      contentConfig: videoConfig,
      ipod: null as never,
      core: {
        createVideoDirectoryAdapter: () => mockVideoAdapter,
        createVideoHandler: () => ({ getDeviceItems: () => [] }),
      } as never,
    },
    mockVideoAdapter,
  };
}

describe('empty source abort', () => {
  describe('video collection with zero tracks (genericSyncCollection)', () => {
    it('returns failure when adapter returns zero videos', async () => {
      const { args } = buildVideoSyncCall();
      const result = await genericSyncCollection(args);

      expect(result.success).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('error message includes collection name', async () => {
      const { args } = buildVideoSyncCall({ collectionName: 'tv-shows', mode: 'json' });
      const result = await genericSyncCollection(args);

      expect(result.success).toBe(false);
      expect(result.jsonOutput).toBeDefined();
      expect(result.jsonOutput!.success).toBe(false);
      expect(result.jsonOutput!.error).toContain("'tv-shows'");
      expect(result.jsonOutput!.error).toContain('zero videos');
      expect(result.jsonOutput!.error).toContain('Check your source configuration');
    });

    it('includes source and device in JSON output', async () => {
      const { args } = buildVideoSyncCall({
        sourcePath: '/videos/collection',
        devicePath: '/Volumes/iPod',
        mode: 'json',
      });
      const result = await genericSyncCollection(args);

      expect(result.jsonOutput!.source).toBe('/videos/collection');
      expect(result.jsonOutput!.device).toBe('/Volumes/iPod');
    });

    it('returns no JSON output in text mode', async () => {
      const { args } = buildVideoSyncCall({ mode: 'text' });
      const result = await genericSyncCollection(args);

      expect(result.success).toBe(false);
      expect(result.jsonOutput).toBeUndefined();
    });

    it('disconnects adapter after zero-track abort (text mode)', async () => {
      const { args, mockVideoAdapter } = buildVideoSyncCall({ mode: 'text' });
      await genericSyncCollection(args);

      expect(mockVideoAdapter.disconnect).toHaveBeenCalled();
    });

    it('disconnects adapter after zero-track abort (JSON mode)', async () => {
      const { args, mockVideoAdapter } = buildVideoSyncCall({ mode: 'json' });
      await genericSyncCollection(args);

      expect(mockVideoAdapter.disconnect).toHaveBeenCalled();
    });

    it('JSON output has correct structure', async () => {
      const { args } = buildVideoSyncCall({ collectionName: 'main', mode: 'json' });
      const result = await genericSyncCollection(args);

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
