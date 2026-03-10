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
import { hasEnabledTransforms } from '../transforms/pipeline.js';
import { buildMatchIndex, getTransformMatchKeys } from './matching.js';
import type {
  ConflictTrack,
  DiffOptions,
  IPodTrack,
  MatchedTrack,
  MetadataChange,
  SyncDiff,
  SyncDiffer,
  UpdateTrack,
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
 * Check if a value represents "no value" (null, undefined, or empty string)
 * All these are treated as equivalent for metadata comparison.
 */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Check if two values are different (handling undefined/null/empty)
 */
function valuesDiffer(collectionValue: unknown, ipodValue: unknown): boolean {
  // Both empty -> no difference
  if (isEmpty(collectionValue) && isEmpty(ipodValue)) {
    return false;
  }
  // One empty, one not -> difference
  if (isEmpty(collectionValue) || isEmpty(ipodValue)) {
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
 * Build metadata changes array from source to target track
 */
function buildMetadataChanges(
  from: { artist: string; title: string; album: string; albumArtist?: string },
  to: { artist: string; title: string; album: string; albumArtist?: string }
): MetadataChange[] {
  const changes: MetadataChange[] = [];

  if (from.artist !== to.artist) {
    changes.push({ field: 'artist', from: from.artist, to: to.artist });
  }
  if (from.title !== to.title) {
    changes.push({ field: 'title', from: from.title, to: to.title });
  }
  if (from.album !== to.album) {
    changes.push({ field: 'album', from: from.album, to: to.album });
  }
  if (from.albumArtist !== to.albumArtist) {
    changes.push({
      field: 'albumArtist',
      from: from.albumArtist ?? '',
      to: to.albumArtist ?? '',
    });
  }

  return changes;
}

/**
 * Compute the diff between collection tracks and iPod tracks
 *
 * This function is the core of the sync engine. It determines:
 * - Which collection tracks need to be added to the iPod
 * - Which iPod tracks should be removed (not in collection)
 * - Which tracks exist on both (matched pairs)
 * - Which matched tracks have conflicting metadata
 * - Which tracks need metadata updates (e.g., transform applied/removed)
 *
 * ## Dual-Key Matching (with transforms)
 *
 * When transforms are enabled, each source track generates TWO match keys:
 * 1. Original key (from source metadata as-is)
 * 2. Transformed key (from metadata after applying transforms)
 *
 * The iPod track can match either key:
 * - Match on original key: iPod has original metadata → may need transform-apply
 * - Match on transformed key: iPod has transformed metadata → may need transform-remove
 *
 * The algorithm runs in O(n + m) time where n = collection size, m = iPod size,
 * using hash-based indexing for efficient lookups.
 *
 * @param collectionTracks - Tracks from the collection source
 * @param ipodTracks - Tracks currently on the iPod
 * @param options - Diff options including transform configuration
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
  ipodTracks: IPodTrack[],
  options?: DiffOptions
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
  const toUpdate: UpdateTrack[] = [];

  // Check if transforms are enabled
  const transforms = options?.transforms;
  const transformsEnabled = transforms && hasEnabledTransforms(transforms);

  // Process each collection track
  for (const collectionTrack of collectionTracks) {
    // Get both original and transformed keys
    const { originalKey, transformedKey, transformApplied, transformedTrack } =
      getTransformMatchKeys(collectionTrack, transforms);

    // Try to find iPod match - check original key first, then transformed
    let ipodMatch = ipodIndex.get(originalKey);
    let matchedByOriginalKey = !!ipodMatch;

    // If no match by original key and transform was applied, try transformed key
    if (!ipodMatch && transformApplied) {
      ipodMatch = ipodIndex.get(transformedKey);
      matchedByOriginalKey = false;
    }

    if (ipodMatch) {
      // Track exists on iPod - mark as matched
      matchedIpodPaths.add(ipodMatch.filePath);

      // Determine if update is needed for transforms
      if (transformApplied) {
        if (matchedByOriginalKey) {
          // iPod has original metadata, transforms are enabled → apply transform
          if (transformsEnabled) {
            toUpdate.push({
              source: collectionTrack,
              ipod: ipodMatch,
              reason: 'transform-apply',
              changes: buildMetadataChanges(ipodMatch, transformedTrack),
            });
            continue;
          }
        } else {
          // iPod has transformed metadata (matched by transformed key)
          // If transforms are now disabled, need to revert
          if (!transformsEnabled) {
            toUpdate.push({
              source: collectionTrack,
              ipod: ipodMatch,
              reason: 'transform-remove',
              changes: buildMetadataChanges(ipodMatch, collectionTrack),
            });
            continue;
          }
        }
      }

      // Check for other metadata conflicts (not transform-related)
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
      // Apply transforms to the track metadata if enabled
      if (transformsEnabled && transformApplied) {
        // Create a copy of the track with transformed metadata
        // Preserves original filePath and other source info
        const transformedSource: CollectionTrack = {
          ...collectionTrack,
          artist: transformedTrack.artist,
          title: transformedTrack.title,
        };
        toAdd.push(transformedSource);
      } else {
        toAdd.push(collectionTrack);
      }
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
    toUpdate,
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
   * @param options - Diff options including transform configuration
   * @returns The computed diff
   */
  diff(
    collectionTracks: CollectionTrack[],
    ipodTracks: IPodTrack[],
    options?: DiffOptions
  ): SyncDiff {
    return computeDiff(collectionTracks, ipodTracks, options);
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
