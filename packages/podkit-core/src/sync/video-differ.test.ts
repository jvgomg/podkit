/**
 * Unit tests for the video diff engine
 *
 * These tests verify the comparison logic that determines what video files
 * need to be synced between a video collection and an iPod device.
 *
 * ## Test Coverage
 *
 * 1. Empty scenarios (empty collection, empty iPod, both empty)
 * 2. Identical collections (nothing to sync)
 * 3. Fresh iPod scenarios (all videos to add)
 * 4. Mixed scenarios (some new, some existing, some removed)
 * 5. Movie matching (by title and year)
 * 6. TV show matching (by series, season, episode)
 * 7. Match key generation
 */

import { describe, expect, it } from 'bun:test';
import {
  diffVideos,
  generateVideoMatchKey,
  createVideoDiffer,
  DefaultVideoSyncDiffer,
} from './video-differ.js';
import type { IPodVideo } from './video-differ.js';
import type { CollectionVideo } from '../video/directory-adapter.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal CollectionVideo for testing
 */
function createCollectionVideo(
  title: string,
  contentType: 'movie' | 'tvshow',
  options: Partial<CollectionVideo> = {}
): CollectionVideo {
  return {
    id: options.id ?? `/videos/${title}.mkv`,
    filePath: options.filePath ?? `/videos/${title}.mkv`,
    contentType,
    title,
    container: options.container ?? 'mkv',
    videoCodec: options.videoCodec ?? 'h264',
    audioCodec: options.audioCodec ?? 'aac',
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    duration: options.duration ?? 7200, // 2 hours
    year: options.year,
    description: options.description,
    genre: options.genre,
    director: options.director,
    studio: options.studio,
    seriesTitle: options.seriesTitle,
    seasonNumber: options.seasonNumber,
    episodeNumber: options.episodeNumber,
    episodeId: options.episodeId,
    network: options.network,
  };
}

// Counter for unique iPod video IDs
let ipodVideoIdCounter = 0;

/**
 * Create a minimal IPodVideo for testing
 */
function createIPodVideo(
  title: string,
  contentType: 'movie' | 'tvshow',
  options: Partial<IPodVideo> = {}
): IPodVideo {
  return {
    id: options.id ?? `ipod-video-${ipodVideoIdCounter++}`,
    filePath: options.filePath ?? `:iPod_Control:Videos:V00:VIDEO${ipodVideoIdCounter}.m4v`,
    contentType,
    title,
    year: options.year,
    seriesTitle: options.seriesTitle,
    seasonNumber: options.seasonNumber,
    episodeNumber: options.episodeNumber,
    duration: options.duration,
    bitrate: options.bitrate,
  };
}

// =============================================================================
// Match Key Generation Tests
// =============================================================================

describe('generateVideoMatchKey', () => {
  describe('movies', () => {
    it('should generate key for movie without year', () => {
      const key = generateVideoMatchKey({
        contentType: 'movie',
        title: 'The Matrix',
      });
      expect(key).toBe('movie:the matrix');
    });

    it('should generate key for movie with year', () => {
      const key = generateVideoMatchKey({
        contentType: 'movie',
        title: 'The Matrix',
        year: 1999,
      });
      expect(key).toBe('movie:the matrix:1999');
    });

    it('should normalize title (lowercase, trim, remove special chars)', () => {
      const key = generateVideoMatchKey({
        contentType: 'movie',
        title: '  The Matrix: Reloaded!  ',
        year: 2003,
      });
      expect(key).toBe('movie:the matrix reloaded:2003');
    });

    it('should ignore invalid years', () => {
      const key1 = generateVideoMatchKey({
        contentType: 'movie',
        title: 'Test',
        year: 1800, // Too old
      });
      expect(key1).toBe('movie:test');

      const key2 = generateVideoMatchKey({
        contentType: 'movie',
        title: 'Test',
        year: 2100, // Too far in future
      });
      expect(key2).toBe('movie:test');
    });
  });

  describe('TV shows', () => {
    it('should generate key for TV episode with series title', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'Pilot',
        seriesTitle: 'Breaking Bad',
        seasonNumber: 1,
        episodeNumber: 1,
      });
      expect(key).toBe('tvshow:breaking bad:s01e01');
    });

    it('should fall back to episode title if no series title', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'The One Where They All Find Out',
        seasonNumber: 5,
        episodeNumber: 14,
      });
      expect(key).toBe('tvshow:the one where they all find out:s05e14');
    });

    it('should handle missing season/episode numbers', () => {
      const key = generateVideoMatchKey({
        contentType: 'tvshow',
        title: 'Special Episode',
        seriesTitle: 'Doctor Who',
      });
      expect(key).toBe('tvshow:doctor who:special episode');
    });

    it('should pad season and episode numbers', () => {
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
// Video Diff Tests
// =============================================================================

describe('diffVideos', () => {
  describe('empty scenarios', () => {
    it('should handle empty collection and empty iPod', () => {
      const diff = diffVideos([], []);
      expect(diff.toAdd).toEqual([]);
      expect(diff.toRemove).toEqual([]);
      expect(diff.existing).toEqual([]);
    });

    it('should add all videos when iPod is empty', () => {
      const videos = [
        createCollectionVideo('Movie 1', 'movie'),
        createCollectionVideo('Movie 2', 'movie'),
      ];

      const diff = diffVideos(videos, []);
      expect(diff.toAdd).toHaveLength(2);
      expect(diff.toRemove).toHaveLength(0);
      expect(diff.existing).toHaveLength(0);
    });

    it('should remove all videos when collection is empty', () => {
      const ipodVideos = [createIPodVideo('Movie 1', 'movie'), createIPodVideo('Movie 2', 'movie')];

      const diff = diffVideos([], ipodVideos);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toRemove).toHaveLength(2);
      expect(diff.existing).toHaveLength(0);
    });
  });

  describe('movie matching', () => {
    it('should match movies by title', () => {
      const collectionVideos = [createCollectionVideo('The Matrix', 'movie')];
      const ipodVideos = [createIPodVideo('The Matrix', 'movie')];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toRemove).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
      expect(diff.existing[0]!.collection.title).toBe('The Matrix');
    });

    it('should match movies by title and year', () => {
      const collectionVideos = [createCollectionVideo('The Matrix', 'movie', { year: 1999 })];
      const ipodVideos = [createIPodVideo('The Matrix', 'movie', { year: 1999 })];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('should distinguish movies with same title but different years', () => {
      const collectionVideos = [createCollectionVideo('Dune', 'movie', { year: 2021 })];
      const ipodVideos = [createIPodVideo('Dune', 'movie', { year: 1984 })];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(1);
      expect(diff.toRemove).toHaveLength(1);
      expect(diff.existing).toHaveLength(0);
    });

    it('should match with case-insensitive comparison', () => {
      const collectionVideos = [createCollectionVideo('THE MATRIX', 'movie')];
      const ipodVideos = [createIPodVideo('the matrix', 'movie')];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.existing).toHaveLength(1);
    });
  });

  describe('TV show matching', () => {
    it('should match TV episodes by series/season/episode', () => {
      const collectionVideos = [
        createCollectionVideo('Pilot', 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];
      const ipodVideos = [
        createIPodVideo('Pilot', 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('should distinguish different episodes of same series', () => {
      const collectionVideos = [
        createCollectionVideo('Pilot', 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
        createCollectionVideo("Cat's in the Bag", 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 2,
        }),
      ];
      const ipodVideos = [
        createIPodVideo('Pilot', 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(1);
      expect(diff.toAdd[0]!.episodeNumber).toBe(2);
      expect(diff.existing).toHaveLength(1);
    });

    it('should distinguish different seasons of same series', () => {
      const collectionVideos = [
        createCollectionVideo('Episode 1', 'tvshow', {
          seriesTitle: 'Show',
          seasonNumber: 2,
          episodeNumber: 1,
        }),
      ];
      const ipodVideos = [
        createIPodVideo('Episode 1', 'tvshow', {
          seriesTitle: 'Show',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(1);
      expect(diff.toRemove).toHaveLength(1);
    });
  });

  describe('mixed content scenarios', () => {
    it('should handle movies and TV shows together', () => {
      const collectionVideos = [
        createCollectionVideo('The Matrix', 'movie', { year: 1999 }),
        createCollectionVideo('Pilot', 'tvshow', {
          seriesTitle: 'Breaking Bad',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];
      const ipodVideos = [
        createIPodVideo('The Matrix', 'movie', { year: 1999 }),
        createIPodVideo('Old Movie', 'movie'),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(1); // Breaking Bad S01E01
      expect(diff.toRemove).toHaveLength(1); // Old Movie
      expect(diff.existing).toHaveLength(1); // The Matrix
    });

    it('should not match movie with TV show of same name', () => {
      const collectionVideos = [createCollectionVideo('Fargo', 'movie', { year: 1996 })];
      const ipodVideos = [
        createIPodVideo('Fargo', 'tvshow', {
          seriesTitle: 'Fargo',
          seasonNumber: 1,
          episodeNumber: 1,
        }),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.toAdd).toHaveLength(1); // Movie
      expect(diff.toRemove).toHaveLength(1); // TV episode
      expect(diff.existing).toHaveLength(0);
    });
  });

  describe('duplicate handling', () => {
    it('should handle duplicate videos on iPod (first wins)', () => {
      const collectionVideos = [createCollectionVideo('The Matrix', 'movie')];
      const ipodVideos = [
        createIPodVideo('The Matrix', 'movie', { id: 'first' }),
        createIPodVideo('The Matrix', 'movie', { id: 'second' }),
      ];

      const diff = diffVideos(collectionVideos, ipodVideos);
      expect(diff.existing).toHaveLength(1);
      expect(diff.existing[0]!.ipod.id).toBe('first');
      expect(diff.toRemove).toHaveLength(1);
      expect(diff.toRemove[0]!.id).toBe('second');
    });
  });
});

// =============================================================================
// Interface Tests
// =============================================================================

describe('VideoSyncDiffer interface', () => {
  it('should create a differ via factory function', () => {
    const differ = createVideoDiffer();
    expect(differ).toBeInstanceOf(DefaultVideoSyncDiffer);
  });

  it('should work through the interface', () => {
    const differ = createVideoDiffer();
    const collectionVideos = [createCollectionVideo('Movie 1', 'movie')];
    const ipodVideos = [createIPodVideo('Movie 2', 'movie')];

    const diff = differ.diff(collectionVideos, ipodVideos);
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
  });
});

// =============================================================================
// Video Preset Change Detection
// =============================================================================

describe('video preset change detection', () => {
  it('moves video from existing to toReplace when bitrate differs from preset', () => {
    const collection = [createCollectionVideo('Movie', 'movie', { year: 2020 })];
    const ipod = [createIPodVideo('Movie', 'movie', { year: 2020, bitrate: 396 })];

    const diff = diffVideos(collection, ipod, { presetBitrate: 728 });

    expect(diff.existing).toHaveLength(0);
    expect(diff.toReplace).toHaveLength(1);
    expect(diff.toReplace[0]!.collection.title).toBe('Movie');
  });

  it('keeps video in existing when bitrate is within tolerance', () => {
    const collection = [createCollectionVideo('Movie', 'movie', { year: 2020 })];
    const ipod = [createIPodVideo('Movie', 'movie', { year: 2020, bitrate: 400 })];

    const diff = diffVideos(collection, ipod, { presetBitrate: 396 });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toReplace).toHaveLength(0);
  });

  it('does not detect preset change when presetBitrate is not set', () => {
    const collection = [createCollectionVideo('Movie', 'movie', { year: 2020 })];
    const ipod = [createIPodVideo('Movie', 'movie', { year: 2020, bitrate: 100 })];

    const diff = diffVideos(collection, ipod);

    expect(diff.existing).toHaveLength(1);
    expect(diff.toReplace).toHaveLength(0);
  });

  it('does not detect preset change when iPod has no bitrate', () => {
    const collection = [createCollectionVideo('Movie', 'movie', { year: 2020 })];
    const ipod = [createIPodVideo('Movie', 'movie', { year: 2020 })];

    const diff = diffVideos(collection, ipod, { presetBitrate: 728 });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toReplace).toHaveLength(0);
  });

  it('does not detect preset change when iPod bitrate is below minimum', () => {
    const collection = [createCollectionVideo('Movie', 'movie', { year: 2020 })];
    const ipod = [createIPodVideo('Movie', 'movie', { year: 2020, bitrate: 30 })];

    const diff = diffVideos(collection, ipod, { presetBitrate: 728 });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toReplace).toHaveLength(0);
  });

  it('detects both upgrade and downgrade', () => {
    const collection = [
      createCollectionVideo('Movie A', 'movie', { year: 2020 }),
      createCollectionVideo('Movie B', 'movie', { year: 2021 }),
    ];
    const ipod = [
      createIPodVideo('Movie A', 'movie', { year: 2020, bitrate: 396 }), // low → high = upgrade
      createIPodVideo('Movie B', 'movie', { year: 2021, bitrate: 896 }), // max → low = downgrade
    ];

    const diff = diffVideos(collection, ipod, { presetBitrate: 728 });

    expect(diff.toReplace).toHaveLength(2);
    expect(diff.existing).toHaveLength(0);
  });
});
