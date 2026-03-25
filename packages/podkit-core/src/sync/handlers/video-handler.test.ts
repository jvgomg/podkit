import { describe, expect, test } from 'bun:test';
import { VideoHandler, createVideoHandler } from './video-handler.js';
import { diffVideos, generateVideoMatchKey } from '../video-differ.js';
import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { IPodVideo } from '../video-differ.js';
import type { SyncOperation, SyncPlan } from '../types.js';
import { getVideoTransformMatchKeys } from '../../transforms/video-pipeline.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeCollectionVideo(overrides: Partial<CollectionVideo> = {}): CollectionVideo {
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
    duration: 7200, // 2 hours in seconds
    ...overrides,
  };
}

function makeTVShowVideo(overrides: Partial<CollectionVideo> = {}): CollectionVideo {
  return makeCollectionVideo({
    id: '/videos/show/s01e01.mkv',
    filePath: '/videos/show/s01e01.mkv',
    contentType: 'tvshow',
    title: 'Pilot',
    seriesTitle: 'Test Show',
    seasonNumber: 1,
    episodeNumber: 1,
    episodeId: 'S01E01',
    duration: 2700, // 45 min
    ...overrides,
  });
}

function makeIPodVideo(overrides: Partial<IPodVideo> = {}): IPodVideo {
  return {
    id: ':iPod_Control:Music:F00:test.m4v',
    filePath: ':iPod_Control:Music:F00:test.m4v',
    contentType: 'movie',
    title: 'Test Movie',
    year: 2024,
    duration: 7200,
    bitrate: 1500,
    ...overrides,
  };
}

function makeIPodTVShow(overrides: Partial<IPodVideo> = {}): IPodVideo {
  return makeIPodVideo({
    id: ':iPod_Control:Music:F01:show.m4v',
    filePath: ':iPod_Control:Music:F01:show.m4v',
    contentType: 'tvshow',
    title: 'Pilot',
    seriesTitle: 'Test Show',
    seasonNumber: 1,
    episodeNumber: 1,
    duration: 2700,
    ...overrides,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('VideoHandler', () => {
  const handler = createVideoHandler();

  test('type is "video"', () => {
    expect(handler.type).toBe('video');
  });

  test('createVideoHandler returns VideoHandler instance', () => {
    const h = createVideoHandler();
    expect(h).toBeInstanceOf(VideoHandler);
    expect(h.type).toBe('video');
  });

  describe('generateMatchKey', () => {
    test('generates movie key with title and year', () => {
      const video = makeCollectionVideo({ title: 'Inception', year: 2010 });
      const key = handler.generateMatchKey(video);
      expect(key).toContain('movie');
      expect(key).toContain('inception');
      expect(key).toContain('2010');
    });

    test('generates TV show key with series, season, episode', () => {
      const video = makeTVShowVideo({
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
      });
      const key = handler.generateMatchKey(video);
      expect(key).toContain('tvshow');
      expect(key).toContain('breaking bad');
      expect(key).toContain('s01e01');
    });

    test('generates consistent keys', () => {
      const video = makeCollectionVideo();
      expect(handler.generateMatchKey(video)).toBe(handler.generateMatchKey(video));
    });
  });

  describe('generateDeviceMatchKey', () => {
    test('generates key for iPod video', () => {
      const video = makeIPodVideo({ title: 'Inception', year: 2010 });
      const key = handler.generateDeviceMatchKey(video);
      expect(key).toContain('movie');
      expect(key).toContain('inception');
    });

    test('matches source key for same metadata', () => {
      const source = makeCollectionVideo({ title: 'Inception', year: 2010 });
      const device = makeIPodVideo({ title: 'Inception', year: 2010 });
      expect(handler.generateMatchKey(source)).toBe(handler.generateDeviceMatchKey(device));
    });

    test('matches TV show keys', () => {
      const source = makeTVShowVideo({ seriesTitle: 'Lost', seasonNumber: 1, episodeNumber: 1 });
      const device = makeIPodTVShow({ seriesTitle: 'Lost', seasonNumber: 1, episodeNumber: 1 });
      expect(handler.generateMatchKey(source)).toBe(handler.generateDeviceMatchKey(device));
    });
  });

  describe('getDeviceItemId', () => {
    test('returns video id', () => {
      const device = makeIPodVideo({ id: 'video-123' });
      expect(handler.getDeviceItemId(device)).toBe('video-123');
    });
  });

  describe('detectUpdates', () => {
    test('returns empty array when metadata matches', () => {
      const source = makeTVShowVideo({ seasonNumber: 1, episodeNumber: 1 });
      const device = makeIPodTVShow({ seasonNumber: 1, episodeNumber: 1 });
      const reasons = handler.detectUpdates(source, device, {});
      expect(reasons).toEqual([]);
    });

    test('detects season number correction', () => {
      const source = makeTVShowVideo({ seasonNumber: 2, episodeNumber: 1 });
      const device = makeIPodTVShow({ seasonNumber: 1, episodeNumber: 1 });
      const reasons = handler.detectUpdates(source, device, {});
      expect(reasons).toContain('metadata-correction');
    });

    test('detects episode number correction', () => {
      const source = makeTVShowVideo({ seasonNumber: 1, episodeNumber: 5 });
      const device = makeIPodTVShow({ seasonNumber: 1, episodeNumber: 3 });
      const reasons = handler.detectUpdates(source, device, {});
      expect(reasons).toContain('metadata-correction');
    });

    test('detects year correction', () => {
      const source = makeCollectionVideo({ year: 2024 });
      const device = makeIPodVideo({ year: 2023 });
      const reasons = handler.detectUpdates(source, device, {});
      expect(reasons).toContain('metadata-correction');
    });
  });

  describe('planAdd', () => {
    test('returns video-transcode operation', () => {
      const source = makeCollectionVideo();
      const op = handler.planAdd(source, {});
      expect(op.type).toBe('video-transcode');
    });

    test('includes settings with defaults', () => {
      const source = makeCollectionVideo();
      const op = handler.planAdd(source, { hardwareAcceleration: false });
      if (op.type === 'video-transcode') {
        expect(op.settings.useHardwareAcceleration).toBe(false);
        expect(op.settings.targetVideoBitrate).toBe(1500);
        expect(op.settings.targetAudioBitrate).toBe(128);
      }
    });
  });

  describe('planRemove', () => {
    test('returns video-remove operation', () => {
      const device = makeIPodVideo();
      const op = handler.planRemove(device);
      expect(op.type).toBe('video-remove');
      if (op.type === 'video-remove') {
        expect(op.video).toBe(device);
      }
    });
  });

  describe('planUpdate', () => {
    test('returns video-upgrade for preset-upgrade reason', () => {
      const source = makeCollectionVideo();
      const device = makeIPodVideo();
      const ops = handler.planUpdate(source, device, ['preset-upgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-upgrade');
    });

    test('returns video-update-metadata for metadata-correction', () => {
      const source = makeCollectionVideo();
      const device = makeIPodVideo();
      const ops = handler.planUpdate(source, device, ['metadata-correction']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-update-metadata');
    });

    test('returns empty array for no reasons', () => {
      const source = makeCollectionVideo();
      const device = makeIPodVideo();
      const ops = handler.planUpdate(source, device, []);
      expect(ops).toEqual([]);
    });
  });

  describe('estimateSize', () => {
    test('returns positive number for video-transcode', () => {
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeCollectionVideo({ duration: 3600 }),
        settings: {
          targetVideoBitrate: 1500,
          targetAudioBitrate: 128,
          targetWidth: 640,
          targetHeight: 480,
          videoProfile: 'baseline',
          videoLevel: '3.0',
          crf: 23,
          frameRate: 30,
          useHardwareAcceleration: true,
        },
      };
      expect(handler.estimateSize(op)).toBeGreaterThan(0);
    });

    test('returns 0 for video-remove', () => {
      const op: SyncOperation = { type: 'video-remove', video: makeIPodVideo() };
      expect(handler.estimateSize(op)).toBe(0);
    });

    test('returns 0 for non-video operation', () => {
      const op: SyncOperation = {
        type: 'remove',
        track: {
          artist: 'Test',
          title: 'Test',
          album: 'Test',
          filePath: ':test',
          duration: 0,
          bitrate: 0,
          sampleRate: 0,
          size: 0,
          mediaType: 1,
          timeAdded: 0,
          timeModified: 0,
          timePlayed: 0,
          timeReleased: 0,
          playCount: 0,
          skipCount: 0,
          rating: 0,
          hasArtwork: false,
          hasFile: true,
          compilation: false,
        } as any,
      };
      expect(handler.estimateSize(op)).toBe(0);
    });
  });

  describe('estimateTime', () => {
    test('returns positive number for video-transcode', () => {
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeCollectionVideo({ duration: 3600 }),
        settings: {
          targetVideoBitrate: 1500,
          targetAudioBitrate: 128,
          targetWidth: 640,
          targetHeight: 480,
          videoProfile: 'baseline',
          videoLevel: '3.0',
          crf: 23,
          frameRate: 30,
          useHardwareAcceleration: true,
        },
      };
      expect(handler.estimateTime(op)).toBeGreaterThan(0);
    });

    test('returns 0.1 for video-remove', () => {
      const op: SyncOperation = { type: 'video-remove', video: makeIPodVideo() };
      expect(handler.estimateTime(op)).toBe(0.1);
    });
  });

  describe('getDisplayName', () => {
    test('returns title for movie', () => {
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeCollectionVideo({ title: 'Inception', year: 2010 }),
        settings: {
          targetVideoBitrate: 1500,
          targetAudioBitrate: 128,
          targetWidth: 640,
          targetHeight: 480,
          videoProfile: 'baseline',
          videoLevel: '3.0',
          crf: 23,
          frameRate: 30,
          useHardwareAcceleration: true,
        },
      };
      const name = handler.getDisplayName(op);
      expect(name).toContain('Inception');
    });

    test('returns series - episode for TV show', () => {
      const op: SyncOperation = {
        type: 'video-transcode',
        source: makeTVShowVideo({ seriesTitle: 'Breaking Bad', episodeId: 'S01E01' }),
        settings: {
          targetVideoBitrate: 1500,
          targetAudioBitrate: 128,
          targetWidth: 640,
          targetHeight: 480,
          videoProfile: 'baseline',
          videoLevel: '3.0',
          crf: 23,
          frameRate: 30,
          useHardwareAcceleration: true,
        },
      };
      const name = handler.getDisplayName(op);
      expect(name).toContain('Breaking Bad');
      expect(name).toContain('S01E01');
    });

    test('returns title for video-remove', () => {
      const op: SyncOperation = {
        type: 'video-remove',
        video: makeIPodVideo({ title: 'Old Movie' }),
      };
      expect(handler.getDisplayName(op)).toContain('Old Movie');
    });
  });

  describe('formatDryRun', () => {
    test('summarizes a video plan', () => {
      const plan: SyncPlan = {
        operations: [
          {
            type: 'video-transcode',
            source: makeCollectionVideo(),
            settings: {
              targetVideoBitrate: 1500,
              targetAudioBitrate: 128,
              targetWidth: 640,
              targetHeight: 480,
              videoProfile: 'baseline',
              videoLevel: '3.0',
              crf: 23,
              frameRate: 30,
              useHardwareAcceleration: true,
            },
          },
          { type: 'video-remove', video: makeIPodVideo() },
          {
            type: 'video-update-metadata',
            source: makeTVShowVideo(),
            video: makeIPodTVShow(),
          },
        ],
        estimatedSize: 50000000,
        estimatedTime: 600,
        warnings: [],
      };

      const summary = handler.formatDryRun(plan);
      expect(summary.toAdd).toBe(1);
      expect(summary.toRemove).toBe(1);
      expect(summary.toUpdate).toBe(1);
      expect(summary.estimatedSize).toBe(50000000);
      expect(summary.estimatedTime).toBe(600);
      expect(summary.operationCounts['video-transcode']).toBe(1);
      expect(summary.operationCounts['video-remove']).toBe(1);
      expect(summary.operationCounts['video-update-metadata']).toBe(1);
    });
  });

  describe('planUpdate (additional branches)', () => {
    test('returns video-update-metadata for force-metadata reason', () => {
      const source = makeCollectionVideo();
      const device = makeIPodVideo();
      const ops = handler.planUpdate(source, device, ['force-metadata']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-update-metadata');
    });

    test('returns video-upgrade for preset-downgrade reason', () => {
      const source = makeCollectionVideo();
      const device = makeIPodVideo();
      const ops = handler.planUpdate(source, device, ['preset-downgrade']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-upgrade');
      if (ops[0]!.type === 'video-upgrade') {
        expect(ops[0]!.reason).toBe('preset-downgrade');
      }
    });

    test('returns video-update-metadata for transform-apply reason', () => {
      const source = makeTVShowVideo();
      const device = makeIPodTVShow();
      const ops = handler.planUpdate(source, device, ['transform-apply']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-update-metadata');
    });

    test('returns video-update-metadata for transform-remove reason', () => {
      const source = makeTVShowVideo();
      const device = makeIPodTVShow();
      const ops = handler.planUpdate(source, device, ['transform-remove']);
      expect(ops.length).toBe(1);
      expect(ops[0]!.type).toBe('video-update-metadata');
    });
  });
});

// =============================================================================
// diffVideos integration tests (preset change detection, force-metadata)
//
// These test the diff logic from video-differ.ts that VideoHandler delegates to.
// =============================================================================

describe('diffVideos — preset change detection', () => {
  test('moves existing items to toUpdate when bitrate differs from presetBitrate', () => {
    const source = makeCollectionVideo({ title: 'Movie A', year: 2020 });
    const device = makeIPodVideo({
      title: 'Movie A',
      year: 2020,
      bitrate: 800, // Much lower than preset
    });

    const diff = diffVideos([source], [device], {
      presetBitrate: 1500,
    });

    expect(diff.existing.length).toBe(0);
    expect(diff.toUpdate.length).toBe(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-change');
  });

  test('keeps items in existing when bitrate matches presetBitrate', () => {
    const source = makeCollectionVideo({ title: 'Movie B', year: 2021 });
    const device = makeIPodVideo({
      title: 'Movie B',
      year: 2021,
      bitrate: 1500, // Matches preset
    });

    const diff = diffVideos([source], [device], {
      presetBitrate: 1500,
    });

    expect(diff.existing.length).toBe(1);
    expect(diff.toUpdate.length).toBe(0);
  });

  test('uses sync tag comparison when comment has sync tag', () => {
    const source = makeCollectionVideo({ title: 'Movie C', year: 2022 });
    const device = makeIPodVideo({
      title: 'Movie C',
      year: 2022,
      bitrate: 1500,
      comment: '[podkit:v1 quality=low]', // Tag says low, but preset is medium
      syncTag: { quality: 'low' }, // Pre-computed sync tag
    });

    const diff = diffVideos([source], [device], {
      presetBitrate: 1500,
      resolvedVideoQuality: 'medium', // Mismatch with sync tag quality=low
    });

    expect(diff.existing.length).toBe(0);
    expect(diff.toUpdate.length).toBe(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-change');
  });

  test('keeps items in existing when sync tag matches resolved quality', () => {
    const source = makeCollectionVideo({ title: 'Movie D', year: 2023 });
    const device = makeIPodVideo({
      title: 'Movie D',
      year: 2023,
      bitrate: 1500,
      comment: '[podkit:v1 quality=medium]',
      syncTag: { quality: 'medium' }, // Pre-computed sync tag
    });

    const diff = diffVideos([source], [device], {
      presetBitrate: 1500,
      resolvedVideoQuality: 'medium', // Matches sync tag
    });

    expect(diff.existing.length).toBe(1);
    expect(diff.toUpdate.length).toBe(0);
  });
});

describe('diffVideos — force-metadata', () => {
  test('moves all existing items to toUpdate with force-metadata reason', () => {
    const sources = [
      makeCollectionVideo({ title: 'Movie 1', year: 2020 }),
      makeTVShowVideo({ seriesTitle: 'Show 1', seasonNumber: 1, episodeNumber: 1 }),
    ];
    const devices = [
      makeIPodVideo({ title: 'Movie 1', year: 2020 }),
      makeIPodTVShow({ seriesTitle: 'Show 1', seasonNumber: 1, episodeNumber: 1 }),
    ];

    const diff = diffVideos(sources, devices, {
      forceMetadata: true,
    });

    expect(diff.existing.length).toBe(0);
    expect(diff.toUpdate.length).toBe(2);
    expect(diff.toUpdate.every((u) => u.reason === 'force-metadata')).toBe(true);
  });

  test('sets newSeriesTitle on tvshow items during force-metadata', () => {
    const source = makeTVShowVideo({ seriesTitle: 'My Show', seasonNumber: 1, episodeNumber: 1 });
    const device = makeIPodTVShow({ seriesTitle: 'My Show', seasonNumber: 1, episodeNumber: 1 });

    const diff = diffVideos([source], [device], {
      forceMetadata: true,
    });

    expect(diff.toUpdate.length).toBe(1);
    expect(diff.toUpdate[0]!.newSeriesTitle).toBe('My Show');
  });
});

describe('diffVideos — metadata correction detection', () => {
  test('different season numbers produce different keys (toAdd/toRemove, not update)', () => {
    const source = makeTVShowVideo({ seriesTitle: 'Show', seasonNumber: 2, episodeNumber: 1 });
    const device = makeIPodTVShow({ seriesTitle: 'Show', seasonNumber: 1, episodeNumber: 1 });

    const diff = diffVideos([source], [device]);

    // Season number is part of the match key, so s02e01 vs s01e01 are different items
    expect(diff.toAdd.length).toBe(1);
    expect(diff.toRemove.length).toBe(1);
    expect(diff.toUpdate.length).toBe(0);
  });

  test('detects year mismatch on movies', () => {
    // Movies match on "movie:title" when year is not present, so a year correction
    // is when one has a year and the other doesn't — but actually the key includes year.
    // For year mismatch to be detected as metadata correction, the keys must match first.
    // Use a movie without year in key (year = 0 or missing from one side).
    const source = makeCollectionVideo({ title: 'Test Film', year: 2024 });
    const device = makeIPodVideo({ title: 'Test Film', year: 2023 });

    // Both generate "movie:test film:2024" vs "movie:test film:2023" — different keys.
    // They won't match. This is expected — year is part of the key for movies.
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd.length).toBe(1);
    expect(diff.toRemove.length).toBe(1);
  });

  test('detects year mismatch when year was missing in key', () => {
    // A movie with no year in source but with year on device can still match
    // if neither has a "valid" year for key generation (year <= 1800 or >= 2100)
    const source = makeCollectionVideo({ title: 'No Year Movie', year: undefined });
    const device = makeIPodVideo({ title: 'No Year Movie', year: undefined });

    // Both generate "movie:no year movie" — same key, they match.
    // No year mismatch since both are undefined.
    const diff = diffVideos([source], [device]);
    expect(diff.existing.length).toBe(1);
    expect(diff.toUpdate.length).toBe(0);
  });
});

// =============================================================================
// generateVideoMatchKey tests
// =============================================================================

describe('generateVideoMatchKey', () => {
  describe('movies', () => {
    test('generates key for movie without year', () => {
      const key = generateVideoMatchKey({ contentType: 'movie', title: 'The Matrix' });
      expect(key).toBe('movie:the matrix');
    });

    test('generates key for movie with year', () => {
      const key = generateVideoMatchKey({ contentType: 'movie', title: 'The Matrix', year: 1999 });
      expect(key).toBe('movie:the matrix:1999');
    });

    test('normalizes title (lowercase, trim, remove special chars)', () => {
      const key = generateVideoMatchKey({
        contentType: 'movie',
        title: '  The Matrix: Reloaded!  ',
        year: 2003,
      });
      expect(key).toBe('movie:the matrix reloaded:2003');
    });

    test('ignores invalid years (too old or too far in future)', () => {
      const key1 = generateVideoMatchKey({ contentType: 'movie', title: 'Test', year: 1800 });
      expect(key1).toBe('movie:test');

      const key2 = generateVideoMatchKey({ contentType: 'movie', title: 'Test', year: 2100 });
      expect(key2).toBe('movie:test');
    });
  });

  describe('TV shows', () => {
    test('generates key for TV episode with series title', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'Pilot',
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
      });
      expect(key).toBe('tvshow:breaking bad:s01e01');
    });

    test('falls back to episode title if no series title', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'The One Where They All Find Out',
        seasonNumber: 5,
        episodeNumber: 14,
      });
      expect(key).toBe('tvshow:the one where they all find out:s05e14');
    });

    test('handles missing season/episode numbers', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'Special Episode',
        seriesTitle: 'Doctor Who',
      });
      expect(key).toBe('tvshow:doctor who:special episode');
    });

    test('pads season and episode numbers', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'Episode',
        seriesTitle: 'Test Show',
        seasonNumber: 1,
        episodeNumber: 5,
      });
      expect(key).toBe('tvshow:test show:s01e05');
    });
  });
});

// =============================================================================
// diffVideos — empty and basic matching scenarios
// =============================================================================

describe('diffVideos — empty scenarios', () => {
  test('handles empty collection and empty iPod', () => {
    const diff = diffVideos([], []);
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
    expect(diff.existing).toEqual([]);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('adds all videos when iPod is empty', () => {
    const sources = [
      makeCollectionVideo({ title: 'Movie 1', year: 2020 }),
      makeCollectionVideo({ title: 'Movie 2', year: 2021 }),
    ];
    const diff = diffVideos(sources, []);
    expect(diff.toAdd).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
  });

  test('removes all videos when collection is empty', () => {
    const devices = [
      makeIPodVideo({ title: 'Movie 1', year: 2020 }),
      makeIPodVideo({ title: 'Movie 2', year: 2021 }),
    ];
    const diff = diffVideos([], devices);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(2);
    expect(diff.existing).toHaveLength(0);
  });
});

describe('diffVideos — movie matching', () => {
  test('matches movies by title', () => {
    const source = makeCollectionVideo({ title: 'The Matrix', year: undefined });
    const device = makeIPodVideo({ title: 'The Matrix', year: undefined });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
    expect(diff.existing[0]!.collection.title).toBe('The Matrix');
  });

  test('matches movies by title and year', () => {
    const source = makeCollectionVideo({ title: 'The Matrix', year: 1999 });
    const device = makeIPodVideo({ title: 'The Matrix', year: 1999 });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  test('distinguishes movies with same title but different years', () => {
    const source = makeCollectionVideo({ title: 'Dune', year: 2021 });
    const device = makeIPodVideo({ title: 'Dune', year: 1984 });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  test('matches with case-insensitive comparison', () => {
    const source = makeCollectionVideo({ title: 'THE MATRIX', year: undefined });
    const device = makeIPodVideo({ title: 'the matrix', year: undefined });
    const diff = diffVideos([source], [device]);
    expect(diff.existing).toHaveLength(1);
  });
});

describe('diffVideos — TV show matching', () => {
  test('matches TV episodes by series/season/episode', () => {
    const source = makeTVShowVideo({
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const device = makeIPodTVShow({
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  test('distinguishes different episodes of same series', () => {
    const sources = [
      makeTVShowVideo({ seriesTitle: 'Breaking Bad', seasonNumber: 1, episodeNumber: 1 }),
      makeTVShowVideo({
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 2,
        id: '/videos/s01e02.mkv',
        filePath: '/videos/s01e02.mkv',
      }),
    ];
    const devices = [
      makeIPodTVShow({ seriesTitle: 'Breaking Bad', seasonNumber: 1, episodeNumber: 1 }),
    ];
    const diff = diffVideos(sources, devices);
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.episodeNumber).toBe(2);
    expect(diff.existing).toHaveLength(1);
  });

  test('distinguishes different seasons of same series', () => {
    const source = makeTVShowVideo({ seriesTitle: 'Show', seasonNumber: 2, episodeNumber: 1 });
    const device = makeIPodTVShow({ seriesTitle: 'Show', seasonNumber: 1, episodeNumber: 1 });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
  });
});

describe('diffVideos — mixed content scenarios', () => {
  test('handles movies and TV shows together', () => {
    const sources = [
      makeCollectionVideo({ title: 'The Matrix', year: 1999 }),
      makeTVShowVideo({ seriesTitle: 'Breaking Bad', seasonNumber: 1, episodeNumber: 1 }),
    ];
    const devices = [
      makeIPodVideo({ title: 'The Matrix', year: 1999 }),
      makeIPodVideo({
        title: 'Old Movie',
        year: 2000,
        id: ':iPod_Control:Music:F02:old.m4v',
        filePath: ':iPod_Control:Music:F02:old.m4v',
      }),
    ];
    const diff = diffVideos(sources, devices);
    expect(diff.toAdd).toHaveLength(1); // Breaking Bad S01E01
    expect(diff.toRemove).toHaveLength(1); // Old Movie
    expect(diff.existing).toHaveLength(1); // The Matrix
  });

  test('does not match movie with TV show of same name', () => {
    const source = makeCollectionVideo({ title: 'Fargo', year: 1996 });
    const device = makeIPodTVShow({ seriesTitle: 'Fargo', seasonNumber: 1, episodeNumber: 1 });
    const diff = diffVideos([source], [device]);
    expect(diff.toAdd).toHaveLength(1); // Movie
    expect(diff.toRemove).toHaveLength(1); // TV episode
    expect(diff.existing).toHaveLength(0);
  });
});

describe('diffVideos — duplicate handling', () => {
  test('handles duplicate videos on iPod (first wins)', () => {
    const source = makeCollectionVideo({ title: 'The Matrix', year: undefined });
    const devices = [
      makeIPodVideo({ id: 'first', filePath: ':first', title: 'The Matrix', year: undefined }),
      makeIPodVideo({ id: 'second', filePath: ':second', title: 'The Matrix', year: undefined }),
    ];
    const diff = diffVideos([source], devices);
    expect(diff.existing).toHaveLength(1);
    expect(diff.existing[0]!.ipod.id).toBe('first');
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.id).toBe('second');
  });
});

// =============================================================================
// diffVideos — additional preset change scenarios
// =============================================================================

describe('diffVideos — preset change (additional scenarios)', () => {
  test('does not detect preset change when presetBitrate is not set', () => {
    const source = makeCollectionVideo({ title: 'Movie', year: 2020 });
    const device = makeIPodVideo({ title: 'Movie', year: 2020, bitrate: 100 });
    const diff = diffVideos([source], [device]);
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('does not detect preset change when iPod has no bitrate', () => {
    const source = makeCollectionVideo({ title: 'Movie', year: 2020 });
    const device = makeIPodVideo({ title: 'Movie', year: 2020, bitrate: undefined });
    const diff = diffVideos([source], [device], { presetBitrate: 728 });
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('does not detect preset change when iPod bitrate is below minimum threshold', () => {
    const source = makeCollectionVideo({ title: 'Movie', year: 2020 });
    const device = makeIPodVideo({ title: 'Movie', year: 2020, bitrate: 30 });
    const diff = diffVideos([source], [device], { presetBitrate: 728 });
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('detects both upgrade and downgrade in the same diff', () => {
    const sources = [
      makeCollectionVideo({ title: 'Movie A', year: 2020 }),
      makeCollectionVideo({
        title: 'Movie B',
        year: 2021,
        id: '/videos/b.mkv',
        filePath: '/videos/b.mkv',
      }),
    ];
    const devices = [
      makeIPodVideo({ title: 'Movie A', year: 2020, bitrate: 396, id: ':a', filePath: ':a' }), // low → upgrade
      makeIPodVideo({ title: 'Movie B', year: 2021, bitrate: 1200, id: ':b', filePath: ':b' }), // high → downgrade
    ];
    const diff = diffVideos(sources, devices, { presetBitrate: 728 });
    expect(diff.toUpdate).toHaveLength(2);
    expect(diff.toUpdate.every((u) => u.reason === 'preset-change')).toBe(true);
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// diffVideos — video transform dual-key matching
// =============================================================================

describe('diffVideos — video transform dual-key matching', () => {
  test('queues transform-apply when iPod has original metadata and transform is enabled', () => {
    const source = makeTVShowVideo({
      seriesTitle: 'Digimon Adventure (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const device = makeIPodTVShow({
      seriesTitle: 'Digimon Adventure (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    const diff = diffVideos([source], [device], {
      videoTransforms: { showLanguage: { enabled: true, format: '({})', expand: true } },
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('transform-apply');
    expect(diff.toUpdate[0]!.newSeriesTitle).toBe('Digimon Adventure (Japanese)');
  });

  test('queues transform-remove when iPod has transformed metadata and transform is disabled', () => {
    const source = makeTVShowVideo({
      seriesTitle: 'Digimon Adventure (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    // iPod has the expanded name (previously synced with transform enabled)
    const device = makeIPodTVShow({
      seriesTitle: 'Digimon Adventure (Japanese)',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    const diff = diffVideos([source], [device], {
      videoTransforms: { showLanguage: { enabled: false, format: '({})', expand: true } },
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('transform-remove');
    expect(diff.toUpdate[0]!.newSeriesTitle).toBe('Digimon Adventure (JPN)');
  });

  test('marks as existing when transform is enabled and iPod already has transformed data', () => {
    const source = makeTVShowVideo({
      seriesTitle: 'Digimon Adventure (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    // iPod already has the expanded name
    const device = makeIPodTVShow({
      seriesTitle: 'Digimon Adventure (Japanese)',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    const diff = diffVideos([source], [device], {
      videoTransforms: { showLanguage: { enabled: true, format: '({})', expand: true } },
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('no transform changes when no language marker present', () => {
    const source = makeTVShowVideo({
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const device = makeIPodTVShow({
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    const diff = diffVideos([source], [device], {
      videoTransforms: { showLanguage: { enabled: true, format: '({})', expand: true } },
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  test('initializes toUpdate as empty array when no transforms configured', () => {
    const diff = diffVideos([], []);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// getVideoTransformMatchKeys tests
// =============================================================================

describe('getVideoTransformMatchKeys', () => {
  test('generates different keys when transform would apply', () => {
    const video = {
      contentType: 'tvshow' as const,
      title: 'S01E01',
      seriesTitle: 'Show (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const result = getVideoTransformMatchKeys(video, generateVideoMatchKey, {
      showLanguage: { enabled: true, format: '({})', expand: true },
    });
    expect(result.originalKey).not.toBe(result.transformedKey);
    expect(result.transformApplied).toBe(true);
    expect(result.transformedSeriesTitle).toBe('Show (Japanese)');
  });

  test('generates same keys when no language marker', () => {
    const video = {
      contentType: 'tvshow' as const,
      title: 'S01E01',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const result = getVideoTransformMatchKeys(video, generateVideoMatchKey, {
      showLanguage: { enabled: true, format: '({})', expand: true },
    });
    expect(result.originalKey).toBe(result.transformedKey);
    expect(result.transformApplied).toBe(false);
  });

  test('returns original key when no transforms configured', () => {
    const video = {
      contentType: 'tvshow' as const,
      title: 'S01E01',
      seriesTitle: 'Show (JPN)',
      seasonNumber: 1,
      episodeNumber: 1,
    };
    const result = getVideoTransformMatchKeys(video, generateVideoMatchKey);
    expect(result.originalKey).toBe(result.transformedKey);
    expect(result.transformApplied).toBe(false);
  });
});

// =============================================================================
// diffVideos — force-metadata (additional scenarios)
// =============================================================================

describe('diffVideos — force-metadata (additional scenarios)', () => {
  test('does not set newSeriesTitle for movies', () => {
    const source = makeCollectionVideo({ title: 'Inception', year: 2010 });
    const device = makeIPodVideo({ title: 'Inception', year: 2010 });
    const diff = diffVideos([source], [device], { forceMetadata: true });
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.newSeriesTitle).toBeUndefined();
  });

  test('still adds new videos when forceMetadata is true', () => {
    const sources = [
      makeCollectionVideo({ title: 'The Matrix', year: 1999 }),
      makeCollectionVideo({
        title: 'Inception',
        year: 2010,
        id: '/videos/inception.mkv',
        filePath: '/videos/inception.mkv',
      }),
    ];
    const devices = [makeIPodVideo({ title: 'The Matrix', year: 1999 })];
    const diff = diffVideos(sources, devices, { forceMetadata: true });
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.title).toBe('Inception');
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('force-metadata');
  });

  test('still identifies removals when forceMetadata is true', () => {
    const sources = [makeCollectionVideo({ title: 'The Matrix', year: 1999 })];
    const devices = [
      makeIPodVideo({ title: 'The Matrix', year: 1999, id: ':matrix', filePath: ':matrix' }),
      makeIPodVideo({ title: 'Old Movie', year: 2000, id: ':old', filePath: ':old' }),
    ];
    const diff = diffVideos(sources, devices, { forceMetadata: true });
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.title).toBe('Old Movie');
    expect(diff.toUpdate).toHaveLength(1);
  });

  test('does not move tracks to toUpdate when forceMetadata is false', () => {
    const source = makeCollectionVideo({ title: 'The Matrix', year: 1999 });
    const device = makeIPodVideo({ title: 'The Matrix', year: 1999 });
    const diff = diffVideos([source], [device], { forceMetadata: false });
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });
});
