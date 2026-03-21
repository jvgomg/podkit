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
  buildAudioSyncTag,
  formatSyncTag,
  parseSyncTag,
  syncTagMatchesConfig,
} from './sync-tags.js';
import {
  detectPresetChange,
  detectUpgrades,
  getIpodFormatFamily,
  isFileReplacementUpgrade,
  isSourceLossless,
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
      // Skip duplicate source tracks that match the same iPod track.
      // This can happen when the source has two entries with identical
      // (artist, title, album) — e.g., a duplicated track in an album.
      // The first source track claims the iPod match; subsequent duplicates
      // are ignored to prevent phantom update loops.
      if (matchedIpodPaths.has(ipodMatch.filePath)) {
        continue;
      }

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

      // When forceTranscode is on and source is lossless, ensure the track gets
      // a file-replacement upgrade even if it only has metadata-only reasons.
      // This way the re-transcode happens and metadata updates are applied as
      // part of the upgrade transfer.
      if (
        options?.forceTranscode &&
        isSourceLossless(collectionTrack) &&
        !upgradeReasons.some(isFileReplacementUpgrade)
      ) {
        upgradeReasons.unshift('force-transcode');
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
  // When isAlacPreset is true, we check format-based detection (no presetBitrate needed).
  // Otherwise, when transcoding is active and presetBitrate is provided, check bitrate.
  // Tracks with a mismatch are moved from existing → toUpdate.
  //
  // Sync tag priority: if a track has a sync tag, use exact comparison against
  // the current config. If no sync tag, fall back to bitrate tolerance detection.
  const shouldCheckPreset =
    !(options?.skipUpgrades ?? false) &&
    (options?.isAlacPreset || (options?.transcodingActive && options?.presetBitrate));

  if (shouldCheckPreset) {
    const presetBitrate = options?.presetBitrate ?? 0;
    const presetChangeOptions = {
      encodingMode: options?.encodingMode,
      bitrateTolerance: options?.bitrateTolerance,
      isAlacPreset: options?.isAlacPreset,
    };

    // Build expected sync tag from current config (for sync tag comparison)
    const resolvedQuality = options?.resolvedQuality;
    const expectedSyncTag = resolvedQuality
      ? buildAudioSyncTag(resolvedQuality, options?.encodingMode, options?.customBitrate)
      : undefined;

    const stillExisting: MatchedTrack[] = [];

    for (const match of existing) {
      // Only check lossless-source tracks (lossy are copied as-is)
      if (!isSourceLossless(match.collection)) {
        stillExisting.push(match);
        continue;
      }

      // Try sync tag comparison first
      const syncTag = parseSyncTag(match.ipod.comment);
      let presetChange: 'preset-upgrade' | 'preset-downgrade' | null = null;

      if (syncTag && expectedSyncTag) {
        // Sync tag exists — use exact comparison
        if (!syncTagMatchesConfig(syncTag, expectedSyncTag)) {
          // Determine direction from quality tier comparison
          presetChange = determineSyncTagDirection(syncTag, expectedSyncTag);
        }
        // else: sync tag matches → in sync, presetChange stays null
      } else {
        // No sync tag on track, or no resolvedQuality in options — fall back to bitrate tolerance.
        // Callers must pass resolvedQuality to enable sync tag comparison.
        presetChange = detectPresetChange(
          match.collection,
          match.ipod,
          presetBitrate,
          presetChangeOptions
        );
      }

      if (presetChange) {
        const changes: { field: 'bitrate' | 'lossless'; from: string; to: string }[] =
          options?.isAlacPreset
            ? [
                {
                  field: 'lossless' as const,
                  from: String(match.ipod.filetype ?? 'AAC'),
                  to: 'ALAC',
                },
              ]
            : [
                {
                  field: 'bitrate' as const,
                  from: String(match.ipod.bitrate),
                  to: String(presetBitrate),
                },
              ];

        toUpdate.push({
          source: match.collection,
          ipod: match.ipod,
          reason: presetChange,
          changes,
        });
      } else {
        stillExisting.push(match);
      }
    }

    existing.length = 0;
    existing.push(...stillExisting);
  }

  // Post-processing: force re-transcoding of all lossless-source tracks.
  // Only lossless sources are affected — compatible lossy (MP3, AAC) are always
  // copied as-is and re-encoding them would only degrade quality.
  if (options?.forceTranscode) {
    const stillExisting: MatchedTrack[] = [];

    for (const match of existing) {
      if (isSourceLossless(match.collection)) {
        toUpdate.push({
          source: match.collection,
          ipod: match.ipod,
          reason: 'force-transcode',
          changes: [
            { field: 'bitrate', from: String(match.ipod.bitrate ?? 'unknown'), to: 'forced' },
          ],
        });
      } else {
        stillExisting.push(match);
      }
    }

    existing.length = 0;
    existing.push(...stillExisting);
  }

  // Post-processing: write sync tags to lossless-source tracks that are missing
  // or have outdated tags. This is metadata-only — no file replacement.
  //
  // When checkArtwork is active (source tracks have artworkHash), this also processes
  // lossy/copied sources that have artwork but no art= hash in their sync tag.
  // This establishes the artwork hash baseline so --check-artwork can detect future changes.
  // The baseline assumes the iPod artwork currently matches the source, which is the
  // expected state for a freshly synced collection.
  if (options?.forceSyncTags && options?.resolvedQuality) {
    const baseExpectedTag = buildAudioSyncTag(
      options.resolvedQuality,
      options.encodingMode,
      options.customBitrate
    );
    const stillExisting: MatchedTrack[] = [];

    for (const match of existing) {
      const sourceLossless = isSourceLossless(match.collection);

      // For lossy (copied) sources, only process when the source has an artwork hash
      // and the iPod track is missing the art= baseline in its sync tag.
      // This ensures --force-sync-tags --check-artwork establishes baselines for ALL tracks.
      if (!sourceLossless) {
        if (match.collection.artworkHash) {
          const currentTag = parseSyncTag(match.ipod.comment);
          if (!currentTag?.artworkHash || currentTag.artworkHash !== match.collection.artworkHash) {
            // Build a minimal "copy" sync tag with just the artwork hash
            const copyTag: typeof baseExpectedTag = {
              quality: 'copy',
              artworkHash: match.collection.artworkHash,
            };
            // If there's an existing tag, preserve its fields but update the artwork hash
            const expectedTag = currentTag
              ? { ...currentTag, artworkHash: match.collection.artworkHash }
              : copyTag;
            toUpdate.push({
              source: match.collection,
              ipod: match.ipod,
              reason: 'sync-tag-write',
              changes: [
                {
                  field: 'comment',
                  from: match.ipod.comment ?? '',
                  to: formatSyncTag(expectedTag),
                },
              ],
            });
            continue;
          }
        }
        stillExisting.push(match);
        continue;
      }

      // Include artwork hash in the expected tag when available (--check-artwork active).
      // This establishes the baseline by writing the source's artwork hash — it assumes
      // the iPod artwork currently matches the source, which is the expected state for
      // a freshly synced collection.
      const expectedTag = { ...baseExpectedTag };
      if (match.collection.artworkHash) {
        expectedTag.artworkHash = match.collection.artworkHash;
      }

      // Compare formatted tag strings — rewrite if the text differs,
      // even if the semantic meaning is equivalent (e.g., missing encoding=vbr).
      // This ensures all tags are complete and consistent.
      const expectedTagStr = formatSyncTag(expectedTag);
      const currentTag = parseSyncTag(match.ipod.comment);
      if (currentTag && formatSyncTag(currentTag) === expectedTagStr) {
        stillExisting.push(match);
        continue;
      }

      toUpdate.push({
        source: match.collection,
        ipod: match.ipod,
        reason: 'sync-tag-write',
        changes: [
          { field: 'comment', from: match.ipod.comment ?? '', to: formatSyncTag(expectedTag) },
        ],
      });
    }

    existing.length = 0;
    existing.push(...stillExisting);
  }

  // Post-processing: force-metadata moves ALL remaining existing tracks to toUpdate.
  // This rewrites metadata on every matched track without re-transcoding or re-transferring.
  if (options?.forceMetadata) {
    for (const match of existing) {
      const { collection: source, ipod } = match;
      const changes: MetadataChange[] = [];

      // Compare all metadata fields and report actual differences
      const allFields = [
        'title',
        'artist',
        'album',
        'albumArtist',
        'genre',
        'year',
        'trackNumber',
        'discNumber',
        'compilation',
      ] as const;

      for (const field of allFields) {
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

      // Even if no fields differ, include the track — the point of --force-metadata
      // is unconditional refresh. Use title as a no-op marker when nothing changed.
      if (changes.length === 0) {
        changes.push({
          field: 'title',
          from: ipod.title,
          to: source.title,
        });
      }

      toUpdate.push({
        source,
        ipod,
        reason: 'force-metadata',
        changes,
      });
    }
    existing.length = 0;
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

      case 'artwork-removed':
        // Artwork removed from source — iPod artwork will be cleared
        break;

      case 'artwork-updated':
        // Artwork hash changed — source has different artwork than what's on iPod
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
 * Quality tier ordering for determining preset change direction.
 *
 * Higher index = higher quality. Used when sync tags indicate a mismatch
 * to determine whether it's an upgrade or downgrade.
 */
const QUALITY_TIER_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  max: 3, // video uses 'max' directly; audio resolves 'max' to 'lossless' or 'high' before tagging
  lossless: 3,
};

/**
 * Determine the direction of a sync tag mismatch.
 *
 * Compares old (iPod) and new (config) sync tags to decide if the preset
 * change is an upgrade or downgrade. Falls back to 'preset-upgrade' if
 * the direction cannot be determined.
 */
function determineSyncTagDirection(
  oldTag: { quality: string; encoding?: string; bitrate?: number },
  newTag: { quality: string; encoding?: string; bitrate?: number }
): 'preset-upgrade' | 'preset-downgrade' {
  const oldTier = QUALITY_TIER_ORDER[oldTag.quality] ?? -1;
  const newTier = QUALITY_TIER_ORDER[newTag.quality] ?? -1;

  if (newTier > oldTier) {
    return 'preset-upgrade';
  }
  if (newTier < oldTier) {
    return 'preset-downgrade';
  }

  // Same quality tier — encoding or bitrate change.
  // If bitrate changed, use that for direction.
  if (oldTag.bitrate !== undefined && newTag.bitrate !== undefined) {
    return newTag.bitrate > oldTag.bitrate ? 'preset-upgrade' : 'preset-downgrade';
  }

  // Encoding mode change at same quality is a re-transcode (treat as upgrade)
  return 'preset-upgrade';
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
