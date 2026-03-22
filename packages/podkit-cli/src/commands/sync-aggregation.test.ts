/**
 * Tests for album/artist/video aggregation in sync dry-run JSON output.
 *
 * These tests verify that the dry-run JSON output includes aggregate counts
 * (albumCount, artistCount, videoSummary) derived from the plan's track data.
 */

import { describe, expect, it } from 'bun:test';
import { OutputContext } from '../output/index.js';
import { MusicPresenter, type MusicContentConfig } from './sync-presenter.js';
import type { SyncOutput } from './sync.js';

/**
 * Create a silent JSON OutputContext for testing
 */
function createJsonOutput(): OutputContext {
  return new OutputContext({
    mode: 'json',
    quiet: true,
    verbose: 0,
    color: false,
    tips: false,
  });
}

/**
 * Build music dry-run JSON output using MusicPresenter.
 * This is a helper that wraps the presenter method to match the old test interface.
 */
function buildMusicDryRunOutput(ctx: {
  out: OutputContext;
  sourcePath: string;
  devicePath: string;
  effectiveQuality: string;
  effectiveTransforms: any;
  skipUpgrades: boolean;
  diff: any;
  plan: any;
  summary: any;
  storage: any;
  hasEnoughSpace: boolean;
  removeOrphans: boolean;
  scanWarnings: any[];
  core: any;
}): SyncOutput {
  const presenter = new MusicPresenter();
  const musicConfig: MusicContentConfig = {
    type: 'music',
    effectiveTransforms: ctx.effectiveTransforms,
    effectiveQuality: ctx.effectiveQuality as any,
    effectiveEncoding: undefined,
    effectiveCustomBitrate: undefined,
    effectiveBitrateTolerance: undefined,
    deviceSupportsAlac: false,
    effectiveArtwork: true,
    skipUpgrades: ctx.skipUpgrades,
    forceTranscode: false,
    forceSyncTags: false,
    forceMetadata: false,
    checkArtwork: false,
    transcoder: null as never,
  };
  return presenter.buildDryRunJson(
    ctx.out,
    ctx.sourcePath,
    ctx.devicePath,
    ctx.diff,
    ctx.plan,
    ctx.summary,
    ctx.removeOrphans,
    musicConfig,
    ctx.core,
    ctx.scanWarnings,
    ctx.diff.toAdd // sourceItems
  );
}

/**
 * Create a minimal context with the given tracks to add.
 * Only the fields needed for aggregation are populated; everything else
 * is stubbed to satisfy the type constraints.
 */
function createMusicDryRunCtx(
  tracksToAdd: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist?: string;
    filePath?: string;
    format?: string;
  }>
) {
  const diff = {
    toAdd: tracksToAdd.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumArtist: t.albumArtist,
      filePath: t.filePath ?? `/music/${t.id}.flac`,
      format: t.format ?? 'flac',
    })),
    toRemove: [],
    toUpdate: [],
    existing: [],
  };

  const plan = {
    operations: [],
    estimatedSize: 0,
    estimatedTime: 0,
    warnings: [],
  };

  const summary = {
    transcodeCount: 0,
    copyCount: 0,
    upgradeCount: 0,
  };

  return {
    out: createJsonOutput(),
    sourcePath: '/music',
    devicePath: '/ipod',
    effectiveQuality: 'high',
    effectiveTransforms: {
      cleanArtists: { enabled: false, format: '', drop: false, ignore: [] },
    },
    skipUpgrades: false,
    diff: diff as any,
    plan: plan as any,
    summary: summary as any,
    storage: null,
    hasEnoughSpace: true,
    removeOrphans: false,
    scanWarnings: [],
    core: {
      getOperationDisplayName: (_op: unknown) => 'mock',
      getPlanSummary: () => summary,
      applyTransforms: (t: unknown) => t,
    } as any,
  };
}

describe('sync dry-run JSON aggregation', () => {
  describe('albumCount and artistCount', () => {
    it('counts unique albums from tracks to add', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Song 1', artist: 'Artist A', album: 'Album X' },
        { id: '2', title: 'Song 2', artist: 'Artist A', album: 'Album X' },
        { id: '3', title: 'Song 3', artist: 'Artist B', album: 'Album Y' },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.albumCount).toBe(2);
    });

    it('counts unique artists from tracks to add', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Song 1', artist: 'Artist A', album: 'Album X' },
        { id: '2', title: 'Song 2', artist: 'Artist A', album: 'Album X' },
        { id: '3', title: 'Song 3', artist: 'Artist B', album: 'Album Y' },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.artistCount).toBe(2);
    });

    it('prefers albumArtist over artist for artist count', () => {
      const ctx = createMusicDryRunCtx([
        {
          id: '1',
          title: 'Song 1',
          artist: 'Feat Artist',
          album: 'Album X',
          albumArtist: 'Main Artist',
        },
        {
          id: '2',
          title: 'Song 2',
          artist: 'Another Feat',
          album: 'Album X',
          albumArtist: 'Main Artist',
        },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      // Both tracks have the same albumArtist, so count should be 1
      expect(output.plan?.artistCount).toBe(1);
    });

    it('falls back to artist when albumArtist is not set', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Song 1', artist: 'Artist A', album: 'Album X' },
        {
          id: '2',
          title: 'Song 2',
          artist: 'Artist B',
          album: 'Album Y',
          albumArtist: 'Artist C',
        },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      // Artist A (no albumArtist) and Artist C (albumArtist overrides Artist B)
      expect(output.plan?.artistCount).toBe(2);
    });

    it('omits albumCount and artistCount when no tracks to add', () => {
      const ctx = createMusicDryRunCtx([]);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.albumCount).toBeUndefined();
      expect(output.plan?.artistCount).toBeUndefined();
    });

    it('handles single track correctly', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Only Song', artist: 'Solo Artist', album: 'Solo Album' },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.albumCount).toBe(1);
      expect(output.plan?.artistCount).toBe(1);
    });

    it('handles many albums by many artists', () => {
      const tracks = [];
      for (let a = 0; a < 5; a++) {
        for (let al = 0; al < 3; al++) {
          tracks.push({
            id: `${a}-${al}`,
            title: `Song ${a}-${al}`,
            artist: `Artist ${a}`,
            album: `Album ${a}-${al}`,
          });
        }
      }
      const ctx = createMusicDryRunCtx(tracks);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.albumCount).toBe(15); // 5 artists * 3 albums each
      expect(output.plan?.artistCount).toBe(5);
    });

    it('filters out empty album names', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Song 1', artist: 'Artist A', album: '' },
        { id: '2', title: 'Song 2', artist: 'Artist A', album: 'Real Album' },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      // Empty album string is filtered out by .filter(Boolean)
      expect(output.plan?.albumCount).toBe(1);
    });
  });

  describe('videoSummary is not present for music plans', () => {
    it('does not include videoSummary in music dry-run output', () => {
      const ctx = createMusicDryRunCtx([
        { id: '1', title: 'Song 1', artist: 'Artist A', album: 'Album X' },
      ]);

      const output = buildMusicDryRunOutput(ctx);

      expect(output.plan?.videoSummary).toBeUndefined();
    });
  });
});

describe('SyncOutput type structure', () => {
  it('plan includes optional albumCount field', () => {
    // Type-level test: ensures the field exists on the type
    const output: SyncOutput = {
      success: true,
      dryRun: true,
      plan: {
        tracksToAdd: 10,
        tracksToRemove: 0,
        tracksToUpdate: 0,
        tracksToUpgrade: 0,
        tracksToTranscode: 5,
        tracksToCopy: 5,
        tracksExisting: 20,
        estimatedSize: 1000,
        estimatedTime: 60,
        albumCount: 3,
        artistCount: 2,
      },
    };
    expect(output.plan?.albumCount).toBe(3);
    expect(output.plan?.artistCount).toBe(2);
  });

  it('plan includes optional videoSummary field', () => {
    const output: SyncOutput = {
      success: true,
      dryRun: true,
      plan: {
        tracksToAdd: 5,
        tracksToRemove: 0,
        tracksToUpdate: 0,
        tracksToUpgrade: 0,
        tracksToTranscode: 3,
        tracksToCopy: 2,
        tracksExisting: 10,
        estimatedSize: 5000,
        estimatedTime: 300,
        videoSummary: {
          movieCount: 2,
          showCount: 1,
          episodeCount: 3,
        },
      },
    };
    expect(output.plan?.videoSummary?.movieCount).toBe(2);
    expect(output.plan?.videoSummary?.showCount).toBe(1);
    expect(output.plan?.videoSummary?.episodeCount).toBe(3);
  });
});
