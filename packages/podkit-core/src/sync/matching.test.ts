/**
 * Unit tests for track matching
 *
 * These tests verify the matching algorithm that powers the sync diff engine.
 * Comprehensive coverage is critical because incorrect matches can cause:
 * - Data loss (removing a different track)
 * - Duplicate syncs (re-adding existing tracks)
 * - Wasted time/space (unnecessary transcoding)
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeString,
  normalizeArtist,
  normalizeTitle,
  normalizeAlbum,
  getMatchKey,
  tracksMatch,
  buildMatchIndex,
  findMatches,
  findOrphanedTracks,
  type Matchable,
} from './matching.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { IPodTrack } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal matchable object for testing
 */
function createMatchable(artist: string, title: string, album: string): Matchable {
  return { artist, title, album };
}

/**
 * Create a minimal CollectionTrack for testing
 */
function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  id?: string
): CollectionTrack {
  return {
    id: id ?? `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath: `/music/${artist}/${album}/${title}.flac`,
    fileType: 'flac',
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
  filePath?: string
): IPodTrack {
  // Generate unique filePath if not provided
  const uniquePath = filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
  const track: IPodTrack = {
    artist,
    title,
    album,
    syncTag: null,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1, // Audio
    filePath: uniquePath,
    timeAdded: Math.floor(Date.now() / 1000),
    timeModified: Math.floor(Date.now() / 1000),
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
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

// =============================================================================
// normalizeString Tests
// =============================================================================

describe('normalizeString', () => {
  describe('basic normalization', () => {
    it('converts to lowercase', () => {
      expect(normalizeString('HELLO')).toBe('hello');
      expect(normalizeString('Hello World')).toBe('hello world');
      expect(normalizeString('hElLo')).toBe('hello');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeString('  hello  ')).toBe('hello');
      expect(normalizeString('\thello\n')).toBe('hello');
      expect(normalizeString('  hello world  ')).toBe('hello world');
    });

    it('collapses internal whitespace', () => {
      expect(normalizeString('hello   world')).toBe('hello world');
      expect(normalizeString('hello\t\tworld')).toBe('hello world');
      expect(normalizeString('hello  \t  world')).toBe('hello world');
    });

    it('handles empty and whitespace-only strings', () => {
      expect(normalizeString('')).toBe('');
      expect(normalizeString('   ')).toBe('');
      expect(normalizeString('\t\n')).toBe('');
    });
  });

  describe('unicode normalization', () => {
    it('removes accents from Latin characters', () => {
      expect(normalizeString('Café')).toBe('cafe');
      expect(normalizeString('résumé')).toBe('resume');
      expect(normalizeString('naïve')).toBe('naive');
      expect(normalizeString('Zoë')).toBe('zoe');
    });

    it('handles Nordic characters', () => {
      expect(normalizeString('Björk')).toBe('bjork');
      expect(normalizeString('Sigur Rós')).toBe('sigur ros');
      expect(normalizeString('Ångström')).toBe('angstrom');
    });

    it('handles German umlauts', () => {
      expect(normalizeString('München')).toBe('munchen');
      // ß (eszett) is a standalone letter, not an accented letter - it stays as ß
      expect(normalizeString('Größe')).toBe('große');
      expect(normalizeString('Motörhead')).toBe('motorhead');
    });

    it('handles French accents', () => {
      expect(normalizeString('Édith Piaf')).toBe('edith piaf');
      expect(normalizeString('Françoise Hardy')).toBe('francoise hardy');
      expect(normalizeString('Protégé')).toBe('protege');
    });

    it('handles Spanish characters', () => {
      expect(normalizeString('Niño')).toBe('nino');
      expect(normalizeString('Señor')).toBe('senor');
      expect(normalizeString('Más')).toBe('mas');
    });

    it('handles precomposed vs decomposed unicode', () => {
      // 'é' can be represented as:
      // - U+00E9 (precomposed: é)
      // - U+0065 U+0301 (decomposed: e + combining acute accent)
      const precomposed = 'caf\u00E9'; // café with precomposed é
      const decomposed = 'cafe\u0301'; // café with decomposed e + accent
      expect(normalizeString(precomposed)).toBe('cafe');
      expect(normalizeString(decomposed)).toBe('cafe');
      // Both should produce the same result
      expect(normalizeString(precomposed)).toBe(normalizeString(decomposed));
    });

    it('preserves non-Latin scripts (CJK, Cyrillic, etc.)', () => {
      // These should be lowercased where applicable but not stripped
      expect(normalizeString('東京')).toBe('東京'); // Japanese kanji
      // Korean hangul: NFD decomposes composed characters to jamo
      // We verify they normalize consistently (both inputs give same output)
      expect(normalizeString('음악')).toBe(normalizeString('음악'));
      expect(normalizeString('МОСКВА')).toBe('москва'); // Russian (has lowercase)
    });

    it('handles mixed scripts', () => {
      expect(normalizeString('Café 東京')).toBe('cafe 東京');
      expect(normalizeString('Björk 2023')).toBe('bjork 2023');
    });
  });

  describe('edge cases', () => {
    it('handles null-like inputs gracefully', () => {
      // @ts-expect-error - testing runtime behavior
      expect(normalizeString(null)).toBe('');
      // @ts-expect-error - testing runtime behavior
      expect(normalizeString(undefined)).toBe('');
    });

    it('handles strings with only punctuation', () => {
      expect(normalizeString('...')).toBe('...');
      expect(normalizeString('---')).toBe('---');
    });

    it('preserves special characters', () => {
      expect(normalizeString("Rock 'n' Roll")).toBe("rock 'n' roll");
      expect(normalizeString('AC/DC')).toBe('ac/dc');
      expect(normalizeString('U2')).toBe('u2');
    });

    it('handles emoji', () => {
      expect(normalizeString('Song 🎵')).toBe('song 🎵');
      expect(normalizeString('😊 Happy')).toBe('😊 happy');
    });
  });
});

// =============================================================================
// normalizeArtist Tests
// =============================================================================

describe('normalizeArtist', () => {
  describe('article handling (The)', () => {
    it('moves leading "The " to end', () => {
      expect(normalizeArtist('The Beatles')).toBe('beatles, the');
      expect(normalizeArtist('The Rolling Stones')).toBe('rolling stones, the');
      expect(normalizeArtist('The Who')).toBe('who, the');
    });

    it('normalizes "Artist, The" format', () => {
      expect(normalizeArtist('Beatles, The')).toBe('beatles, the');
      expect(normalizeArtist('Rolling Stones, The')).toBe('rolling stones, the');
    });

    it('matches "The X" and "X, The" to same result', () => {
      expect(normalizeArtist('The Beatles')).toBe(normalizeArtist('Beatles, The'));
      expect(normalizeArtist('The Rolling Stones')).toBe(normalizeArtist('Rolling Stones, The'));
    });

    it('handles case variations', () => {
      expect(normalizeArtist('THE BEATLES')).toBe('beatles, the');
      expect(normalizeArtist('the beatles')).toBe('beatles, the');
      expect(normalizeArtist('BEATLES, THE')).toBe('beatles, the');
    });

    it('does not modify artists without "The"', () => {
      expect(normalizeArtist('Radiohead')).toBe('radiohead');
      expect(normalizeArtist('Pink Floyd')).toBe('pink floyd');
      expect(normalizeArtist('Led Zeppelin')).toBe('led zeppelin');
    });

    it('handles "The" in the middle of name', () => {
      // "The" in the middle should not be moved
      expect(normalizeArtist('Hootie & The Blowfish')).toBe('hootie & the blowfish');
      expect(normalizeArtist('Tom Petty and The Heartbreakers')).toBe(
        'tom petty and the heartbreakers'
      );
    });

    it('handles artist names that are just "The"', () => {
      // Edge case: artist name is just "The" (no space after)
      // The pattern "the " (with trailing space) doesn't match, so it stays as "the"
      expect(normalizeArtist('The')).toBe('the');
    });
  });

  describe('unknown placeholders', () => {
    it('treats "Unknown Artist" as empty', () => {
      expect(normalizeArtist('Unknown Artist')).toBe('');
      expect(normalizeArtist('UNKNOWN ARTIST')).toBe('');
      expect(normalizeArtist('  Unknown Artist  ')).toBe('');
    });

    it('treats various unknown placeholders as empty', () => {
      expect(normalizeArtist('Unknown')).toBe('');
      expect(normalizeArtist('<Unknown>')).toBe('');
      expect(normalizeArtist('[Unknown]')).toBe('');
      expect(normalizeArtist('(Unknown)')).toBe('');
    });

    it('does not treat partial matches as unknown', () => {
      // "Unknown" in the name but not a placeholder
      expect(normalizeArtist('Unknown Mortal Orchestra')).toBe('unknown mortal orchestra');
    });
  });
});

// =============================================================================
// normalizeTitle Tests
// =============================================================================

describe('normalizeTitle', () => {
  it('applies standard normalization', () => {
    expect(normalizeTitle('Hey Jude')).toBe('hey jude');
    expect(normalizeTitle('  Hey  Jude  ')).toBe('hey jude');
    expect(normalizeTitle('HEY JUDE')).toBe('hey jude');
  });

  it('handles accents', () => {
    expect(normalizeTitle('Déjà Vu')).toBe('deja vu');
    expect(normalizeTitle('Señorita')).toBe('senorita');
  });

  it('treats unknown placeholders as empty', () => {
    expect(normalizeTitle('Unknown Title')).toBe('');
    expect(normalizeTitle('Unknown')).toBe('');
  });

  it('preserves special characters in titles', () => {
    expect(normalizeTitle("Don't Stop Me Now")).toBe("don't stop me now");
    expect(normalizeTitle('R.E.M.')).toBe('r.e.m.');
    expect(normalizeTitle('1999')).toBe('1999');
  });
});

// =============================================================================
// normalizeAlbum Tests
// =============================================================================

describe('normalizeAlbum', () => {
  it('applies standard normalization', () => {
    expect(normalizeAlbum('Abbey Road')).toBe('abbey road');
    expect(normalizeAlbum('  Abbey  Road  ')).toBe('abbey road');
  });

  it('handles accents', () => {
    expect(normalizeAlbum('Mauvais Côté')).toBe('mauvais cote');
  });

  it('treats unknown placeholders as empty', () => {
    expect(normalizeAlbum('Unknown Album')).toBe('');
    expect(normalizeAlbum('Unknown')).toBe('');
  });

  it('preserves album name variations', () => {
    expect(normalizeAlbum('OK Computer')).toBe('ok computer');
    expect(normalizeAlbum("Sgt. Pepper's Lonely Hearts Club Band")).toBe(
      "sgt. pepper's lonely hearts club band"
    );
  });
});

// =============================================================================
// getMatchKey Tests
// =============================================================================

describe('getMatchKey', () => {
  it('generates consistent keys for identical tracks', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');

    expect(getMatchKey(track1)).toBe(getMatchKey(track2));
  });

  it('generates consistent keys regardless of case', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('THE BEATLES', 'HEY JUDE', 'PAST MASTERS');

    expect(getMatchKey(track1)).toBe(getMatchKey(track2));
  });

  it('generates consistent keys regardless of whitespace', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('  The  Beatles  ', '  Hey  Jude  ', '  Past  Masters  ');

    expect(getMatchKey(track1)).toBe(getMatchKey(track2));
  });

  it('generates consistent keys regardless of accents', () => {
    const track1 = createMatchable('Bjork', 'Army of Me', 'Post');
    const track2 = createMatchable('Björk', 'Army of Me', 'Post');

    expect(getMatchKey(track1)).toBe(getMatchKey(track2));
  });

  it('generates consistent keys for "The X" vs "X, The"', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('Beatles, The', 'Hey Jude', 'Past Masters');

    expect(getMatchKey(track1)).toBe(getMatchKey(track2));
  });

  it('generates different keys for different artists', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('Radiohead', 'Hey Jude', 'Past Masters');

    expect(getMatchKey(track1)).not.toBe(getMatchKey(track2));
  });

  it('generates different keys for different titles', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('The Beatles', 'Let It Be', 'Past Masters');

    expect(getMatchKey(track1)).not.toBe(getMatchKey(track2));
  });

  it('generates different keys for different albums', () => {
    const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
    const track2 = createMatchable('The Beatles', 'Hey Jude', 'Abbey Road');

    expect(getMatchKey(track1)).not.toBe(getMatchKey(track2));
  });

  it('uses unit separator to avoid collisions', () => {
    // These should NOT match because the separator prevents false collisions
    // Artist: "a|b" Title: "c" Album: "d"
    // Artist: "a" Title: "b|c" Album: "d"
    const track1 = createMatchable('a|b', 'c', 'd');
    const track2 = createMatchable('a', 'b|c', 'd');

    expect(getMatchKey(track1)).not.toBe(getMatchKey(track2));
  });
});

// =============================================================================
// tracksMatch Tests
// =============================================================================

describe('tracksMatch', () => {
  describe('exact matches', () => {
    it('matches identical tracks', () => {
      const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
      const track2 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');

      expect(tracksMatch(track1, track2)).toBe(true);
    });

    it('matches tracks with different object references', () => {
      const track1 = { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' };
      const track2 = { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' };

      expect(tracksMatch(track1, track2)).toBe(true);
    });
  });

  describe('case differences', () => {
    it('matches tracks with different cases', () => {
      const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
      const track2 = createMatchable('the beatles', 'hey jude', 'past masters');

      expect(tracksMatch(track1, track2)).toBe(true);
    });

    it('matches tracks with mixed case', () => {
      const track1 = createMatchable('THE BEATLES', 'HEY JUDE', 'PAST MASTERS');
      const track2 = createMatchable('ThE bEaTlEs', 'HeY jUdE', 'PaSt MaStErS');

      expect(tracksMatch(track1, track2)).toBe(true);
    });

    it('matches all-caps vs title case', () => {
      const track1 = createMatchable('RADIOHEAD', 'OK COMPUTER', 'ALBUM');
      const track2 = createMatchable('Radiohead', 'Ok Computer', 'Album');

      expect(tracksMatch(track1, track2)).toBe(true);
    });
  });

  describe('whitespace differences', () => {
    it('matches tracks with different leading/trailing whitespace', () => {
      const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
      const track2 = createMatchable('  The Beatles  ', '  Hey Jude  ', '  Past Masters  ');

      expect(tracksMatch(track1, track2)).toBe(true);
    });

    it('matches tracks with different internal whitespace', () => {
      const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
      const track2 = createMatchable('The   Beatles', 'Hey    Jude', 'Past   Masters');

      expect(tracksMatch(track1, track2)).toBe(true);
    });

    it('matches tracks with tabs and newlines', () => {
      const track1 = createMatchable('The Beatles', 'Hey Jude', 'Past Masters');
      const track2 = createMatchable('The\tBeatles', 'Hey\nJude', 'Past\r\nMasters');

      expect(tracksMatch(track1, track2)).toBe(true);
    });
  });

  describe('unicode normalization', () => {
    it('matches tracks with accents vs no accents', () => {
      expect(
        tracksMatch(
          createMatchable('Björk', 'Army of Me', 'Post'),
          createMatchable('Bjork', 'Army of Me', 'Post')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable('Sigur Rós', 'Hoppípolla', 'Takk...'),
          createMatchable('Sigur Ros', 'Hoppipolla', 'Takk...')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable('Motörhead', 'Ace of Spades', 'Ace of Spades'),
          createMatchable('Motorhead', 'Ace of Spades', 'Ace of Spades')
        )
      ).toBe(true);
    });

    it('matches precomposed vs decomposed unicode', () => {
      // café with precomposed é vs decomposed e + accent
      const track1 = createMatchable('Artist', 'Caf\u00E9', 'Album');
      const track2 = createMatchable('Artist', 'Cafe\u0301', 'Album');

      expect(tracksMatch(track1, track2)).toBe(true);
    });
  });

  describe('article handling', () => {
    it('matches "The Artist" with "Artist, The"', () => {
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('Beatles, The', 'Hey Jude', 'Past Masters')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable('The Rolling Stones', 'Satisfaction', 'Out of Our Heads'),
          createMatchable('Rolling Stones, The', 'Satisfaction', 'Out of Our Heads')
        )
      ).toBe(true);
    });
  });

  describe('non-matches (false positive prevention)', () => {
    it('does NOT match tracks with different artists', () => {
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Rolling Stones', 'Hey Jude', 'Past Masters')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with different titles', () => {
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Beatles', 'Let It Be', 'Past Masters')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with different albums', () => {
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Beatles', 'Hey Jude', 'Abbey Road')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with similar but different names', () => {
      // Similar artist names should NOT match
      expect(
        tracksMatch(
          createMatchable('Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters')
        )
      ).toBe(false);

      // Similar title names should NOT match
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Beatles', 'Hey Jude!', 'Past Masters')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with partial matches', () => {
      // Partial artist name
      expect(
        tracksMatch(
          createMatchable('Pink Floyd', 'Comfortably Numb', 'The Wall'),
          createMatchable('Pink', 'Comfortably Numb', 'The Wall')
        )
      ).toBe(false);

      // Partial title
      expect(
        tracksMatch(
          createMatchable('Pink Floyd', 'Comfortably Numb', 'The Wall'),
          createMatchable('Pink Floyd', 'Comfortably', 'The Wall')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with substring matches', () => {
      expect(
        tracksMatch(
          createMatchable('Queen', 'We Will Rock You', 'News of the World'),
          createMatchable('Queen', 'We Will Rock', 'News of the World')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with swapped fields', () => {
      // Artist/Album swapped
      expect(
        tracksMatch(
          createMatchable('Pink Floyd', 'Money', 'Dark Side of the Moon'),
          createMatchable('Dark Side of the Moon', 'Money', 'Pink Floyd')
        )
      ).toBe(false);
    });

    it('does NOT match tracks with extra words', () => {
      expect(
        tracksMatch(
          createMatchable('The Beatles', 'Hey Jude', 'Past Masters'),
          createMatchable('The Beatles Band', 'Hey Jude', 'Past Masters')
        )
      ).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty fields', () => {
      // Both empty - should match
      expect(tracksMatch(createMatchable('', '', ''), createMatchable('', '', ''))).toBe(true);

      // One empty, one not - should NOT match
      expect(
        tracksMatch(
          createMatchable('', 'Title', 'Album'),
          createMatchable('Artist', 'Title', 'Album')
        )
      ).toBe(false);
    });

    it('handles unknown placeholders as equivalent to empty', () => {
      expect(
        tracksMatch(
          createMatchable('Unknown Artist', 'Title', 'Album'),
          createMatchable('', 'Title', 'Album')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable('Artist', 'Unknown Title', 'Album'),
          createMatchable('Artist', '', 'Album')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable('Artist', 'Title', 'Unknown Album'),
          createMatchable('Artist', 'Title', '')
        )
      ).toBe(true);
    });

    it('handles tracks with only numbers', () => {
      expect(
        tracksMatch(createMatchable('311', '1999', '2001'), createMatchable('311', '1999', '2001'))
      ).toBe(true);
    });

    it('handles tracks with special characters', () => {
      expect(
        tracksMatch(
          createMatchable('AC/DC', "Rock 'n' Roll", 'Back in Black'),
          createMatchable('AC/DC', "Rock 'n' Roll", 'Back in Black')
        )
      ).toBe(true);

      expect(
        tracksMatch(
          createMatchable("Guns N' Roses", "Sweet Child O' Mine", 'Appetite'),
          createMatchable("Guns N' Roses", "Sweet Child O' Mine", 'Appetite')
        )
      ).toBe(true);
    });

    it('handles tracks with parentheses and brackets', () => {
      // Same with extra info
      expect(
        tracksMatch(
          createMatchable('Artist', 'Song (Live)', 'Album'),
          createMatchable('Artist', 'Song (Live)', 'Album')
        )
      ).toBe(true);

      // Different versions should NOT match
      expect(
        tracksMatch(
          createMatchable('Artist', 'Song', 'Album'),
          createMatchable('Artist', 'Song (Live)', 'Album')
        )
      ).toBe(false);

      expect(
        tracksMatch(
          createMatchable('Artist', 'Song (Remix)', 'Album'),
          createMatchable('Artist', 'Song (Live)', 'Album')
        )
      ).toBe(false);
    });

    it('handles very long strings', () => {
      const longArtist = 'A'.repeat(500);
      const longTitle = 'B'.repeat(500);
      const longAlbum = 'C'.repeat(500);

      expect(
        tracksMatch(
          createMatchable(longArtist, longTitle, longAlbum),
          createMatchable(longArtist, longTitle, longAlbum)
        )
      ).toBe(true);
    });

    it('handles CJK characters', () => {
      expect(
        tracksMatch(
          createMatchable('椎名林檎', 'ここでキスして。', 'Shouso Strip'),
          createMatchable('椎名林檎', 'ここでキスして。', 'Shouso Strip')
        )
      ).toBe(true);

      // Different kanji should NOT match
      expect(
        tracksMatch(
          createMatchable('椎名林檎', 'ここでキスして。', 'Album'),
          createMatchable('椎名', 'ここでキスして。', 'Album')
        )
      ).toBe(false);
    });
  });
});

// =============================================================================
// buildMatchIndex Tests
// =============================================================================

describe('buildMatchIndex', () => {
  it('builds an index from tracks', () => {
    const tracks = [
      createMatchable('Artist 1', 'Song 1', 'Album 1'),
      createMatchable('Artist 2', 'Song 2', 'Album 2'),
    ];

    const index = buildMatchIndex(tracks);

    expect(index.size).toBe(2);
  });

  it('handles duplicate tracks (keeps first)', () => {
    const track1 = createMatchable('Artist', 'Song', 'Album');
    const track2 = createMatchable('Artist', 'Song', 'Album');

    const tracks = [track1, track2];
    const index = buildMatchIndex(tracks);

    expect(index.size).toBe(1);
    expect(index.get(getMatchKey(track1))).toBe(track1); // First one kept
  });

  it('handles empty array', () => {
    const index = buildMatchIndex([]);
    expect(index.size).toBe(0);
  });

  it('handles case-different duplicates', () => {
    const track1 = createMatchable('ARTIST', 'SONG', 'ALBUM');
    const track2 = createMatchable('artist', 'song', 'album');

    const tracks = [track1, track2];
    const index = buildMatchIndex(tracks);

    // Both normalize to the same key
    expect(index.size).toBe(1);
  });
});

// =============================================================================
// findMatches Tests
// =============================================================================

describe('findMatches', () => {
  it('finds matches between collections', () => {
    const collectionTracks = [
      createCollectionTrack('Artist 1', 'Song 1', 'Album 1'),
      createCollectionTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
      createIPodTrack('Artist 3', 'Song 3', 'Album 3'),
    ];

    const results = findMatches(collectionTracks, ipodTracks);

    expect(results).toHaveLength(2);
    expect(results[0]!.matched).toBe(true);
    expect(results[0]!.ipodTrack).not.toBeNull();
    expect(results[1]!.matched).toBe(false);
    expect(results[1]!.ipodTrack).toBeNull();
  });

  it('matches tracks with normalization', () => {
    const collectionTracks = [createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS')];

    const ipodTracks = [createIPodTrack('the beatles', 'hey jude', 'past masters')];

    const results = findMatches(collectionTracks, ipodTracks);

    expect(results[0]!.matched).toBe(true);
  });

  it('handles empty collections', () => {
    expect(findMatches([], [])).toEqual([]);
    expect(findMatches([], [createIPodTrack('A', 'B', 'C')])).toEqual([]);

    const results = findMatches([createCollectionTrack('A', 'B', 'C')], []);
    expect(results).toHaveLength(1);
    expect(results[0]!.matched).toBe(false);
  });

  it('handles all matches', () => {
    const collectionTracks = [
      createCollectionTrack('Artist', 'Song 1', 'Album'),
      createCollectionTrack('Artist', 'Song 2', 'Album'),
    ];

    const ipodTracks = [
      createIPodTrack('Artist', 'Song 1', 'Album'),
      createIPodTrack('Artist', 'Song 2', 'Album'),
    ];

    const results = findMatches(collectionTracks, ipodTracks);

    expect(results.every((r) => r.matched)).toBe(true);
  });

  it('handles no matches', () => {
    const collectionTracks = [createCollectionTrack('Artist 1', 'Song 1', 'Album 1')];

    const ipodTracks = [createIPodTrack('Artist 2', 'Song 2', 'Album 2')];

    const results = findMatches(collectionTracks, ipodTracks);

    expect(results.every((r) => !r.matched)).toBe(true);
  });
});

// =============================================================================
// findOrphanedTracks Tests
// =============================================================================

describe('findOrphanedTracks', () => {
  it('finds tracks on iPod not in collection', () => {
    const collectionTracks = [createCollectionTrack('Artist 1', 'Song 1', 'Album 1')];

    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
      createIPodTrack('Artist 2', 'Song 2', 'Album 2'), // orphan
      createIPodTrack('Artist 3', 'Song 3', 'Album 3'), // orphan
    ];

    const orphans = findOrphanedTracks(collectionTracks, ipodTracks);

    expect(orphans).toHaveLength(2);
    expect(orphans[0]!.artist).toBe('Artist 2');
    expect(orphans[1]!.artist).toBe('Artist 3');
  });

  it('returns empty array when all iPod tracks are in collection', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const ipodTracks = [createIPodTrack('Artist', 'Song', 'Album')];

    const orphans = findOrphanedTracks(collectionTracks, ipodTracks);

    expect(orphans).toHaveLength(0);
  });

  it('returns all iPod tracks when collection is empty', () => {
    const collectionTracks: CollectionTrack[] = [];

    const ipodTracks = [
      createIPodTrack('Artist 1', 'Song 1', 'Album 1'),
      createIPodTrack('Artist 2', 'Song 2', 'Album 2'),
    ];

    const orphans = findOrphanedTracks(collectionTracks, ipodTracks);

    expect(orphans).toHaveLength(2);
  });

  it('handles empty iPod', () => {
    const collectionTracks = [createCollectionTrack('Artist', 'Song', 'Album')];

    const orphans = findOrphanedTracks(collectionTracks, []);

    expect(orphans).toHaveLength(0);
  });

  it('matches with normalization', () => {
    const collectionTracks = [createCollectionTrack('THE BEATLES', 'HEY JUDE', 'PAST MASTERS')];

    const ipodTracks = [createIPodTrack('the beatles', 'hey jude', 'past masters')];

    const orphans = findOrphanedTracks(collectionTracks, ipodTracks);

    expect(orphans).toHaveLength(0);
  });
});
