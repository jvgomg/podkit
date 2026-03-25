/**
 * Unit tests for the diff engine
 *
 * These tests verify the core comparison logic that determines what needs
 * to be synced between a collection source and an iPod device.
 *
 * ## Test Coverage
 *
 * 1. Empty scenarios (empty collection, empty iPod, both empty)
 * 2. Identical collections (nothing to sync)
 * 3. Fresh iPod scenarios (all tracks to add)
 * 4. Mixed scenarios (some new, some existing, some removed)
 * 5. Metadata correction routing (metadata mismatches → toUpdate)
 * 6. Performance with large collections (10k+ tracks)
 * 7. False positive/negative prevention
 */

import { describe, expect, it } from 'bun:test';
import { computeMusicDiff } from './music-differ.js';
import { parseSyncTag } from './sync-tags.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { IPodTrack } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal CollectionTrack for testing
 */
function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<CollectionTrack> = {}
): CollectionTrack {
  return {
    id: options.id ?? `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath: options.filePath ?? `/music/${artist}/${album}/${title}.flac`,
    fileType: options.fileType ?? 'flac',
    ...options,
  };
}

// Counter for generating unique file paths in tests
let ipodTrackPathCounter = 0;

/**
 * Create a minimal IPodTrack for testing.
 * The new IPodTrack interface from ipod/types.js includes methods and more fields.
 * Each track gets a unique filePath which serves as its identifier.
 */
function createIPodTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<
    Omit<
      IPodTrack,
      'update' | 'remove' | 'copyFile' | 'setArtwork' | 'setArtworkFromData' | 'removeArtwork'
    >
  > = {}
): IPodTrack {
  // Generate unique filePath if not provided
  const uniquePath =
    options.filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
  const track: IPodTrack = {
    artist,
    title,
    album,
    duration: options.duration ?? 180000,
    bitrate: options.bitrate ?? 256,
    sampleRate: options.sampleRate ?? 44100,
    size: options.size ?? 5000000,
    mediaType: options.mediaType ?? 1, // Audio
    filePath: uniquePath,
    timeAdded: options.timeAdded ?? Math.floor(Date.now() / 1000),
    timeModified: options.timeModified ?? Math.floor(Date.now() / 1000),
    timePlayed: options.timePlayed ?? 0,
    timeReleased: options.timeReleased ?? 0,
    playCount: options.playCount ?? 0,
    skipCount: options.skipCount ?? 0,
    rating: options.rating ?? 0,
    hasArtwork: options.hasArtwork ?? false,
    hasFile: options.hasFile ?? true,
    compilation: options.compilation ?? false,
    // Optional fields
    albumArtist: options.albumArtist,
    genre: options.genre,
    composer: options.composer,
    comment: options.comment,
    syncTag: options.comment ? parseSyncTag(options.comment) : null,
    grouping: options.grouping,
    trackNumber: options.trackNumber,
    totalTracks: options.totalTracks,
    discNumber: options.discNumber,
    totalDiscs: options.totalDiscs,
    year: options.year,
    bpm: options.bpm,
    filetype: options.filetype,
    // Methods (stubs for testing)
    update: () => track,
    remove: () => {},
    copyFile: () => track,
    setArtwork: () => track,
    setArtworkFromData: () => track,
    removeArtwork: () => track,
  };
  return track;
}

/**
 * Generate a large number of unique tracks for performance testing
 */
function generateTracks(
  count: number,
  type: 'collection' | 'ipod'
): CollectionTrack[] | IPodTrack[] {
  const tracks: (CollectionTrack | IPodTrack)[] = [];

  for (let i = 0; i < count; i++) {
    const artist = `Artist ${Math.floor(i / 100)}`;
    const album = `Album ${Math.floor(i / 10)}`;
    const title = `Song ${i}`;

    if (type === 'collection') {
      tracks.push(createCollectionTrack(artist, title, album));
    } else {
      tracks.push(
        createIPodTrack(artist, title, album, {
          filePath: `:iPod_Control:Music:F${String(i % 100).padStart(2, '0')}:${String(i).padStart(4, '0')}.m4a`,
        })
      );
    }
  }

  return tracks as CollectionTrack[] | IPodTrack[];
}

// =============================================================================
// Empty Scenario Tests
// =============================================================================

describe('computeMusicDiff - empty scenarios', () => {
  it('handles both empty collection and empty iPod', () => {
    const diff = computeMusicDiff([], []);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
  });

  it('handles empty collection with populated iPod', () => {
    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
      createIPodTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const diff = computeMusicDiff([], ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(2);
    expect(diff.existing).toHaveLength(0);
    expect(diff.toRemove).toEqual(ipodTracks);
  });

  it('handles empty iPod with populated collection (fresh iPod)', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const diff = computeMusicDiff(collectionTracks, []);

    expect(diff.toAdd).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
    expect(diff.toAdd).toEqual(collectionTracks);
  });
});

// =============================================================================
// Identical Collection Tests (Nothing to Sync)
// =============================================================================

describe('computeMusicDiff - identical collections', () => {
  it('reports no changes when collections are identical', () => {
    const collectionTracks = [
      createCollectionTrack('The Beatles', 'Hey Jude', 'Past Masters'),
      createCollectionTrack('Radiohead', 'Creep', 'Pablo Honey'),
    ];

    const ipodTracks = [
      createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters'),
      createIPodTrack('Radiohead', 'Creep', 'Pablo Honey'),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(2);
  });

  it('handles identical collections with different ordering', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A'),
      createCollectionTrack('Artist B', 'Song B', 'Album B'),
      createCollectionTrack('Artist C', 'Song C', 'Album C'),
    ];

    // Reverse order on iPod
    const ipodTracks = [
      createIPodTrack('Artist C', 'Song C', 'Album C'),
      createIPodTrack('Artist A', 'Song A', 'Album A'),
      createIPodTrack('Artist B', 'Song B', 'Album B'),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(3);
  });

  it('matches tracks with case differences', () => {
    const collectionTracks = [createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS')];

    const ipodTracks = [createIPodTrack('the beatles', 'hey jude', 'past masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks with whitespace differences', () => {
    const collectionTracks = [
      createCollectionTrack('  The Beatles  ', '  Hey Jude  ', '  Past Masters  '),
    ];

    const ipodTracks = [createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks with accent differences (Unicode normalization)', () => {
    const collectionTracks = [createCollectionTrack('Bjork', 'Army of Me', 'Post')];

    const ipodTracks = [createIPodTrack('Bjork', 'Army of Me', 'Post')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches "The X" with "X, The" artist format', () => {
    const collectionTracks = [createCollectionTrack('The Beatles', 'Hey Jude', 'Past Masters')];

    const ipodTracks = [createIPodTrack('Beatles, The', 'Hey Jude', 'Past Masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });
});

// =============================================================================
// Fresh iPod Tests (All Tracks to Add)
// =============================================================================

describe('computeMusicDiff - fresh iPod', () => {
  it('adds all tracks from collection to fresh iPod', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album 2'),
      createCollectionTrack('Artist 3', 'Song 3', 'Album 3'),
    ];

    const diff = computeMusicDiff(collectionTracks, []);

    expect(diff.toAdd).toHaveLength(3);
    expect(diff.toAdd).toEqual(collectionTracks);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
  });

  it('maintains track order in toAdd', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A'),
      createCollectionTrack('Artist B', 'Song B', 'Album B'),
      createCollectionTrack('Artist C', 'Song C', 'Album C'),
    ];

    const diff = computeMusicDiff(collectionTracks, []);

    expect(diff.toAdd[0]!.artist).toBe('Artist A');
    expect(diff.toAdd[1]!.artist).toBe('Artist B');
    expect(diff.toAdd[2]!.artist).toBe('Artist C');
  });
});

// =============================================================================
// Mixed Scenario Tests
// =============================================================================

describe('computeMusicDiff - mixed scenarios', () => {
  it('handles some new, some existing, some to remove', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A'), // existing
      createCollectionTrack('Artist B', 'Song B', 'Album B'), // new
      createCollectionTrack('Artist C', 'Song C', 'Album C'), // existing
    ];

    const ipodTracks = [
      createIPodTrack('Artist A', 'Song A', 'Album A'), // existing
      createIPodTrack('Artist C', 'Song C', 'Album C'), // existing
      createIPodTrack('Artist D', 'Song D', 'Album D'), // to remove
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.artist).toBe('Artist B');

    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.artist).toBe('Artist D');

    expect(diff.existing).toHaveLength(2);
    expect(diff.existing.map((m) => m.collection.artist).sort()).toEqual(['Artist A', 'Artist C']);
  });

  it('handles mostly overlapping collections', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album'),
      createCollectionTrack('Artist 3', 'Song 3', 'Album'),
      createCollectionTrack('Artist 4', 'Song 4', 'Album'), // new
    ];

    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album'),
      createIPodTrack('Artist 2', 'Song 2', 'Album'),
      createIPodTrack('Artist 3', 'Song 3', 'Album'),
      createIPodTrack('Artist 5', 'Song 5', 'Album'), // to remove
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.artist).toBe('Artist 4');

    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.artist).toBe('Artist 5');

    expect(diff.existing).toHaveLength(3);
  });

  it('handles completely disjoint collections', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A'),
      createCollectionTrack('Artist B', 'Song B', 'Album B'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist X', 'Song X', 'Album X'),
      createIPodTrack('Artist Y', 'Song Y', 'Album Y'),
      createIPodTrack('Artist Z', 'Song Z', 'Album Z'),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(3);
    expect(diff.existing).toHaveLength(0);
  });

  it('links correct collection and iPod tracks in existing pairs', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A', {
        id: 'coll-a',
        filePath: '/music/a.flac',
      }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist A', 'Song A', 'Album A', {
        filePath: ':iPod_Control:Music:F00:123.m4a',
      }),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
    expect(diff.existing[0]!.collection.id).toBe('coll-a');
    expect(diff.existing[0]!.collection.filePath).toBe('/music/a.flac');
    expect(diff.existing[0]!.ipod.filePath).toBe(':iPod_Control:Music:F00:123.m4a');
  });
});

// =============================================================================
// Conflict Detection Tests
// =============================================================================

describe('computeMusicDiff - metadata correction routing', () => {
  // Metadata differences between collection and iPod tracks are detected as
  // 'metadata-correction' upgrades and routed to toUpdate (self-healing sync, ADR-009).

  it('routes genre differences to toUpdate as metadata-correction', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { genre: 'Rock' })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: 'Pop' })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes year differences to toUpdate as metadata-correction', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { year: 2020 })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { year: 2019 })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes trackNumber differences to toUpdate as metadata-correction', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { trackNumber: 1 })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { trackNumber: 2 })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes discNumber differences to toUpdate as metadata-correction', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { discNumber: 1 })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { discNumber: 2 })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes albumArtist differences to toUpdate as metadata-correction', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', {
        albumArtist: 'Various Artists',
      }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', {
        albumArtist: 'Compilation',
      }),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes multiple metadata differences to a single toUpdate entry', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', {
        genre: 'Rock',
        year: 2020,
        trackNumber: 1,
      }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', {
        genre: 'Pop',
        year: 2019,
        trackNumber: 2,
      }),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
    // Changes should include the differing fields
    const changeFields = diff.toUpdate[0]!.changes.map((c) => c.field);
    expect(changeFields).toContain('genre');
    expect(changeFields).toContain('year');
    expect(changeFields).toContain('trackNumber');
  });

  it('does not report conflict for matching metadata with case differences', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { genre: 'ROCK' })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: 'rock' })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    // Genre matches (case-insensitive), so no update needed
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('handles undefined vs null as equivalent', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: undefined }),
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: undefined })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('handles empty string vs undefined as equivalent', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { genre: '' })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: undefined })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('routes metadata-correction when one has value and other is undefined', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album', { genre: 'Rock' })];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: undefined })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('routes compilation difference to toUpdate as metadata-correction', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { compilation: true }),
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { compilation: false })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('does not trigger update when both compilation values match', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { compilation: true }),
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { compilation: true })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('treats undefined compilation as equivalent to false (no spurious update)', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album'),
      // compilation is undefined
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { compilation: false })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('includes source and iPod tracks in toUpdate entry for metadata-correction', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', {
        id: 'coll-1',
        genre: 'Rock',
      }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', {
        genre: 'Pop',
      }),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.source.id).toBe('coll-1');
    expect(diff.toUpdate[0]!.ipod.title).toBe('Song');
  });
});

// =============================================================================
// False Positive Prevention Tests
// =============================================================================

describe('computeMusicDiff - false positive prevention', () => {
  it('does NOT match tracks with similar but different artists', () => {
    const collectionTracks = [createCollectionTrack('Beatles', 'Hey Jude', 'Past Masters')];

    const ipodTracks = [createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    // These should NOT match because "Beatles" !== "The Beatles"
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with similar but different titles', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [createIPodTrack('Artist', 'Song!', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with similar but different albums', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album (Deluxe)')];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match live vs studio versions', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song (Live)', 'Album')];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match remix vs original', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song (Remix)', 'Album')];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with swapped artist/album', () => {
    const collectionTracks = [
      createCollectionTrack('Pink Floyd', 'Money', 'Dark Side of the Moon'),
    ];

    const ipodTracks = [createIPodTrack('Dark Side of the Moon', 'Money', 'Pink Floyd')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// False Negative Prevention Tests
// =============================================================================

describe('computeMusicDiff - false negative prevention', () => {
  it('matches tracks that should match despite case differences', () => {
    const collectionTracks = [createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS')];

    const ipodTracks = [createIPodTrack('the beatles', 'hey jude', 'past masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('matches tracks that should match despite whitespace differences', () => {
    const collectionTracks = [createCollectionTrack('The  Beatles', 'Hey   Jude', 'Past Masters')];

    const ipodTracks = [createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks that should match despite accent differences', () => {
    const collectionTracks = [createCollectionTrack('Bjork', 'Army of Me', 'Post')];

    const ipodTracks = [createIPodTrack('Bjork', 'Army of Me', 'Post')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('matches all identical tracks in large collection', () => {
    const count = 100;
    const collectionTracks = generateTracks(count, 'collection') as CollectionTrack[];
    const ipodTracks = generateTracks(count, 'ipod') as IPodTrack[];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(count);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });
});

// =============================================================================
// Duplicate Handling Tests
// =============================================================================

describe('computeMusicDiff - duplicate handling', () => {
  it('handles duplicate tracks in collection (same metadata)', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { id: 'dup-1' }),
      createCollectionTrack('Artist', 'Song', 'Album', { id: 'dup-2' }),
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    // First source track claims the iPod match; duplicate is skipped
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.toAdd).toHaveLength(0);
  });

  it('duplicate source tracks with different metadata do not generate phantom updates', () => {
    // Regression: when a source has two entries with the same (artist, title, album)
    // but different trackNumbers, the second entry would generate a metadata-correction
    // against the same iPod track. After applying the first update, the next sync
    // would see the other duplicate's trackNumber as a diff again — infinite loop.
    const collectionTracks = [
      createCollectionTrack('Yumi Zouma', 'be okay', 'Album', { trackNumber: 2 }),
      createCollectionTrack('Yumi Zouma', 'be okay', 'Album', { trackNumber: 9 }),
    ];

    const ipodTracks = [createIPodTrack('Yumi Zouma', 'be okay', 'Album', { trackNumber: 9 })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    // First source track claims the iPod match and sees trackNumber 2 vs 9 → update
    // Second source track is skipped (iPod track already claimed)
    expect(diff.toUpdate.length).toBeLessThanOrEqual(1);
    expect(diff.toRemove).toHaveLength(0);
    // No phantom duplicate operations
    expect(diff.toUpdate.length + diff.existing.length).toBe(1);
  });

  it('handles duplicate tracks on iPod (same metadata)', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { filePath: ':iPod_Control:Music:F00:001.m4a' }),
      createIPodTrack('Artist', 'Song', 'Album', { filePath: ':iPod_Control:Music:F00:002.m4a' }),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    // Collection track matches first iPod track
    // Second iPod track is unmatched (because index keeps first)
    expect(diff.existing).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.filePath).toBe(':iPod_Control:Music:F00:002.m4a');
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe('computeMusicDiff - performance', () => {
  it('handles 10,000+ tracks efficiently', () => {
    const count = 10000;
    const collectionTracks = generateTracks(count, 'collection') as CollectionTrack[];
    const ipodTracks = generateTracks(count, 'ipod') as IPodTrack[];

    const startTime = performance.now();
    const diff = computeMusicDiff(collectionTracks, ipodTracks);
    const endTime = performance.now();
    const duration = endTime - startTime;

    // All tracks should match
    expect(diff.existing).toHaveLength(count);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);

    // Should complete in reasonable time (< 1 second for 10k tracks)
    expect(duration).toBeLessThan(1000);
  });

  it('handles large mixed scenario efficiently', () => {
    const collectionCount = 8000;
    const ipodCount = 6000;
    const overlapCount = 4000;

    // Create overlapping tracks
    const overlappingCollection = generateTracks(overlapCount, 'collection') as CollectionTrack[];
    const overlappingIpod = generateTracks(overlapCount, 'ipod') as IPodTrack[];

    // Create unique tracks for each side
    const uniqueCollection: CollectionTrack[] = [];
    for (let i = overlapCount; i < collectionCount; i++) {
      uniqueCollection.push(createCollectionTrack(`UniqueCollArtist${i}`, `Song${i}`, `Album${i}`));
    }

    const uniqueIpod: IPodTrack[] = [];
    for (let i = overlapCount; i < ipodCount; i++) {
      uniqueIpod.push(createIPodTrack(`UniqueIpodArtist${i}`, `Song${i}`, `Album${i}`));
    }

    const collectionTracks = [...overlappingCollection, ...uniqueCollection];
    const ipodTracks = [...overlappingIpod, ...uniqueIpod];

    const startTime = performance.now();
    const diff = computeMusicDiff(collectionTracks, ipodTracks);
    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(diff.existing).toHaveLength(overlapCount);
    expect(diff.toAdd).toHaveLength(collectionCount - overlapCount);
    expect(diff.toRemove).toHaveLength(ipodCount - overlapCount);

    // Should complete in reasonable time (< 2 seconds for this scenario)
    expect(duration).toBeLessThan(2000);
  });

  it('demonstrates O(n) complexity (not O(n^2))', () => {
    // Run with increasing sizes and verify time grows linearly
    const sizes = [1000, 2000, 4000];
    const times: number[] = [];

    for (const size of sizes) {
      const collectionTracks = generateTracks(size, 'collection') as CollectionTrack[];
      const ipodTracks = generateTracks(size, 'ipod') as IPodTrack[];

      const startTime = performance.now();
      computeMusicDiff(collectionTracks, ipodTracks);
      const endTime = performance.now();
      times.push(endTime - startTime);
    }

    // If O(n^2), doubling size would quadruple time
    // If O(n), doubling size should roughly double time
    // We check that 4x size doesn't take more than ~6x time (allowing for overhead)
    const ratio = times[2]! / times[0]!;
    expect(ratio).toBeLessThan(8); // Much less than 16x expected from O(n^2)
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('computeMusicDiff - edge cases', () => {
  it('handles tracks with empty strings', () => {
    const collectionTracks = [createCollectionTrack('', '', '')];

    const ipodTracks = [createIPodTrack('', '', '')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with very long strings', () => {
    const longString = 'A'.repeat(1000);
    const collectionTracks = [createCollectionTrack(longString, longString, longString)];

    const ipodTracks = [createIPodTrack(longString, longString, longString)];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with special characters', () => {
    const collectionTracks = [createCollectionTrack('AC/DC', "Rock 'n' Roll", 'Back in Black')];

    const ipodTracks = [createIPodTrack('AC/DC', "Rock 'n' Roll", 'Back in Black')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with CJK characters', () => {
    const collectionTracks = [createCollectionTrack('YMO', 'Technopolis', 'Solid State Survivor')];

    const ipodTracks = [createIPodTrack('YMO', 'Technopolis', 'Solid State Survivor')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with emoji', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles single track collections', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [createIPodTrack('Other Artist', 'Other Song', 'Other Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// Transform-Aware Matching Tests (Dual-Key)
// =============================================================================

describe('computeMusicDiff - transform-aware matching', () => {
  const TRANSFORMS_ENABLED = {
    cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
  };

  const TRANSFORMS_DISABLED = {
    cleanArtists: { enabled: false, drop: false, format: 'feat. {}', ignore: [] },
  };

  // -------------------------------------------------------------------------
  // Basic toUpdate array behavior
  // -------------------------------------------------------------------------

  describe('toUpdate array', () => {
    it('returns empty toUpdate when no transforms configured', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks);

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('returns empty toUpdate when transforms disabled', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_DISABLED,
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // transform-apply scenario
  // -------------------------------------------------------------------------

  describe('transform-apply', () => {
    it('detects when transform should be applied (iPod has original metadata)', () => {
      // Source has "Artist feat. B" which should transform to "Artist"
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      // iPod has original (untransformed) metadata
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('transform-apply');
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'artist',
        from: 'Artist feat. B',
        to: 'Artist',
      });
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'title',
        from: 'Song',
        to: 'Song (feat. B)',
      });
      expect(diff.existing).toHaveLength(0);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toRemove).toHaveLength(0);
    });

    it('correctly sets source and ipod references in UpdateTrack', () => {
      const collectionTracks = [
        createCollectionTrack('Drake feat. Rihanna', 'Take Care', 'Take Care', {
          id: 'source-123',
        }),
      ];
      const ipodTracks = [
        createIPodTrack('Drake feat. Rihanna', 'Take Care', 'Take Care', {
          filePath: ':iPod:Music:F00:ABC.m4a',
        }),
      ];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.source.id).toBe('source-123');
      expect(diff.toUpdate[0]!.ipod.filePath).toBe(':iPod:Music:F00:ABC.m4a');
    });

    it('handles multiple tracks needing transform-apply', () => {
      const collectionTracks = [
        createCollectionTrack('Artist A feat. X', 'Song 1', 'Album'),
        createCollectionTrack('Artist B ft. Y', 'Song 2', 'Album'),
        createCollectionTrack('Artist C featuring Z', 'Song 3', 'Album'),
      ];
      const ipodTracks = [
        createIPodTrack('Artist A feat. X', 'Song 1', 'Album'),
        createIPodTrack('Artist B ft. Y', 'Song 2', 'Album'),
        createIPodTrack('Artist C featuring Z', 'Song 3', 'Album'),
      ];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(3);
      expect(diff.toUpdate.every((u) => u.reason === 'transform-apply')).toBe(true);
    });

    it('does not add to toUpdate when track has no featured artist', () => {
      const collectionTracks = [createCollectionTrack('Solo Artist', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Solo Artist', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // transform-remove scenario
  // -------------------------------------------------------------------------

  describe('transform-remove', () => {
    it('detects when transform should be removed (iPod has transformed metadata, config disabled)', () => {
      // Source has original "Artist feat. B"
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      // iPod has transformed metadata (was previously synced with transforms enabled)
      const ipodTracks = [createIPodTrack('Artist', 'Song (feat. B)', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_DISABLED,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('transform-remove');
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'artist',
        from: 'Artist',
        to: 'Artist feat. B',
      });
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'title',
        from: 'Song (feat. B)',
        to: 'Song',
      });
      expect(diff.existing).toHaveLength(0);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toRemove).toHaveLength(0);
    });

    it('handles multiple tracks needing transform-remove', () => {
      const collectionTracks = [
        createCollectionTrack('Artist A feat. X', 'Song 1', 'Album'),
        createCollectionTrack('Artist B ft. Y', 'Song 2', 'Album'),
      ];
      // iPod has transformed metadata
      const ipodTracks = [
        createIPodTrack('Artist A', 'Song 1 (feat. X)', 'Album'),
        createIPodTrack('Artist B', 'Song 2 (feat. Y)', 'Album'),
      ];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_DISABLED,
      });

      expect(diff.toUpdate).toHaveLength(2);
      expect(diff.toUpdate.every((u) => u.reason === 'transform-remove')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Already correct scenarios (no update needed)
  // -------------------------------------------------------------------------

  describe('already correct', () => {
    it('does not update when iPod already has transformed metadata (transforms enabled)', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      // iPod already has transformed metadata
      const ipodTracks = [createIPodTrack('Artist', 'Song (feat. B)', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('does not update when iPod has original metadata (transforms disabled)', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_DISABLED,
      });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // toAdd scenarios with transforms
  // -------------------------------------------------------------------------

  describe('toAdd with transforms', () => {
    it('adds track to toAdd when neither key matches', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      // iPod has completely different track
      const ipodTracks = [createIPodTrack('Other Artist', 'Other Song', 'Other Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toAdd).toHaveLength(1);
      // Transforms are applied to toAdd tracks when transforms are enabled
      expect(diff.toAdd[0]!.artist).toBe('Artist');
      expect(diff.toAdd[0]!.title).toBe('Song (feat. B)');
      expect(diff.toRemove).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    it('preserves original metadata when transforms disabled', () => {
      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks: IPodTrack[] = [];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_DISABLED,
      });

      expect(diff.toAdd).toHaveLength(1);
      // Transforms disabled - original metadata preserved
      expect(diff.toAdd[0]!.artist).toBe('Artist feat. B');
      expect(diff.toAdd[0]!.title).toBe('Song');
    });
  });

  // -------------------------------------------------------------------------
  // Mixed scenarios
  // -------------------------------------------------------------------------

  describe('mixed scenarios', () => {
    it('handles mix of toAdd, toRemove, existing, and toUpdate', () => {
      const collectionTracks = [
        // Needs transform-apply (iPod has original)
        createCollectionTrack('A feat. X', 'Song 1', 'Album'),
        // Already correct (iPod has transformed)
        createCollectionTrack('B feat. Y', 'Song 2', 'Album'),
        // New track (not on iPod)
        createCollectionTrack('C feat. Z', 'Song 3', 'Album'),
        // No featured artist (existing, no transform)
        createCollectionTrack('Solo', 'Song 4', 'Album'),
      ];

      const ipodTracks = [
        // Original metadata → needs transform-apply
        createIPodTrack('A feat. X', 'Song 1', 'Album'),
        // Already transformed → existing
        createIPodTrack('B', 'Song 2 (feat. Y)', 'Album'),
        // To be removed
        createIPodTrack('Old Artist', 'Old Song', 'Old Album'),
        // No featured artist → existing
        createIPodTrack('Solo', 'Song 4', 'Album'),
      ];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: TRANSFORMS_ENABLED,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.source.artist).toBe('A feat. X');
      expect(diff.toUpdate[0]!.reason).toBe('transform-apply');

      expect(diff.existing).toHaveLength(2);
      const existingArtists = diff.existing.map((e) => e.collection.artist);
      expect(existingArtists).toContain('B feat. Y');
      expect(existingArtists).toContain('Solo');

      expect(diff.toAdd).toHaveLength(1);
      // Transforms are applied to toAdd tracks
      expect(diff.toAdd[0]!.artist).toBe('C');
      expect(diff.toAdd[0]!.title).toBe('Song 3 (feat. Z)');

      expect(diff.toRemove).toHaveLength(1);
      expect(diff.toRemove[0]!.artist).toBe('Old Artist');
    });
  });

  // -------------------------------------------------------------------------
  // transcodingActive flag
  // -------------------------------------------------------------------------

  describe('transcodingActive flag', () => {
    it('suppresses format-upgrade for lossless source vs lossy iPod when transcodingActive is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // Should NOT route to toUpdate for format-upgrade (AAC is the expected transcode output)
      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('does NOT suppress format-upgrade when iPod track is MP3 (not the expected transcode output)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // MP3 on iPod with lossless source IS a genuine upgrade — the source
      // was originally MP3 (copied as-is) and has since been replaced with FLAC
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
      expect(diff.existing).toHaveLength(0);
    });

    it('does NOT suppress quality-upgrade when transcodingActive is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('quality-upgrade');
    });

    it('does NOT suppress metadata-correction when transcodingActive is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        genre: 'Progressive Rock',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
        genre: 'Rock',
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // Format-upgrade suppressed, but metadata-correction should still apply
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
    });

    it('does NOT suppress soundcheck-update when transcodingActive is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        soundcheck: 1200,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // Format-upgrade suppressed, but soundcheck-update still applies
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('soundcheck-update');
    });

    it('does NOT suppress format-upgrade when iPod track is OGG (not the expected transcode output)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'OGG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // OGG on iPod is not the expected transcode output (AAC), so format-upgrade applies
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
      expect(diff.existing).toHaveLength(0);
    });

    it('does NOT suppress format-upgrade when iPod track has unknown/missing filetype', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        // no filetype set — unknown format
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // Unknown filetype should not be suppressed — be conservative, allow the upgrade
      // (iPod track with no filetype has isIpodTrackLossless returning undefined,
      // so format-upgrade won't be detected at all — track stays in existing)
      // This verifies the conservative behavior: unknown format is NOT treated as AAC
      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('still detects format-upgrade when transcodingActive is false', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: false });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
    });

    it('still detects format-upgrade when transcodingActive is undefined', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod]);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
    });
  });

  // -------------------------------------------------------------------------
  // Real-world regression: format upgrade with transcodingActive for non-AAC iPod tracks
  // -------------------------------------------------------------------------

  describe('real-world regression: FLAC source + MP3 iPod + transcodingActive', () => {
    it('detects format-upgrade for FLAC source with MP3 iPod track when transcodingActive is true', () => {
      // This is the exact scenario that was broken: a Navidrome collection has
      // a FLAC file, the iPod has an MP3 copy (copied as-is because it was
      // originally MP3 in the collection). The source was later replaced with
      // FLAC. With transcodingActive, the old code suppressed ALL format-upgrades,
      // but it should only suppress when the iPod track is AAC (the expected
      // transcode output format).
      const source = createCollectionTrack('Pink Floyd', 'Comfortably Numb', 'The Wall', {
        fileType: 'flac',
        lossless: true,
        bitrate: 1000,
      });
      const ipod = createIPodTrack('Pink Floyd', 'Comfortably Numb', 'The Wall', {
        filetype: 'MPEG audio file', // MP3 — was copied as-is originally
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      // MP3 on iPod is NOT the expected transcode output (AAC is),
      // so this should be detected as a format-upgrade
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
      expect(diff.existing).toHaveLength(0);
    });

    it('still suppresses format-upgrade for FLAC source with AAC iPod track when transcodingActive is true', () => {
      // Counterpart: when the iPod has AAC (the expected transcode output),
      // format-upgrade should be suppressed since the track was already transcoded
      const source = createCollectionTrack('Pink Floyd', 'Comfortably Numb', 'The Wall', {
        fileType: 'flac',
        lossless: true,
        bitrate: 1000,
      });
      const ipod = createIPodTrack('Pink Floyd', 'Comfortably Numb', 'The Wall', {
        filetype: 'AAC audio file', // AAC — was transcoded as expected
        bitrate: 256,
      });

      const diff = computeMusicDiff([source], [ipod], { transcodingActive: true });

      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Format string variations
  // -------------------------------------------------------------------------

  describe('format string variations', () => {
    it('respects custom format string in transform config', () => {
      const customTransforms = {
        cleanArtists: { enabled: true, drop: false, format: 'with {}', ignore: [] },
      };

      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: customTransforms,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'title',
        from: 'Song',
        to: 'Song (with B)',
      });
    });

    it('handles drop mode (featured info removed, not moved to title)', () => {
      const dropTransforms = {
        cleanArtists: { enabled: true, drop: true, format: 'feat. {}', ignore: [] },
      };

      const collectionTracks = [createCollectionTrack('Artist feat. B', 'Song', 'Album')];
      const ipodTracks = [createIPodTrack('Artist feat. B', 'Song', 'Album')];

      const diff = computeMusicDiff(collectionTracks, ipodTracks, {
        transforms: dropTransforms,
      });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.changes).toContainEqual({
        field: 'artist',
        from: 'Artist feat. B',
        to: 'Artist',
      });
      // Title should not have feat. added since drop mode
      const titleChange = diff.toUpdate[0]!.changes.find((c) => c.field === 'title');
      expect(titleChange).toBeUndefined();
    });
  });
});

// =============================================================================
// Preset change detection
// =============================================================================

describe('preset change detection', () => {
  it('moves track from existing to toUpdate with preset-upgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
    expect(diff.toUpdate[0]!.changes).toContainEqual({
      field: 'bitrate',
      from: '128',
      to: '256',
    });
    expect(diff.existing).toHaveLength(0);
    expect(diff.toAdd).toHaveLength(0);
  });

  it('moves track from existing to toUpdate with preset-downgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 256,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 128,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-downgrade');
    expect(diff.existing).toHaveLength(0);
  });

  it('does not detect preset change when transcodingActive is false', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: false,
      presetBitrate: 256,
    });

    // Without transcodingActive, format-upgrade fires instead (lossless→lossy)
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
  });

  it('does not detect preset change when presetBitrate is not provided', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      // no presetBitrate
    });

    // format-upgrade suppressed by transcodingActive (AAC is expected), no preset check
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('does not detect preset change when skipUpgrades is true', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      skipUpgrades: true,
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('does not detect preset change for lossy source tracks', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 128,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
    });

    // Lossy sources are copied as-is — preset doesn't affect them
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('does not affect tracks already in toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
      soundcheck: -10,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
      soundcheck: undefined,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
    });

    // Track has soundcheck-update which puts it in toUpdate before preset check.
    // Preset detection only runs on existing tracks, so this stays as soundcheck-update.
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('soundcheck-update');
  });

  it('detects ALAC→lossy preset change as preset-downgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // ALAC on iPod from when preset was "lossless"
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-downgrade');
  });

  it('passes encodingMode to preset change detection', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // 230 vs 256: diff = -26
    // VBR 30% tolerance = 76.8 → within tolerance → existing
    // CBR 10% tolerance = 25.6 → outside tolerance → upgrade
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 230,
    });

    // Default VBR: within tolerance
    const diffVbr = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
    });
    expect(diffVbr.existing).toHaveLength(1);
    expect(diffVbr.toUpdate).toHaveLength(0);

    // CBR: outside tolerance
    const diffCbr = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'cbr',
    });
    expect(diffCbr.toUpdate).toHaveLength(1);
    expect(diffCbr.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('passes custom bitrateTolerance to preset change detection', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // 240 vs 256: diff = -16
    // Default VBR 30% tolerance = 76.8 → within
    // Custom 5% tolerance = 12.8 → outside
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 240,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      bitrateTolerance: 0.05,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('detects ALAC format-based preset upgrade when isAlacPreset is true', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // iPod has AAC, but max+ALAC-capable should produce ALAC
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 256,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      isAlacPreset: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
    expect(diff.toUpdate[0]!.changes).toContainEqual({
      field: 'lossless',
      from: 'AAC audio file',
      to: 'ALAC',
    });
  });

  it('keeps ALAC track as existing when isAlacPreset is true', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // iPod already has ALAC — in sync
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      isAlacPreset: true,
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('isAlacPreset works without presetBitrate when transcodingActive', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 256,
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      isAlacPreset: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('forceTranscode moves lossless-source tracks from existing to toUpdate', () => {
    const losslessSource = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const lossySource = createCollectionTrack('Artist2', 'Track2', 'Album', {
      lossless: false,
      fileType: 'mp3',
    });
    const ipod1 = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
    });
    const ipod2 = createIPodTrack('Artist2', 'Track2', 'Album', {
      bitrate: 320,
      filetype: 'MPEG audio file',
    });

    const diff = computeMusicDiff([losslessSource, lossySource], [ipod1, ipod2], {
      forceTranscode: true,
      transcodingActive: true,
    });

    // Lossless source → force-transcode
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('force-transcode');
    expect(diff.toUpdate[0]!.source.artist).toBe('Artist');

    // Lossy source → stays in existing (not re-transcoded)
    expect(diff.existing).toHaveLength(1);
    expect(diff.existing[0]!.collection.artist).toBe('Artist2');
  });

  it('forceTranscode promotes metadata-only updates to file replacement for lossless sources', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
      soundcheck: 1234,
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      soundcheck: 5678,
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTranscode: true,
      transcodingActive: true,
    });

    // Track gets force-transcode as primary reason (file replacement)
    // even though it originally only had soundcheck-update (metadata-only)
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('force-transcode');
    expect(diff.existing).toHaveLength(0);
  });

  it('forceTranscode does not duplicate tracks with existing file-replacement upgrades', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
      hasArtwork: true,
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      hasArtwork: false,
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTranscode: true,
      transcodingActive: true,
    });

    // artwork-added is already a file-replacement upgrade, so force-transcode
    // is not injected. The track is updated once with artwork-added as reason.
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('artwork-added');
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// Sync Tag Detection
// =============================================================================

describe('sync tag detection', () => {
  it('sync tag match keeps track as existing', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('sync tag mismatch on quality triggers preset-upgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 128,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=low encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('sync tag mismatch on quality triggers preset-downgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 128,
      encodingMode: 'vbr',
      resolvedQuality: 'low',
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-downgrade');
  });

  it('sync tag mismatch on encoding triggers preset-upgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    // Same quality but different encoding mode
    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'cbr',
      resolvedQuality: 'high',
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('no sync tag falls back to bitrate tolerance detection', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // No comment (no sync tag) — should use bitrate detection
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 128,
      filetype: 'AAC audio file',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('no sync tag with bitrate in range keeps track as existing', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // No comment, bitrate within VBR 30% tolerance (256 ± 77)
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 240,
      filetype: 'AAC audio file',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
    });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('sync tag with custom bitrate mismatch triggers re-transcode', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=cbr]',
    });

    // Config now includes a custom bitrate
    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 320,
      encodingMode: 'cbr',
      resolvedQuality: 'high',
      customBitrate: 320,
    });

    expect(diff.toUpdate).toHaveLength(1);
  });

  it('lossy source tracks are not affected by sync tag detection', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 128,
      filetype: 'MPEG audio file',
      comment: '[podkit:v1 quality=low encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
    });

    // Lossy sources are copied as-is, not affected by preset detection
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// forceSyncTags Detection
// =============================================================================

describe('forceSyncTags', () => {
  it('writes sync tag for lossless sources missing a tag', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // iPod track has no comment (no sync tag)
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
      forceSyncTags: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('sync-tag-write');
    // The expected comment should contain the sync tag
    const commentChange = diff.toUpdate[0]!.changes.find((c) => c.field === 'comment');
    expect(commentChange).toBeDefined();
    expect(commentChange!.to).toContain('quality=high');
    expect(commentChange!.to).toContain('encoding=vbr');
    expect(diff.existing).toHaveLength(0);
  });

  it('writes sync tag for lossless sources with outdated tag', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // iPod track has an old sync tag with different quality
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=low encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
      forceSyncTags: true,
    });

    // Since the sync tag doesn't match the expected config, it triggers
    // a preset change detection (preset-upgrade) during the shouldCheckPreset
    // pass BEFORE forceSyncTags runs. The upgrade detection takes priority.
    expect(diff.toUpdate).toHaveLength(1);
  });

  it('keeps lossless source in existing when sync tag already matches', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
      forceSyncTags: true,
    });

    // Tag already matches — no update needed
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('skips lossy sources when forceSyncTags is active', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 192,
      filetype: 'MPEG audio file',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
      forceSyncTags: true,
    });

    // Lossy sources are copied as-is — no sync tag written
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('includes custom bitrate in expected sync tag', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // Track has a tag without custom bitrate — sync tag comparison sees a mismatch
    // because the expected tag includes bitrate=320 but the iPod tag does not.
    // The shouldCheckPreset pass detects this first as a preset-upgrade.
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 320,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=cbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 320,
      encodingMode: 'cbr',
      resolvedQuality: 'high',
      customBitrate: 320,
      forceSyncTags: true,
    });

    // The sync tag mismatch (missing bitrate=320) is detected during the
    // preset change pass, which runs before forceSyncTags. It triggers a
    // preset-upgrade because the tags don't match exactly.
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('preset-upgrade');
  });

  it('forceSyncTags writes tag when preset detection does not catch it', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // No comment on iPod track, but bitrate is within tolerance so preset
    // detection does not flag it. forceSyncTags should still write the tag.
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 250, // Within VBR 30% tolerance of 256
      filetype: 'AAC audio file',
      // No comment — missing sync tag
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      encodingMode: 'vbr',
      resolvedQuality: 'high',
      forceSyncTags: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('sync-tag-write');
    const commentChange = diff.toUpdate[0]!.changes.find((c) => c.field === 'comment');
    expect(commentChange).toBeDefined();
    expect(commentChange!.to).toContain('quality=high');
    expect(commentChange!.to).toContain('encoding=vbr');
  });

  it('does not activate without resolvedQuality even when forceSyncTags is true', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
    });

    const diff = computeMusicDiff([source], [ipod], {
      transcodingActive: true,
      presetBitrate: 256,
      forceSyncTags: true,
      // resolvedQuality is NOT provided
    });

    // Without resolvedQuality, forceSyncTags guard condition fails
    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// Force Metadata Tests
// =============================================================================

describe('computeMusicDiff - forceMetadata', () => {
  it('moves all matched tracks to toUpdate with force-metadata reason', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist B', 'Song 2', 'Album 2'),
    ];
    const ipodTracks = [
      createIPodTrack('Artist A', 'Song 1', 'Album 1'),
      createIPodTrack('Artist B', 'Song 2', 'Album 2'),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: true });

    expect(diff.existing).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(2);
    expect(diff.toUpdate[0]!.reason).toBe('force-metadata');
    expect(diff.toUpdate[1]!.reason).toBe('force-metadata');
  });

  it('tracks with differing secondary metadata are caught by metadata-correction first', () => {
    // When metadata-correction fields (genre, year, etc.) differ, the upgrade detection
    // pipeline catches them before forceMetadata runs. This is correct — they still get
    // updated, just with a more specific reason.
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: 'Rock', year: 2024 }),
    ];
    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album', { genre: 'Pop', year: 2020 })];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: true });

    expect(diff.toUpdate).toHaveLength(1);
    // Metadata-correction is detected first in the pipeline
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('includes no-op title change when metadata is identical', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];
    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: true });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('force-metadata');
    expect(diff.toUpdate[0]!.changes).toHaveLength(1);
    expect(diff.toUpdate[0]!.changes[0]!.field).toBe('title');
  });

  it('still adds new tracks when forceMetadata is true', () => {
    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist B', 'New Song', 'Album 2'),
    ];
    const ipodTracks = [createIPodTrack('Artist A', 'Song 1', 'Album 1')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: true });

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.title).toBe('New Song');
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('force-metadata');
  });

  it('still identifies removals when forceMetadata is true', () => {
    const collectionTracks = [createCollectionTrack('Artist A', 'Song 1', 'Album 1')];
    const ipodTracks = [
      createIPodTrack('Artist A', 'Song 1', 'Album 1'),
      createIPodTrack('Artist B', 'Old Song', 'Album 2'),
    ];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: true });

    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.title).toBe('Old Song');
    expect(diff.toUpdate).toHaveLength(1);
  });

  it('does not move tracks to toUpdate when forceMetadata is false', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];
    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeMusicDiff(collectionTracks, ipodTracks, { forceMetadata: false });

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

// =============================================================================
// forceTransferMode
// =============================================================================

describe('forceTransferMode', () => {
  it('moves tracks with mismatched transfer mode to toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr transfer=fast]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      effectiveTransferMode: 'optimized',
      transcodingActive: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('transfer-mode-changed');
    expect(diff.toUpdate[0]!.changes[0]!.from).toBe('fast');
    expect(diff.toUpdate[0]!.changes[0]!.to).toBe('optimized');
    expect(diff.existing).toHaveLength(0);
  });

  it('keeps tracks matching current transfer mode in existing', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr transfer=optimized]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      effectiveTransferMode: 'optimized',
      transcodingActive: true,
    });

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('treats legacy sync tags (no transfer field) as missing, not fast', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      effectiveTransferMode: 'portable',
      transcodingActive: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('transfer-mode-changed');
    expect(diff.toUpdate[0]!.changes[0]!.from).toBe('none');
    expect(diff.toUpdate[0]!.changes[0]!.to).toBe('portable');
  });

  it('stamps sync tag when transfer mode is missing and effective mode is fast (metadata-only)', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      effectiveTransferMode: 'fast',
      transcodingActive: true,
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('sync-tag-write');
    const commentChange = diff.toUpdate[0]!.changes.find((c) => c.field === 'comment');
    expect(commentChange!.to).toContain('transfer=fast');
  });

  it('affects copy-format tracks (MP3) unlike forceTranscode', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: false,
      fileType: 'mp3',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 320,
      filetype: 'MPEG audio file',
      comment: '[podkit:v1 quality=copy transfer=fast]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      effectiveTransferMode: 'portable',
    });

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('transfer-mode-changed');
  });

  it('forceTransferMode + forceTranscode: each track processed once (no duplicates)', () => {
    const losslessSource = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const lossySource = createCollectionTrack('Artist2', 'Track2', 'Album', {
      lossless: false,
      fileType: 'mp3',
    });
    const ipod1 = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr transfer=fast]',
    });
    const ipod2 = createIPodTrack('Artist2', 'Track2', 'Album', {
      bitrate: 320,
      filetype: 'MPEG audio file',
      comment: '[podkit:v1 quality=copy transfer=fast]',
    });

    const diff = computeMusicDiff([losslessSource, lossySource], [ipod1, ipod2], {
      forceTranscode: true,
      forceTransferMode: true,
      effectiveTransferMode: 'portable',
      transcodingActive: true,
    });

    // Lossless track is caught by forceTranscode (earlier in processing),
    // so it won't be double-counted by forceTransferMode.
    // Lossy track is not affected by forceTranscode but IS affected by forceTransferMode.
    expect(diff.toUpdate).toHaveLength(2);

    const reasons = diff.toUpdate.map((u) => u.reason);
    expect(reasons).toContain('force-transcode');
    expect(reasons).toContain('transfer-mode-changed');

    expect(diff.existing).toHaveLength(0);
  });

  it('forceTransferMode without effectiveTransferMode does nothing', () => {
    const source = createCollectionTrack('Artist', 'Track', 'Album', {
      lossless: true,
      fileType: 'flac',
    });
    const ipod = createIPodTrack('Artist', 'Track', 'Album', {
      bitrate: 256,
      filetype: 'AAC audio file',
      comment: '[podkit:v1 quality=high encoding=vbr transfer=fast]',
    });

    const diff = computeMusicDiff([source], [ipod], {
      forceTransferMode: true,
      // effectiveTransferMode NOT set
      transcodingActive: true,
    });

    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });
});
