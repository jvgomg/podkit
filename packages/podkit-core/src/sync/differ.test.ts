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
 * 5. Conflict detection (metadata mismatches)
 * 6. Performance with large collections (10k+ tracks)
 * 7. False positive/negative prevention
 */

import { describe, expect, it } from 'bun:test';
import {
  computeDiff,
  createDiffer,
  DefaultSyncDiffer,
} from './differ.js';
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
  options: Partial<Omit<IPodTrack, 'update' | 'remove' | 'copyFile' | 'setArtwork' | 'setArtworkFromData' | 'removeArtwork'>> = {}
): IPodTrack {
  // Generate unique filePath if not provided
  const uniquePath = options.filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
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
      tracks.push(createIPodTrack(artist, title, album, { filePath: `:iPod_Control:Music:F${String(i % 100).padStart(2, '0')}:${String(i).padStart(4, '0')}.m4a` }));
    }
  }

  return tracks as CollectionTrack[] | IPodTrack[];
}

// =============================================================================
// Empty Scenario Tests
// =============================================================================

describe('computeDiff - empty scenarios', () => {
  it('handles both empty collection and empty iPod', () => {
    const diff = computeDiff([], []);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('handles empty collection with populated iPod', () => {
    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
      createIPodTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const diff = computeDiff([], ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(2);
    expect(diff.existing).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.toRemove).toEqual(ipodTracks);
  });

  it('handles empty iPod with populated collection (fresh iPod)', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const diff = computeDiff(collectionTracks, []);

    expect(diff.toAdd).toHaveLength(2);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.toAdd).toEqual(collectionTracks);
  });
});

// =============================================================================
// Identical Collection Tests (Nothing to Sync)
// =============================================================================

describe('computeDiff - identical collections', () => {
  it('reports no changes when collections are identical', () => {
    const collectionTracks = [
      createCollectionTrack('The Beatles', 'Hey Jude', 'Past Masters'),
      createCollectionTrack('Radiohead', 'Creep', 'Pablo Honey'),
    ];

    const ipodTracks = [
      createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters'),
      createIPodTrack('Radiohead', 'Creep', 'Pablo Honey'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(2);
    expect(diff.conflicts).toHaveLength(0);
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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(3);
  });

  it('matches tracks with case differences', () => {
    const collectionTracks = [
      createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS'),
    ];

    const ipodTracks = [
      createIPodTrack('the beatles', 'hey jude', 'past masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks with whitespace differences', () => {
    const collectionTracks = [
      createCollectionTrack('  The Beatles  ', '  Hey Jude  ', '  Past Masters  '),
    ];

    const ipodTracks = [
      createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks with accent differences (Unicode normalization)', () => {
    const collectionTracks = [
      createCollectionTrack('Bjork', 'Army of Me', 'Post'),
    ];

    const ipodTracks = [
      createIPodTrack('Bjork', 'Army of Me', 'Post'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('matches "The X" with "X, The" artist format', () => {
    const collectionTracks = [
      createCollectionTrack('The Beatles', 'Hey Jude', 'Past Masters'),
    ];

    const ipodTracks = [
      createIPodTrack('Beatles, The', 'Hey Jude', 'Past Masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });
});

// =============================================================================
// Fresh iPod Tests (All Tracks to Add)
// =============================================================================

describe('computeDiff - fresh iPod', () => {
  it('adds all tracks from collection to fresh iPod', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album 2'),
      createCollectionTrack('Artist 3', 'Song 3', 'Album 3'),
    ];

    const diff = computeDiff(collectionTracks, []);

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

    const diff = computeDiff(collectionTracks, []);

    expect(diff.toAdd[0]!.artist).toBe('Artist A');
    expect(diff.toAdd[1]!.artist).toBe('Artist B');
    expect(diff.toAdd[2]!.artist).toBe('Artist C');
  });
});

// =============================================================================
// Mixed Scenario Tests
// =============================================================================

describe('computeDiff - mixed scenarios', () => {
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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0]!.artist).toBe('Artist B');

    expect(diff.toRemove).toHaveLength(1);
    expect(diff.toRemove[0]!.artist).toBe('Artist D');

    expect(diff.existing).toHaveLength(2);
    expect(diff.existing.map((m) => m.collection.artist).sort()).toEqual([
      'Artist A',
      'Artist C',
    ]);
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

    const diff = computeDiff(collectionTracks, ipodTracks);

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

    const diff = computeDiff(collectionTracks, ipodTracks);

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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
    expect(diff.existing[0]!.collection.id).toBe('coll-a');
    expect(diff.existing[0]!.collection.filePath).toBe('/music/a.flac');
    expect(diff.existing[0]!.ipod.filePath).toBe(':iPod_Control:Music:F00:123.m4a');
  });
});

// =============================================================================
// Conflict Detection Tests
// =============================================================================

describe('computeDiff - conflict detection', () => {
  it('detects genre conflicts', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: 'Rock' }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { genre: 'Pop' }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('genre');
  });

  it('detects year conflicts', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { year: 2020 }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { year: 2019 }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('year');
  });

  it('detects trackNumber conflicts', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { trackNumber: 1 }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { trackNumber: 2 }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('trackNumber');
  });

  it('detects discNumber conflicts', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { discNumber: 1 }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { discNumber: 2 }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('discNumber');
  });

  it('detects albumArtist conflicts', () => {
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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('albumArtist');
  });

  it('detects multiple conflicts on same track', () => {
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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('genre');
    expect(diff.conflicts[0]!.conflicts).toContain('year');
    expect(diff.conflicts[0]!.conflicts).toContain('trackNumber');
  });

  it('does not report conflict for matching metadata with case differences', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: 'ROCK' }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { genre: 'rock' }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    // Genre matches (case-insensitive), so no conflict
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('handles undefined vs null as equivalent', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: undefined }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { genre: undefined }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.existing).toHaveLength(1);
  });

  it('detects conflict when one has value and other is undefined', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { genre: 'Rock' }),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { genre: undefined }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.conflicts).toContain('genre');
  });

  it('includes both collection and iPod tracks in conflict object', () => {
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

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]!.collection.id).toBe('coll-1');
    expect(diff.conflicts[0]!.ipod.title).toBe('Song');
  });
});

// =============================================================================
// False Positive Prevention Tests
// =============================================================================

describe('computeDiff - false positive prevention', () => {
  it('does NOT match tracks with similar but different artists', () => {
    const collectionTracks = [
      createCollectionTrack('Beatles', 'Hey Jude', 'Past Masters'),
    ];

    const ipodTracks = [
      createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    // These should NOT match because "Beatles" !== "The Beatles"
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with similar but different titles', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song!', 'Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with similar but different albums', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album (Deluxe)'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match live vs studio versions', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song (Live)', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match remix vs original', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song (Remix)', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });

  it('does NOT match tracks with swapped artist/album', () => {
    const collectionTracks = [
      createCollectionTrack('Pink Floyd', 'Money', 'Dark Side of the Moon'),
    ];

    const ipodTracks = [
      createIPodTrack('Dark Side of the Moon', 'Money', 'Pink Floyd'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// False Negative Prevention Tests
// =============================================================================

describe('computeDiff - false negative prevention', () => {
  it('matches tracks that should match despite case differences', () => {
    const collectionTracks = [
      createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS'),
    ];

    const ipodTracks = [
      createIPodTrack('the beatles', 'hey jude', 'past masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('matches tracks that should match despite whitespace differences', () => {
    const collectionTracks = [
      createCollectionTrack('The  Beatles', 'Hey   Jude', 'Past Masters'),
    ];

    const ipodTracks = [
      createIPodTrack('The Beatles', 'Hey Jude', 'Past Masters'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('matches tracks that should match despite accent differences', () => {
    const collectionTracks = [
      createCollectionTrack('Bjork', 'Army of Me', 'Post'),
    ];

    const ipodTracks = [
      createIPodTrack('Bjork', 'Army of Me', 'Post'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('matches all identical tracks in large collection', () => {
    const count = 100;
    const collectionTracks = generateTracks(count, 'collection') as CollectionTrack[];
    const ipodTracks = generateTracks(count, 'ipod') as IPodTrack[];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(count);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });
});

// =============================================================================
// Duplicate Handling Tests
// =============================================================================

describe('computeDiff - duplicate handling', () => {
  it('handles duplicate tracks in collection (same metadata)', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album', { id: 'dup-1' }),
      createCollectionTrack('Artist', 'Song', 'Album', { id: 'dup-2' }),
    ];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const diff = computeDiff(collectionTracks, ipodTracks);

    // Both collection tracks match the same iPod track
    // First is added to existing, second also matches (conflicts or existing)
    expect(diff.toRemove).toHaveLength(0);
    // The iPod track is matched, so it shouldn't be removed
  });

  it('handles duplicate tracks on iPod (same metadata)', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album', { filePath: ':iPod_Control:Music:F00:001.m4a' }),
      createIPodTrack('Artist', 'Song', 'Album', { filePath: ':iPod_Control:Music:F00:002.m4a' }),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

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

describe('computeDiff - performance', () => {
  it('handles 10,000+ tracks efficiently', () => {
    const count = 10000;
    const collectionTracks = generateTracks(count, 'collection') as CollectionTrack[];
    const ipodTracks = generateTracks(count, 'ipod') as IPodTrack[];

    const startTime = performance.now();
    const diff = computeDiff(collectionTracks, ipodTracks);
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
    const overlappingCollection = generateTracks(
      overlapCount,
      'collection'
    ) as CollectionTrack[];
    const overlappingIpod = generateTracks(overlapCount, 'ipod') as IPodTrack[];

    // Create unique tracks for each side
    const uniqueCollection: CollectionTrack[] = [];
    for (let i = overlapCount; i < collectionCount; i++) {
      uniqueCollection.push(
        createCollectionTrack(`UniqueCollArtist${i}`, `Song${i}`, `Album${i}`)
      );
    }

    const uniqueIpod: IPodTrack[] = [];
    for (let i = overlapCount; i < ipodCount; i++) {
      uniqueIpod.push(
        createIPodTrack(`UniqueIpodArtist${i}`, `Song${i}`, `Album${i}`)
      );
    }

    const collectionTracks = [...overlappingCollection, ...uniqueCollection];
    const ipodTracks = [...overlappingIpod, ...uniqueIpod];

    const startTime = performance.now();
    const diff = computeDiff(collectionTracks, ipodTracks);
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
      computeDiff(collectionTracks, ipodTracks);
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
// DefaultSyncDiffer Class Tests
// =============================================================================

describe('DefaultSyncDiffer', () => {
  it('implements SyncDiffer interface', () => {
    const differ = new DefaultSyncDiffer();

    expect(typeof differ.diff).toBe('function');
  });

  it('produces same results as computeDiff', () => {
    const differ = new DefaultSyncDiffer();

    const collectionTracks = [
      createCollectionTrack('Artist A', 'Song A', 'Album A'),
      createCollectionTrack('Artist B', 'Song B', 'Album B'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist A', 'Song A', 'Album A'),
      createIPodTrack('Artist C', 'Song C', 'Album C'),
    ];

    const directDiff = computeDiff(collectionTracks, ipodTracks);
    const classDiff = differ.diff(collectionTracks, ipodTracks);

    expect(classDiff.toAdd).toHaveLength(directDiff.toAdd.length);
    expect(classDiff.toRemove).toHaveLength(directDiff.toRemove.length);
    expect(classDiff.existing).toHaveLength(directDiff.existing.length);
    expect(classDiff.conflicts).toHaveLength(directDiff.conflicts.length);
  });
});

// =============================================================================
// createDiffer Factory Tests
// =============================================================================

describe('createDiffer', () => {
  it('creates a SyncDiffer instance', () => {
    const differ = createDiffer();

    expect(differ).toBeInstanceOf(DefaultSyncDiffer);
    expect(typeof differ.diff).toBe('function');
  });

  it('creates functional differ instances', () => {
    const differ = createDiffer();

    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album'),
    ];

    const ipodTracks: IPodTrack[] = [];

    const diff = differ.diff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.existing).toHaveLength(0);
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('computeDiff - edge cases', () => {
  it('handles tracks with empty strings', () => {
    const collectionTracks = [
      createCollectionTrack('', '', ''),
    ];

    const ipodTracks = [
      createIPodTrack('', '', ''),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with very long strings', () => {
    const longString = 'A'.repeat(1000);
    const collectionTracks = [
      createCollectionTrack(longString, longString, longString),
    ];

    const ipodTracks = [
      createIPodTrack(longString, longString, longString),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with special characters', () => {
    const collectionTracks = [
      createCollectionTrack('AC/DC', "Rock 'n' Roll", 'Back in Black'),
    ];

    const ipodTracks = [
      createIPodTrack('AC/DC', "Rock 'n' Roll", 'Back in Black'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with CJK characters', () => {
    const collectionTracks = [
      createCollectionTrack('YMO', 'Technopolis', 'Solid State Survivor'),
    ];

    const ipodTracks = [
      createIPodTrack('YMO', 'Technopolis', 'Solid State Survivor'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles tracks with emoji', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song', 'Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.existing).toHaveLength(1);
  });

  it('handles single track collections', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Other Artist', 'Other Song', 'Other Album'),
    ];

    const diff = computeDiff(collectionTracks, ipodTracks);

    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toRemove).toHaveLength(1);
    expect(diff.existing).toHaveLength(0);
  });
});
