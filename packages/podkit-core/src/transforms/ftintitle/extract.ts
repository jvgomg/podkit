/**
 * Featured artist extraction logic
 *
 * Ported from beets ftintitle plugin
 * Original: Copyright 2016, Verrus, <github.com/Verrus/beets-plugin-featInTitle>
 * Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
 * License: MIT
 *
 * @module
 */

import {
  createFeatSplitPattern,
  findInsertPosition,
  titleContainsFeat,
  FEAT_WORDS_ARTIST,
} from './patterns.js';

/**
 * Result of extracting featured artist from artist string
 */
export interface ExtractResult {
  /** The main artist (without featuring info) */
  mainArtist: string;
  /** The featured artist(s), or null if none found */
  featuredArtist: string | null;
}

/**
 * Result of applying ftintitle transformation
 */
export interface FtInTitleResult {
  /** The new artist string (main artist only) */
  artist: string;
  /** The new title string (with featuring info added if applicable) */
  title: string;
  /** Whether any transformation was applied */
  changed: boolean;
}

/**
 * Options for extractFeaturedArtist
 */
export interface ExtractOptions {
  /**
   * Artist names to ignore when splitting on ambiguous separators.
   * Case-insensitive matching.
   */
  ignore?: string[];
}

/**
 * Check if an artist string starts with an ignored artist name
 *
 * @param artist - The artist string to check
 * @param ignoreList - List of artist names to ignore
 * @returns The matching ignored name, or null if no match
 */
function findIgnoredArtist(artist: string, ignoreList: string[]): string | null {
  const lowerArtist = artist.toLowerCase();
  for (const ignored of ignoreList) {
    const lowerIgnored = ignored.toLowerCase();
    if (lowerArtist.startsWith(lowerIgnored)) {
      // Check that it's a complete match or followed by a separator
      const remainder = artist.slice(ignored.length);
      if (remainder === '' || /^\s+/.test(remainder)) {
        return ignored;
      }
    }
  }
  return null;
}

/**
 * Extract featured artist from an artist string
 *
 * Splits the artist string on featuring tokens (feat., ft., featuring, etc.)
 * and returns the main artist and featured artist separately.
 *
 * Uses a two-stage approach:
 * 1. First tries explicit tokens only (feat, ft, featuring)
 * 2. Falls back to all tokens including generic separators (with, &, and)
 *
 * If an artist name is in the ignore list, the fallback step will preserve
 * the ignored name and only split on what follows.
 *
 * @param artist - The artist string to split
 * @param options - Extraction options including ignore list
 * @returns Main artist and featured artist (or null)
 *
 * @example
 * extractFeaturedArtist('Artist A feat. Artist B')
 * // { mainArtist: 'Artist A', featuredArtist: 'Artist B' }
 *
 * @example
 * extractFeaturedArtist('Coheed and Cambria', { ignore: ['Coheed and Cambria'] })
 * // { mainArtist: 'Coheed and Cambria', featuredArtist: null }
 *
 * @example
 * extractFeaturedArtist('Coheed and Cambria and Other Artist', { ignore: ['Coheed and Cambria'] })
 * // { mainArtist: 'Coheed and Cambria', featuredArtist: 'Other Artist' }
 */
export function extractFeaturedArtist(artist: string, options?: ExtractOptions): ExtractResult {
  // First try with explicit tokens only (most reliable)
  const explicitPattern = createFeatSplitPattern(false);
  let match = artist.match(explicitPattern);

  if (match && match[1] && match[2]) {
    return {
      mainArtist: match[1].trim(),
      featuredArtist: match[2].trim(),
    };
  }

  // Check if artist starts with an ignored name
  const ignoreList = options?.ignore ?? [];
  const ignoredName = findIgnoredArtist(artist, ignoreList);

  if (ignoredName) {
    // Check if there's anything after the ignored name
    const remainder = artist.slice(ignoredName.length).trim();

    if (!remainder) {
      // Entire string is the ignored artist
      return { mainArtist: artist, featuredArtist: null };
    }

    // Check if remainder starts with a separator token followed by the featured artist
    // e.g., "and Other Artist" or "& Guest"
    const lowerRemainder = remainder.toLowerCase();
    for (const token of FEAT_WORDS_ARTIST) {
      const lowerToken = token.toLowerCase();
      if (lowerRemainder.startsWith(lowerToken)) {
        // Check that it's followed by whitespace
        const afterToken = remainder.slice(token.length);
        if (afterToken.length > 0 && /^\s+/.test(afterToken)) {
          const featuredArtist = afterToken.trim();
          if (featuredArtist) {
            return {
              mainArtist: ignoredName,
              featuredArtist,
            };
          }
        }
      }
    }

    // Remainder doesn't match separator pattern, treat entire string as artist
    return { mainArtist: artist, featuredArtist: null };
  }

  // Fall back to all tokens including generic separators
  const allPattern = createFeatSplitPattern(true);
  match = artist.match(allPattern);

  if (match && match[1] && match[2]) {
    return {
      mainArtist: match[1].trim(),
      featuredArtist: match[2].trim(),
    };
  }

  // No featuring info found
  return {
    mainArtist: artist,
    featuredArtist: null,
  };
}

/**
 * Insert featuring info into a title
 *
 * Places the featuring text at the appropriate position:
 * - Before any bracketed remix/edit/version info
 * - At the end if no such brackets exist
 *
 * @param title - The original title
 * @param featuredArtist - The featured artist(s) to add
 * @param format - Format string (e.g., "feat. {}")
 * @returns The title with featuring info inserted
 *
 * @example
 * insertFeatIntoTitle('Song', 'Artist B', 'feat. {}')
 * // 'Song (feat. Artist B)'
 *
 * @example
 * insertFeatIntoTitle('Song (Remix)', 'Artist B', 'feat. {}')
 * // 'Song (feat. Artist B) (Remix)'
 */
export function insertFeatIntoTitle(title: string, featuredArtist: string, format: string): string {
  // Format the featuring text
  const featText = `(${format.replace('{}', featuredArtist)})`;

  // Find where to insert
  const insertPos = findInsertPosition(title);

  if (insertPos >= 0) {
    // Insert before the bracket keyword section
    const before = title.slice(0, insertPos).trimEnd();
    const after = title.slice(insertPos);
    return `${before} ${featText} ${after}`.trim();
  } else {
    // Append at the end
    return `${title} ${featText}`;
  }
}

/**
 * Apply the ftintitle transformation to a track's metadata
 *
 * This is the main transformation function that:
 * 1. Extracts featured artist from the artist field
 * 2. Checks if title already contains featuring info
 * 3. Inserts featuring info into title (unless drop mode)
 * 4. Returns cleaned artist and updated title
 *
 * @param artist - The track artist
 * @param title - The track title
 * @param options - Transform options
 * @returns The transformed artist and title
 *
 * @example
 * applyFtInTitle('Artist A feat. Artist B', 'Song Name', { drop: false, format: 'feat. {}' })
 * // { artist: 'Artist A', title: 'Song Name (feat. Artist B)', changed: true }
 */
export function applyFtInTitle(
  artist: string,
  title: string,
  options: { drop: boolean; format: string; ignore?: string[] }
): FtInTitleResult {
  // Extract featured artist from artist string
  const { mainArtist, featuredArtist } = extractFeaturedArtist(artist, {
    ignore: options.ignore,
  });

  // If no featured artist found, nothing to do
  if (!featuredArtist) {
    return { artist, title, changed: false };
  }

  // If title already contains featuring info, don't double-add
  if (titleContainsFeat(title)) {
    // Still clean the artist field
    return { artist: mainArtist, title, changed: artist !== mainArtist };
  }

  // If drop mode, just clean the artist without updating title
  if (options.drop) {
    return { artist: mainArtist, title, changed: true };
  }

  // Insert featuring info into title
  const newTitle = insertFeatIntoTitle(title, featuredArtist, options.format);

  return {
    artist: mainArtist,
    title: newTitle,
    changed: true,
  };
}

// Re-export from patterns for convenience
export { titleContainsFeat } from './patterns.js';
