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
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import { hasEnabledTransforms } from '../transforms/pipeline.js';
import { buildMatchIndex, getTransformMatchKeys } from './matching.js';
import {
  detectPresetChange,
  detectUpgrades,
  getIpodFormatFamily,
  isFileReplacementUpgrade,
  metadataValuesDiffer,
} from './upgrades.js';
import type {
  DiffOptions,
  IPodTrack,
  MatchedTrack,
  MetadataChange,
  SyncDiff,
  SyncDiffer,
  UpdateTrack,
  UpgradeReason,
} from './types.js';

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

      // Check for upgrades (self-healing sync)
      let upgradeReasons = detectUpgrades(collectionTrack, ipodMatch);

      // When transcoding is active, lossless source → lossy iPod is expected
      // ONLY if the iPod track is already in the target format (AAC).
      // If the iPod track is MP3 (a compatible-lossy copy from before the source
      // was upgraded to FLAC), that IS a genuine format upgrade opportunity.
      if (options?.transcodingActive && upgradeReasons.includes('format-upgrade')) {
        const ipodFamily = getIpodFormatFamily(ipodMatch);
        if (ipodFamily === 'aac') {
          upgradeReasons = upgradeReasons.filter((r) => r !== 'format-upgrade');
        }
      }

      if (upgradeReasons.length > 0) {
        // Filter by skipUpgrades: when enabled, suppress file-replacement upgrades
        // but keep metadata-only upgrades (soundcheck, metadata-correction)
        const skipUpgrades = options?.skipUpgrades ?? false;
        const effectiveReasons = skipUpgrades
          ? upgradeReasons.filter((r) => !isFileReplacementUpgrade(r))
          : upgradeReasons;

        if (effectiveReasons.length > 0) {
          // Build changes for upgrade tracking
          const changes = buildUpgradeChanges(collectionTrack, ipodMatch, effectiveReasons);

          // Use the first reason as the primary/headline reason for display.
          // detectUpgrades() returns reasons in priority order (format > quality >
          // artwork > soundcheck > metadata), so reasons[0] is the most significant.
          // Full detail is available in the changes array.
          toUpdate.push({
            source: collectionTrack,
            ipod: ipodMatch,
            reason: effectiveReasons[0]!,
            changes,
          });
          continue;
        }
      }

      // Fully in sync
      existing.push({
        collection: collectionTrack,
        ipod: ipodMatch,
      });
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

  // Post-processing: detect quality preset changes on existing tracks.
  // Only when transcoding is active (lossy preset) and presetBitrate is provided.
  // Tracks with a bitrate mismatch are moved from existing → toUpdate.
  if (options?.transcodingActive && options?.presetBitrate && !(options?.skipUpgrades ?? false)) {
    const presetBitrate = options.presetBitrate;
    const stillExisting: MatchedTrack[] = [];

    for (const match of existing) {
      const presetChange = detectPresetChange(match.collection, match.ipod, presetBitrate);
      if (presetChange) {
        toUpdate.push({
          source: match.collection,
          ipod: match.ipod,
          reason: presetChange,
          changes: [
            {
              field: 'bitrate',
              from: String(match.ipod.bitrate),
              to: String(presetBitrate),
            },
          ],
        });
      } else {
        stillExisting.push(match);
      }
    }

    existing.length = 0;
    existing.push(...stillExisting);
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
    toUpdate,
  };
}

/**
 * Build metadata changes array for upgrade tracking
 *
 * Produces human-readable change entries describing what's being upgraded.
 */
function buildUpgradeChanges(
  source: CollectionTrack,
  ipod: IPodTrack,
  reasons: UpgradeReason[]
): MetadataChange[] {
  const changes: MetadataChange[] = [];

  for (const reason of reasons) {
    switch (reason) {
      case 'format-upgrade':
        changes.push({
          field: 'fileType',
          from: ipod.filetype ?? 'unknown',
          to: source.fileType,
        });
        break;

      case 'quality-upgrade':
        changes.push({
          field: 'bitrate',
          from: String(ipod.bitrate),
          to: String(source.bitrate ?? 'unknown'),
        });
        break;

      case 'artwork-added':
        // Placeholder for when CollectionTrack gains artwork metadata
        break;

      case 'soundcheck-update':
        changes.push({
          field: 'soundcheck',
          from: String(ipod.soundcheck ?? 'absent'),
          to: String(source.soundcheck ?? 'absent'),
        });
        break;

      case 'metadata-correction': {
        // Report each differing metadata field
        const metadataFields = [
          'genre',
          'year',
          'trackNumber',
          'discNumber',
          'albumArtist',
          'compilation',
        ] as const;

        for (const field of metadataFields) {
          const sourceValue = source[field as keyof CollectionTrack];
          const ipodValue = ipod[field as keyof IPodTrack];

          if (metadataValuesDiffer(field, sourceValue, ipodValue)) {
            changes.push({
              field: field as MetadataChange['field'],
              from: String(ipodValue ?? ''),
              to: String(sourceValue ?? ''),
            });
          }
        }
        break;
      }
    }
  }

  return changes;
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
