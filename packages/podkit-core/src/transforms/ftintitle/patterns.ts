/**
 * Regex patterns for ftintitle transform
 *
 * Ported from beets ftintitle plugin
 * Original: Copyright 2016, Verrus, <github.com/Verrus/beets-plugin-featInTitle>
 * Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
 * License: MIT
 *
 * @module
 */

/**
 * Explicit featuring words (unambiguous indicators of featured artists)
 *
 * These are used for both artist and title matching. They clearly indicate
 * a featuring credit rather than being part of the artist name.
 */
const FEAT_WORDS_EXPLICIT = [
  'ft',
  'ft.',
  'feat',
  'feat.',
  'featuring',
] as const;

/**
 * Additional separator words used in artist fields
 *
 * These are more ambiguous and only used for artist field splitting,
 * not for detecting existing featuring info in titles.
 *
 * Note: We're conservative here - "and" and "&" can be part of band names
 * (e.g., "Simon & Garfunkel"), so we require whitespace boundaries.
 */
const FEAT_WORDS_ARTIST_EXTRA = [
  'with',
  'vs',
  'vs.',
  'and',
  '&',
  'con', // Spanish "with"
] as const;

/**
 * All featuring words for artist field splitting
 */
export const FEAT_WORDS_ARTIST = [
  ...FEAT_WORDS_EXPLICIT,
  ...FEAT_WORDS_ARTIST_EXTRA,
] as const;

/**
 * Bracket keywords that indicate remix/edit/version info
 *
 * When inserting featuring info into a title, we place it BEFORE
 * any bracketed section containing these keywords.
 *
 * Example: "Song (Radio Edit)" → "Song (feat. B) (Radio Edit)"
 */
const BRACKET_KEYWORDS = [
  'abridged',
  'acapella',
  'a capella', // alternate spelling
  'club',
  'demo',
  'edit',
  'edition',
  'extended',
  'instrumental',
  'live',
  'mix',
  'radio',
  'release',
  'remaster',
  'remastered',
  'remix',
  'rmx',
  'unabridged',
  'unreleased',
  'version',
  'vip',
] as const;

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a regex pattern that splits an artist string on featuring tokens
 *
 * Captures: [full match, main artist, feat token, featured artist]
 *
 * @param forArtist - If true, include ambiguous separators
 * @returns RegExp for splitting artist strings
 */
export function createFeatSplitPattern(forArtist: boolean): RegExp {
  const words = forArtist ? FEAT_WORDS_ARTIST : FEAT_WORDS_EXPLICIT;
  const escaped = words.map(escapeRegex);
  // Match: anything + whitespace + feat word + whitespace + anything
  // Group 1: main artist (everything before feat)
  // Group 2: the feat token itself
  // Group 3: featured artist (everything after)
  return new RegExp(
    `^(.+?)\\s+(?:${escaped.join('|')})\\s+(.+)$`,
    'i'
  );
}

/**
 * Pattern to detect existing featuring info in a title
 *
 * Matches featuring words with proper word boundaries, both bracketed and unbracketed:
 * - (feat. Artist)
 * - [ft. Artist]
 * - Song feat. Artist
 * - Song featuring Someone
 *
 * Does NOT match:
 * - "Feature" (word contains "feat" but isn't a featuring token)
 * - "defeat" (embedded within word)
 */
const TITLE_FEAT_PATTERN = new RegExp(
  `(?:^|\\s|[([\\[])(?:${FEAT_WORDS_EXPLICIT.map(escapeRegex).join('|')})(?:\\s|[)\\]]|$)`,
  'i'
);

/**
 * Pattern to find bracketed sections containing remix/edit keywords
 *
 * Matches: (Remix), [Radio Edit], (Extended Mix), etc.
 * Used to determine where to insert featuring info in the title.
 */
const BRACKET_KEYWORD_PATTERN = new RegExp(
  `[([\\[]\\s*(?:[^)\\]]*\\b(?:${BRACKET_KEYWORDS.join('|')})\\b[^)\\]]*)[)\\]]`,
  'i'
);

/**
 * Find the position to insert featuring info in a title
 *
 * If the title contains a bracketed remix/edit/version section,
 * returns the position just before that bracket. Otherwise returns -1.
 *
 * @param title - The track title
 * @returns Index to insert at, or -1 to append at end
 */
export function findInsertPosition(title: string): number {
  const match = title.match(BRACKET_KEYWORD_PATTERN);
  if (match && match.index !== undefined) {
    return match.index;
  }
  return -1;
}

/**
 * Check if a title already contains featuring information
 *
 * @param title - The track title to check
 * @returns True if title contains feat/ft/featuring in brackets
 */
export function titleContainsFeat(title: string): boolean {
  return TITLE_FEAT_PATTERN.test(title);
}
