/**
 * Unit tests for ftintitle transform
 *
 * Tests the extraction of featured artists from artist fields and
 * insertion into title fields. Covers various featuring formats,
 * edge cases, and configuration options.
 */

import { describe, expect, it } from 'bun:test';
import {
  extractFeaturedArtist,
  applyFtInTitle,
  insertFeatIntoTitle,
  titleContainsFeat,
} from './extract.js';
import { findInsertPosition } from './patterns.js';
import { cleanArtistsTransform } from './index.js';
import type { TransformableTrack, CleanArtistsConfig } from '../types.js';
import { DEFAULT_CLEAN_ARTISTS_CONFIG } from '../types.js';

// =============================================================================
// extractFeaturedArtist tests
// =============================================================================

describe('extractFeaturedArtist', () => {
  describe('explicit featuring words', () => {
    it('extracts "feat." pattern', () => {
      const result = extractFeaturedArtist('Artist A feat. Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "feat" pattern (no period)', () => {
      const result = extractFeaturedArtist('Artist A feat Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "ft." pattern', () => {
      const result = extractFeaturedArtist('Artist A ft. Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "ft" pattern (no period)', () => {
      const result = extractFeaturedArtist('Artist A ft Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "featuring" pattern', () => {
      const result = extractFeaturedArtist('Artist A featuring Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('handles case insensitivity', () => {
      const result = extractFeaturedArtist('Artist A FEAT. Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('handles "Featuring" capitalized', () => {
      const result = extractFeaturedArtist('Artist A Featuring Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });
  });

  describe('generic separator words', () => {
    it('extracts "with" pattern', () => {
      const result = extractFeaturedArtist('Artist A with Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "&" pattern', () => {
      const result = extractFeaturedArtist('Artist A & Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "and" pattern', () => {
      const result = extractFeaturedArtist('Artist A and Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "vs" pattern', () => {
      const result = extractFeaturedArtist('Artist A vs Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });

    it('extracts "con" pattern (Spanish)', () => {
      const result = extractFeaturedArtist('Artist A con Artist B');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });
  });

  describe('no featuring info', () => {
    it('returns original artist when no featuring pattern', () => {
      const result = extractFeaturedArtist('Just An Artist');
      expect(result.mainArtist).toBe('Just An Artist');
      expect(result.featuredArtist).toBeNull();
    });

    it('handles empty string', () => {
      const result = extractFeaturedArtist('');
      expect(result.mainArtist).toBe('');
      expect(result.featuredArtist).toBeNull();
    });

    it('does not split on embedded words', () => {
      // "feature" contains "feat" but shouldn't split
      const result = extractFeaturedArtist('The Feature Film Band');
      expect(result.mainArtist).toBe('The Feature Film Band');
      expect(result.featuredArtist).toBeNull();
    });
  });

  describe('multiple featured artists', () => {
    it('captures all artists after feat token', () => {
      const result = extractFeaturedArtist('Artist A feat. Artist B & Artist C');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B & Artist C');
    });

    it('captures complex featured artist names', () => {
      const result = extractFeaturedArtist('Artist A feat. The Artist B Experience');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('The Artist B Experience');
    });
  });

  describe('whitespace handling', () => {
    it('trims whitespace from extracted parts', () => {
      const result = extractFeaturedArtist('  Artist A   feat.   Artist B  ');
      expect(result.mainArtist).toBe('Artist A');
      expect(result.featuredArtist).toBe('Artist B');
    });
  });

  describe('ignore list', () => {
    it('does not split ignored artist on ambiguous separators', () => {
      const result = extractFeaturedArtist('Coheed and Cambria', {
        ignore: ['Coheed and Cambria'],
      });
      expect(result.mainArtist).toBe('Coheed and Cambria');
      expect(result.featuredArtist).toBeNull();
    });

    it('still splits ignored artist on explicit feat token', () => {
      const result = extractFeaturedArtist('Coheed and Cambria feat. Guest Artist', {
        ignore: ['Coheed and Cambria'],
      });
      expect(result.mainArtist).toBe('Coheed and Cambria');
      expect(result.featuredArtist).toBe('Guest Artist');
    });

    it('handles ignored artist with featured artist using "and"', () => {
      const result = extractFeaturedArtist('Coheed and Cambria and Other Artist', {
        ignore: ['Coheed and Cambria'],
      });
      expect(result.mainArtist).toBe('Coheed and Cambria');
      expect(result.featuredArtist).toBe('Other Artist');
    });

    it('is case-insensitive for ignore matching', () => {
      const result = extractFeaturedArtist('COHEED AND CAMBRIA', {
        ignore: ['Coheed and Cambria'],
      });
      expect(result.mainArtist).toBe('COHEED AND CAMBRIA');
      expect(result.featuredArtist).toBeNull();
    });

    it('handles multiple ignored artists', () => {
      const result1 = extractFeaturedArtist('Simon & Garfunkel', {
        ignore: ['Coheed and Cambria', 'Simon & Garfunkel'],
      });
      expect(result1.mainArtist).toBe('Simon & Garfunkel');
      expect(result1.featuredArtist).toBeNull();

      const result2 = extractFeaturedArtist('Florence and the Machine', {
        ignore: ['Florence and the Machine'],
      });
      expect(result2.mainArtist).toBe('Florence and the Machine');
      expect(result2.featuredArtist).toBeNull();
    });
  });
});

// =============================================================================
// titleContainsFeat tests
// =============================================================================

describe('titleContainsFeat', () => {
  it('detects (feat. Artist) in title', () => {
    expect(titleContainsFeat('Song Name (feat. Artist B)')).toBe(true);
  });

  it('detects (ft. Artist) in title', () => {
    expect(titleContainsFeat('Song Name (ft. Artist B)')).toBe(true);
  });

  it('detects [feat. Artist] in title', () => {
    expect(titleContainsFeat('Song Name [feat. Artist B]')).toBe(true);
  });

  it('detects (featuring Artist) in title', () => {
    expect(titleContainsFeat('Song Name (featuring Artist B)')).toBe(true);
  });

  it('returns false when no featuring info', () => {
    expect(titleContainsFeat('Song Name')).toBe(false);
  });

  it('returns false for (Remix) brackets', () => {
    expect(titleContainsFeat('Song Name (Remix)')).toBe(false);
  });

  it('handles case insensitivity', () => {
    expect(titleContainsFeat('Song Name (FEAT. Artist B)')).toBe(true);
  });

  // Unbracketed featuring detection (beets compatibility)
  it('detects unbracketed "feat." in title', () => {
    expect(titleContainsFeat('Song Name feat. Artist B')).toBe(true);
  });

  it('detects unbracketed "ft." in title', () => {
    expect(titleContainsFeat('Song Name ft. Artist B')).toBe(true);
  });

  it('detects unbracketed "featuring" in title', () => {
    expect(titleContainsFeat('Song Name featuring Artist B')).toBe(true);
  });

  it('does not match "feat" embedded in words', () => {
    expect(titleContainsFeat('The Feature Film')).toBe(false);
    expect(titleContainsFeat('Defeat the Enemy')).toBe(false);
  });
});

// =============================================================================
// findInsertPosition tests
// =============================================================================

describe('findInsertPosition', () => {
  it('finds position before (Remix)', () => {
    const pos = findInsertPosition('Song Name (Remix)');
    expect(pos).toBe(10); // Before "(Remix)"
  });

  it('finds position before (Radio Edit)', () => {
    const pos = findInsertPosition('Song Name (Radio Edit)');
    expect(pos).toBe(10);
  });

  it('finds position before [Extended Mix]', () => {
    const pos = findInsertPosition('Song Name [Extended Mix]');
    expect(pos).toBe(10);
  });

  it('finds position before (Remastered)', () => {
    const pos = findInsertPosition('Song Name (Remastered)');
    expect(pos).toBe(10);
  });

  it('finds position before (Live)', () => {
    const pos = findInsertPosition('Song Name (Live)');
    expect(pos).toBe(10);
  });

  it('returns -1 when no bracket keywords', () => {
    const pos = findInsertPosition('Song Name');
    expect(pos).toBe(-1);
  });

  it('returns -1 for non-keyword brackets', () => {
    // "(Part 1)" doesn't contain remix/edit keywords
    const pos = findInsertPosition('Song Name (Part 1)');
    expect(pos).toBe(-1);
  });
});

// =============================================================================
// insertFeatIntoTitle tests
// =============================================================================

describe('insertFeatIntoTitle', () => {
  it('appends at end when no brackets', () => {
    const result = insertFeatIntoTitle('Song Name', 'Artist B', 'feat. {}');
    expect(result).toBe('Song Name (feat. Artist B)');
  });

  it('inserts before (Remix)', () => {
    const result = insertFeatIntoTitle('Song Name (Remix)', 'Artist B', 'feat. {}');
    expect(result).toBe('Song Name (feat. Artist B) (Remix)');
  });

  it('inserts before (Radio Edit)', () => {
    const result = insertFeatIntoTitle('Song Name (Radio Edit)', 'Artist B', 'feat. {}');
    expect(result).toBe('Song Name (feat. Artist B) (Radio Edit)');
  });

  it('uses custom format', () => {
    const result = insertFeatIntoTitle('Song Name', 'Artist B', 'with {}');
    expect(result).toBe('Song Name (with Artist B)');
  });

  it('handles complex featured artist names', () => {
    const result = insertFeatIntoTitle('Song Name', 'Artist B & Artist C', 'feat. {}');
    expect(result).toBe('Song Name (feat. Artist B & Artist C)');
  });
});

// =============================================================================
// applyFtInTitle tests
// =============================================================================

describe('applyFtInTitle', () => {
  const defaultOptions = { drop: false, format: 'feat. {}' };

  describe('basic transformation', () => {
    it('moves feat from artist to title', () => {
      const result = applyFtInTitle('Artist A feat. Artist B', 'Song Name', defaultOptions);
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name (feat. Artist B)');
      expect(result.changed).toBe(true);
    });

    it('handles ft. variation', () => {
      const result = applyFtInTitle('Artist A ft. Artist B', 'Song Name', defaultOptions);
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name (feat. Artist B)');
      expect(result.changed).toBe(true);
    });

    it('handles featuring variation', () => {
      const result = applyFtInTitle('Artist A featuring Artist B', 'Song Name', defaultOptions);
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name (feat. Artist B)');
      expect(result.changed).toBe(true);
    });
  });

  describe('bracket positioning', () => {
    it('inserts before (Remix)', () => {
      const result = applyFtInTitle('Artist A ft. Artist B', 'Song Name (Remix)', defaultOptions);
      expect(result.title).toBe('Song Name (feat. Artist B) (Remix)');
    });

    it('inserts before (Radio Edit)', () => {
      const result = applyFtInTitle(
        'Artist A ft. Artist B',
        'Song Name (Radio Edit)',
        defaultOptions
      );
      expect(result.title).toBe('Song Name (feat. Artist B) (Radio Edit)');
    });

    it('inserts before [Extended Mix]', () => {
      const result = applyFtInTitle(
        'Artist A ft. Artist B',
        'Song Name [Extended Mix]',
        defaultOptions
      );
      expect(result.title).toBe('Song Name (feat. Artist B) [Extended Mix]');
    });
  });

  describe('skip cases', () => {
    it('skips when title already has featuring info', () => {
      const result = applyFtInTitle(
        'Artist A feat. Artist B',
        'Song Name (feat. Artist B)',
        defaultOptions
      );
      // Artist should still be cleaned
      expect(result.artist).toBe('Artist A');
      // Title unchanged (already has feat)
      expect(result.title).toBe('Song Name (feat. Artist B)');
      expect(result.changed).toBe(true); // Changed because artist was cleaned
    });

    it('skips when no featuring info in artist', () => {
      const result = applyFtInTitle('Artist A', 'Song Name', defaultOptions);
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name');
      expect(result.changed).toBe(false);
    });
  });

  describe('drop mode', () => {
    const dropOptions = { drop: true, format: 'feat. {}' };

    it('removes feat from artist without adding to title', () => {
      const result = applyFtInTitle('Artist A feat. Artist B', 'Song Name', dropOptions);
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name');
      expect(result.changed).toBe(true);
    });
  });

  describe('custom format', () => {
    it('uses custom format string', () => {
      const result = applyFtInTitle('Artist A feat. Artist B', 'Song Name', {
        drop: false,
        format: 'with {}',
      });
      expect(result.title).toBe('Song Name (with Artist B)');
    });

    it('uses ft. {} format', () => {
      const result = applyFtInTitle('Artist A featuring Artist B', 'Song Name', {
        drop: false,
        format: 'ft. {}',
      });
      expect(result.title).toBe('Song Name (ft. Artist B)');
    });
  });

  describe('ignore option', () => {
    it('does not transform ignored artist', () => {
      const result = applyFtInTitle('Coheed and Cambria', 'Song Name', {
        drop: false,
        format: 'feat. {}',
        ignore: ['Coheed and Cambria'],
      });
      expect(result.artist).toBe('Coheed and Cambria');
      expect(result.title).toBe('Song Name');
      expect(result.changed).toBe(false);
    });

    it('transforms ignored artist with explicit feat token', () => {
      const result = applyFtInTitle('Coheed and Cambria feat. Guest', 'Song Name', {
        drop: false,
        format: 'feat. {}',
        ignore: ['Coheed and Cambria'],
      });
      expect(result.artist).toBe('Coheed and Cambria');
      expect(result.title).toBe('Song Name (feat. Guest)');
      expect(result.changed).toBe(true);
    });

    it('handles ignored artist with "and" featured artist', () => {
      const result = applyFtInTitle('Coheed and Cambria and Guest Artist', 'Song Name', {
        drop: false,
        format: 'feat. {}',
        ignore: ['Coheed and Cambria'],
      });
      expect(result.artist).toBe('Coheed and Cambria');
      expect(result.title).toBe('Song Name (feat. Guest Artist)');
      expect(result.changed).toBe(true);
    });
  });
});

// =============================================================================
// cleanArtistsTransform tests
// =============================================================================

describe('cleanArtistsTransform', () => {
  function createTrack(artist: string, title: string): TransformableTrack {
    return { artist, title, album: 'Test Album' };
  }

  describe('disabled state', () => {
    it('returns track unchanged when disabled', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');
      const config: CleanArtistsConfig = { ...DEFAULT_CLEAN_ARTISTS_CONFIG, enabled: false };

      const result = cleanArtistsTransform.apply(track, config);

      expect(result).toBe(track); // Same object reference
      expect(result.artist).toBe('Artist A feat. Artist B');
      expect(result.title).toBe('Song Name');
    });
  });

  describe('enabled state', () => {
    it('transforms track when enabled', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');
      const config: CleanArtistsConfig = {
        enabled: true,
        drop: false,
        format: 'feat. {}',
        ignore: [],
      };

      const result = cleanArtistsTransform.apply(track, config);

      expect(result).not.toBe(track); // Different object
      expect(result.artist).toBe('Artist A');
      expect(result.title).toBe('Song Name (feat. Artist B)');
      expect(result.album).toBe('Test Album'); // Unchanged
    });

    it('returns same object when no change needed', () => {
      const track = createTrack('Artist A', 'Song Name');
      const config: CleanArtistsConfig = {
        enabled: true,
        drop: false,
        format: 'feat. {}',
        ignore: [],
      };

      const result = cleanArtistsTransform.apply(track, config);

      expect(result).toBe(track); // Same object (no changes)
    });

    it('preserves albumArtist', () => {
      const track: TransformableTrack = {
        artist: 'Artist A feat. Artist B',
        title: 'Song Name',
        album: 'Test Album',
        albumArtist: 'Artist A',
      };
      const config: CleanArtistsConfig = {
        enabled: true,
        drop: false,
        format: 'feat. {}',
        ignore: [],
      };

      const result = cleanArtistsTransform.apply(track, config);

      expect(result.albumArtist).toBe('Artist A');
    });
  });

  describe('transform interface', () => {
    it('has correct name', () => {
      expect(cleanArtistsTransform.name).toBe('cleanArtists');
    });

    it('has default config', () => {
      expect(cleanArtistsTransform.defaultConfig).toEqual(DEFAULT_CLEAN_ARTISTS_CONFIG);
    });
  });
});

// =============================================================================
// Edge cases and real-world examples
// =============================================================================

describe('real-world examples', () => {
  const defaultOptions = { drop: false, format: 'feat. {}' };

  const testCases = [
    {
      description: 'Drake feat. Rihanna',
      input: { artist: 'Drake feat. Rihanna', title: 'Take Care' },
      expected: { artist: 'Drake', title: 'Take Care (feat. Rihanna)' },
    },
    {
      description: 'multiple featured artists',
      input: { artist: 'DJ Khaled feat. Drake, Lil Wayne & Rick Ross', title: "I'm On One" },
      expected: { artist: 'DJ Khaled', title: "I'm On One (feat. Drake, Lil Wayne & Rick Ross)" },
    },
    {
      description: 'remix with featured artist',
      input: { artist: 'Avicii ft. Aloe Blacc', title: 'Wake Me Up (Radio Edit)' },
      expected: { artist: 'Avicii', title: 'Wake Me Up (feat. Aloe Blacc) (Radio Edit)' },
    },
    {
      description: 'featuring in parentheses already',
      input: { artist: 'Calvin Harris', title: 'This Is What You Came For (feat. Rihanna)' },
      expected: { artist: 'Calvin Harris', title: 'This Is What You Came For (feat. Rihanna)' },
    },
    {
      description: 'no featuring info',
      input: { artist: 'Taylor Swift', title: 'Shake It Off' },
      expected: { artist: 'Taylor Swift', title: 'Shake It Off' },
    },
    {
      description: 'with separator',
      input: { artist: 'Beyoncé with Lady Gaga', title: 'Telephone' },
      expected: { artist: 'Beyoncé', title: 'Telephone (feat. Lady Gaga)' },
    },
  ];

  for (const { description, input, expected } of testCases) {
    it(`handles ${description}`, () => {
      const result = applyFtInTitle(input.artist, input.title, defaultOptions);
      expect(result.artist).toBe(expected.artist);
      expect(result.title).toBe(expected.title);
    });
  }
});
