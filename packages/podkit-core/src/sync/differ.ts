/**
 * Diff engine for comparing collection tracks to iPod tracks
 *
 * This module implements the core comparison logic that determines what
 * needs to be synced between a collection source and an iPod device.
 *
 * ## Algorithm
 *
 * The diff engine uses O(n) indexing to efficiently compare tracks:
 * 1. Build a match index from iPod tracks
 * 2. Iterate collection tracks, finding matches in the index
 * 3. Track which iPod tracks were matched
 * 4. Remaining unmatched iPod tracks are candidates for removal
 *
 * ## Conflict Detection
 *
 * When a collection track matches an iPod track (same artist/title/album),
 * we check if metadata differs. If so, it's reported as a conflict.
 * The sync planner can then decide whether to update metadata.
 *
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { TrackMetadata } from '../types.js';
import {
  buildMatchIndex,
  getMatchKey,
} from './matching.js';
import type {
  ConflictTrack,
  IPodTrack,
  MatchedTrack,
  SyncDiff,
  SyncDiffer,
} from './types.js';

/**
 * Metadata fields to check for conflicts between collection and iPod tracks
 *
 * Note: We exclude artist, title, and album from conflict detection because
 * these fields are used for matching (via normalized keys). If tracks match,
 * they are considered "the same" even if the raw strings differ (e.g., case,
 * whitespace, "The X" vs "X, The").
 *
 * We only check for conflicts in supplementary metadata fields.
 */
const CONFLICT_FIELDS: (keyof TrackMetadata)[] = [
  'albumArtist',
  'genre',
  'year',
  'trackNumber',
  'discNumber',
];

/**
 * Check if a value is null or undefined
 */
function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Check if two values are different (handling undefined)
 */
function valuesDiffer(
  collectionValue: unknown,
  ipodValue: unknown
): boolean {
  // Both undefined/null -> no difference
  if (isNullish(collectionValue) && isNullish(ipodValue)) {
    return false;
  }
  // One undefined, one not -> difference
  if (isNullish(collectionValue) || isNullish(ipodValue)) {
    return true;
  }
  // For strings, do case-insensitive comparison (metadata often has case variations)
  if (typeof collectionValue === 'string' && typeof ipodValue === 'string') {
    return collectionValue.toLowerCase().trim() !== ipodValue.toLowerCase().trim();
  }
  // For other types, strict equality
  return collectionValue !== ipodValue;
}

/**
 * Find metadata fields that differ between collection and iPod tracks
 */
function findConflictingFields(
  collection: CollectionTrack,
  ipod: IPodTrack
): (keyof TrackMetadata)[] {
  const conflicts: (keyof TrackMetadata)[] = [];

  for (const field of CONFLICT_FIELDS) {
    const collectionValue = collection[field as keyof CollectionTrack];
    const ipodValue = ipod[field as keyof IPodTrack];

    if (valuesDiffer(collectionValue, ipodValue)) {
      conflicts.push(field);
    }
  }

  return conflicts;
}

/**
 * Compute the diff between collection tracks and iPod tracks
 *
 * This function is the core of the sync engine. It determines:
 * - Which collection tracks need to be added to the iPod
 * - Which iPod tracks should be removed (not in collection)
 * - Which tracks exist on both (matched pairs)
 * - Which matched tracks have conflicting metadata
 *
 * The algorithm runs in O(n + m) time where n = collection size, m = iPod size,
 * using hash-based indexing for efficient lookups.
 *
 * @param collectionTracks - Tracks from the collection source
 * @param ipodTracks - Tracks currently on the iPod
 * @returns The computed diff
 *
 * @example
 * const diff = computeDiff(collectionTracks, ipodTracks);
 * console.log(`${diff.toAdd.length} tracks to add`);
 * console.log(`${diff.toRemove.length} tracks to remove`);
 * console.log(`${diff.existing.length} tracks already synced`);
 */
export function computeDiff(
  collectionTracks: CollectionTrack[],
  ipodTracks: IPodTrack[]
): SyncDiff {
  // Build index from iPod tracks for O(1) lookup
  const ipodIndex = buildMatchIndex(ipodTracks);

  // Track which iPod track file paths have been matched
  // We use file paths instead of keys to handle duplicate tracks correctly
  // (filePath is unique per track on the iPod)
  const matchedIpodPaths = new Set<string>();

  // Output arrays
  const toAdd: CollectionTrack[] = [];
  const existing: MatchedTrack[] = [];
  const conflicts: ConflictTrack[] = [];

  // Process each collection track
  for (const collectionTrack of collectionTracks) {
    const key = getMatchKey(collectionTrack);
    const ipodMatch = ipodIndex.get(key);

    if (ipodMatch) {
      // Track exists on iPod - mark as matched
      matchedIpodPaths.add(ipodMatch.filePath);

      // Check for conflicts
      const conflictingFields = findConflictingFields(collectionTrack, ipodMatch);

      if (conflictingFields.length > 0) {
        // Has metadata conflicts
        conflicts.push({
          collection: collectionTrack,
          ipod: ipodMatch,
          conflicts: conflictingFields,
        });
      } else {
        // Fully in sync
        existing.push({
          collection: collectionTrack,
          ipod: ipodMatch,
        });
      }
    } else {
      // Track not on iPod - needs to be added
      toAdd.push(collectionTrack);
    }
  }

  // Find iPod tracks that weren't matched (candidates for removal)
  // This includes duplicate tracks that weren't selected from the index
  const toRemove: IPodTrack[] = [];
  for (const ipodTrack of ipodTracks) {
    if (!matchedIpodPaths.has(ipodTrack.filePath)) {
      toRemove.push(ipodTrack);
    }
  }

  return {
    toAdd,
    toRemove,
    existing,
    conflicts,
  };
}

/**
 * Default implementation of SyncDiffer interface
 *
 * This class wraps the computeDiff function to implement the SyncDiffer interface.
 * It can be extended to add caching or other optimizations.
 */
export class DefaultSyncDiffer implements SyncDiffer {
  /**
   * Compare collection tracks to iPod tracks
   *
   * @param collectionTracks - Tracks from the collection source
   * @param ipodTracks - Tracks currently on the iPod
   * @returns The computed diff
   */
  diff(
    collectionTracks: CollectionTrack[],
    ipodTracks: IPodTrack[]
  ): SyncDiff {
    return computeDiff(collectionTracks, ipodTracks);
  }
}

/**
 * Create a new SyncDiffer instance
 *
 * @returns A new DefaultSyncDiffer instance
 */
export function createDiffer(): SyncDiffer {
  return new DefaultSyncDiffer();
}
