/**
 * Track matching utilities for sync operations
 *
 * This module provides functions to match tracks between collection sources
 * and iPod devices. Matching is based on normalized (artist, title, album) tuples.
 *
 * ## Normalization Rules
 *
 * All string fields are normalized before comparison:
 * 1. **Case**: Convert to lowercase
 * 2. **Whitespace**: Trim leading/trailing, collapse internal whitespace to single space
 * 3. **Unicode**: Normalize to NFD form, then remove combining characters (accents)
 * 4. **Article handling**: "The Beatles" and "Beatles, The" are normalized to the same form
 *
 * ## Matching Philosophy
 *
 * We prioritize **avoiding false positives** over catching all matches.
 * It's better to re-sync a track that already exists than to incorrectly
 * assume two different tracks are the same.
 *
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { IPodTrack } from './types.js';

/**
 * Interface for objects that can be matched (must have artist, title, album)
 */
export interface Matchable {
  artist: string;
  title: string;
  album: string;
}

/**
 * Match key separator - uses unit separator character (unlikely in metadata)
 */
const KEY_SEPARATOR = '\u001F';

/**
 * Common "unknown" placeholder values that should be treated as empty
 */
const UNKNOWN_PLACEHOLDERS = new Set([
  'unknown',
  'unknown artist',
  'unknown album',
  'unknown title',
  '<unknown>',
  '[unknown]',
  '(unknown)',
]);

/**
 * Normalize a string for matching
 *
 * Applies the following transformations:
 * 1. Convert to lowercase
 * 2. Normalize unicode (NFD)
 * 3. Remove combining characters (diacritics/accents)
 * 4. Collapse whitespace
 * 5. Trim leading/trailing whitespace
 *
 * @param input - The string to normalize
 * @returns The normalized string
 *
 * @example
 * normalizeString('  The Beatles  ') // 'the beatles'
 * normalizeString('Café') // 'cafe'
 * normalizeString('Björk') // 'bjork'
 */
export function normalizeString(input: string): string {
  if (!input) {
    return '';
  }

  return (
    input
      // Convert to lowercase
      .toLowerCase()
      // Normalize to NFD (decomposed form) so accents become separate characters
      .normalize('NFD')
      // Remove combining diacritical marks (accents)
      .replace(/[\u0300-\u036f]/g, '')
      // Collapse multiple whitespace to single space
      .replace(/\s+/g, ' ')
      // Trim leading and trailing whitespace
      .trim()
  );
}

/**
 * Normalize an artist name for matching
 *
 * In addition to standard normalization, handles common artist name variations:
 * - "The Beatles" <-> "Beatles, The"
 * - Leading "The " is moved to end as ", the"
 *
 * @param artist - The artist name to normalize
 * @returns The normalized artist name
 *
 * @example
 * normalizeArtist('The Beatles') // 'beatles, the'
 * normalizeArtist('Beatles, The') // 'beatles, the'
 * normalizeArtist('Radiohead') // 'radiohead'
 */
export function normalizeArtist(artist: string): string {
  let normalized = normalizeString(artist);

  // Check for "unknown" placeholders
  if (UNKNOWN_PLACEHOLDERS.has(normalized)) {
    return '';
  }

  // Handle "The X" -> "X, The" for consistent matching
  // This ensures "The Beatles" matches "Beatles, The"
  if (normalized.startsWith('the ')) {
    normalized = normalized.slice(4) + ', the';
  }

  // Also handle trailing ", The" (already in correct form)
  // No change needed, just ensure it's lowercase
  if (normalized.endsWith(', the')) {
    // Already in correct form
  }

  return normalized;
}

/**
 * Normalize a title for matching
 *
 * Applies standard normalization and handles common title variations.
 *
 * @param title - The title to normalize
 * @returns The normalized title
 */
export function normalizeTitle(title: string): string {
  const normalized = normalizeString(title);

  // Check for "unknown" placeholders
  if (UNKNOWN_PLACEHOLDERS.has(normalized)) {
    return '';
  }

  return normalized;
}

/**
 * Normalize an album name for matching
 *
 * Applies standard normalization and handles common album variations.
 *
 * @param album - The album name to normalize
 * @returns The normalized album name
 */
export function normalizeAlbum(album: string): string {
  const normalized = normalizeString(album);

  // Check for "unknown" placeholders
  if (UNKNOWN_PLACEHOLDERS.has(normalized)) {
    return '';
  }

  return normalized;
}

/**
 * Generate a match key for a track
 *
 * The match key is a normalized, deterministic string that uniquely identifies
 * a track based on its (artist, title, album) tuple. Tracks with the same
 * match key are considered to be the same song.
 *
 * @param track - The track to generate a key for
 * @returns The match key string
 *
 * @example
 * getMatchKey({ artist: 'The Beatles', title: 'Hey Jude', album: 'Past Masters' })
 * // 'beatles, the\u001Fhey jude\u001Fpast masters'
 */
export function getMatchKey(track: Matchable): string {
  const artist = normalizeArtist(track.artist);
  const title = normalizeTitle(track.title);
  const album = normalizeAlbum(track.album);

  return `${artist}${KEY_SEPARATOR}${title}${KEY_SEPARATOR}${album}`;
}

/**
 * Check if two tracks match (are the same song)
 *
 * Two tracks match if their normalized (artist, title, album) tuples are identical.
 * This is a strict comparison - both tracks must have all fields matching.
 *
 * @param trackA - First track to compare
 * @param trackB - Second track to compare
 * @returns True if the tracks match
 *
 * @example
 * tracksMatch(
 *   { artist: 'The Beatles', title: 'Hey Jude', album: 'Past Masters' },
 *   { artist: 'the beatles', title: 'HEY JUDE', album: 'past masters' }
 * ) // true
 *
 * @example
 * tracksMatch(
 *   { artist: 'Beatles', title: 'Hey Jude', album: 'Past Masters' },
 *   { artist: 'The Beatles', title: 'Hey Jude', album: 'Past Masters' }
 * ) // false (artist differs: 'beatles' vs 'beatles, the')
 */
export function tracksMatch(trackA: Matchable, trackB: Matchable): boolean {
  return getMatchKey(trackA) === getMatchKey(trackB);
}

/**
 * Result of matching a collection track to iPod tracks
 */
export interface MatchResult {
  /** The collection track being matched */
  collectionTrack: CollectionTrack;
  /** The matching iPod track, if found */
  ipodTrack: IPodTrack | null;
  /** Whether a match was found */
  matched: boolean;
}

/**
 * Build an index of tracks by their match key
 *
 * This is useful for efficiently finding matches in a large collection.
 *
 * @param tracks - Tracks to index
 * @returns Map from match key to track
 */
export function buildMatchIndex<T extends Matchable>(
  tracks: T[]
): Map<string, T> {
  const index = new Map<string, T>();

  for (const track of tracks) {
    const key = getMatchKey(track);
    // If there are duplicates, keep the first one
    if (!index.has(key)) {
      index.set(key, track);
    }
  }

  return index;
}

/**
 * Find matches between collection tracks and iPod tracks
 *
 * Returns which collection tracks have matches on the iPod and which don't.
 *
 * @param collectionTracks - Tracks from the collection source
 * @param ipodTracks - Tracks currently on the iPod
 * @returns Array of match results
 */
export function findMatches(
  collectionTracks: CollectionTrack[],
  ipodTracks: IPodTrack[]
): MatchResult[] {
  const ipodIndex = buildMatchIndex(ipodTracks);
  const results: MatchResult[] = [];

  for (const collectionTrack of collectionTracks) {
    const key = getMatchKey(collectionTrack);
    const ipodTrack = ipodIndex.get(key) ?? null;

    results.push({
      collectionTrack,
      ipodTrack,
      matched: ipodTrack !== null,
    });
  }

  return results;
}

/**
 * Get tracks from the iPod that don't exist in the collection
 *
 * These are candidates for removal during sync.
 *
 * @param collectionTracks - Tracks from the collection source
 * @param ipodTracks - Tracks currently on the iPod
 * @returns iPod tracks that have no match in the collection
 */
export function findOrphanedTracks(
  collectionTracks: CollectionTrack[],
  ipodTracks: IPodTrack[]
): IPodTrack[] {
  const collectionIndex = buildMatchIndex(collectionTracks);
  const orphaned: IPodTrack[] = [];

  for (const ipodTrack of ipodTracks) {
    const key = getMatchKey(ipodTrack);
    if (!collectionIndex.has(key)) {
      orphaned.push(ipodTrack);
    }
  }

  return orphaned;
}
