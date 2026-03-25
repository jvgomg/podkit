/**
 * MusicHandler — ContentTypeHandler implementation for music tracks
 *
 * Thin wrapper that delegates to existing music sync functions
 * (matching, differ, planner, executor) via the ContentTypeHandler interface.
 *
 * @module
 */

import type { CollectionTrack, CollectionAdapter } from '../../adapters/interface.js';
import type { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import type { EncodingMode } from '../../transcode/types.js';
import type { DeviceAdapter, DeviceTrack } from '../../device/adapter.js';
import type { TransformsConfig } from '../../transforms/types.js';
import { isMusicMediaType } from '../../ipod/constants.js';
import { applyTransforms, hasEnabledTransforms } from '../../transforms/pipeline.js';
import { getMatchKey, getTransformMatchKeys } from '../matching.js';
import {
  detectUpgrades,
  getIpodFormatFamily,
  isFileReplacementUpgrade,
  isSourceLossless,
  metadataValuesDiffer,
  detectPresetChange,
} from '../upgrades.js';
import {
  calculateMusicOperationSize,
  categorizeSource,
  changesToMetadata,
  isDeviceCompatible,
  isLosslessSource,
  willWarnLossyToLossy,
} from '../music-planner.js';
import { MusicExecutor, getMusicOperationDisplayName } from '../music-executor.js';
import type { SyncTagConfig, RetryConfig } from '../music-executor.js';
import { estimateTransferTime } from '../estimation.js';
import {
  buildAudioSyncTag,
  parseSyncTag,
  formatSyncTag,
  syncTagMatchesConfig,
} from '../sync-tags.js';
import type {
  MetadataChange,
  SyncOperation,
  SyncPlan,
  SyncWarning,
  ExecutorProgress,
  UpdateReason,
  UpgradeReason,
} from '../types.js';
import type {
  ContentTypeHandler,
  HandlerDiffOptions,
  HandlerPlanOptions,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
  MatchInfo,
  UnifiedSyncDiff,
} from '../content-type.js';

// =============================================================================
// Music Execution Configuration
// =============================================================================

/** Configuration for the music execution pipeline */
export interface MusicExecutionConfig {
  transcoder: FFmpegTranscoder;
  adapter?: CollectionAdapter;
  syncTagConfig?: SyncTagConfig;
  artwork?: boolean;
  continueOnError?: boolean;
  retryConfig?: RetryConfig;
  /**
   * Resize embedded artwork to this maximum dimension (pixels, square).
   * Used for devices where embedded artwork is the primary display source.
   */
  artworkResize?: number;
}

/** Music-specific diff options passed via handlerOptions */
export interface MusicHandlerDiffOptions {
  forceSyncTags?: boolean;
  encodingMode?: EncodingMode;
  bitrateTolerance?: number;
  isAlacPreset?: boolean;
  resolvedQuality?: string;
  customBitrate?: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Quality tier ordering for sync tag direction comparison.
 * Higher number = higher quality.
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
 * Build metadata changes for transform apply/remove operations.
 * Compares basic metadata fields between two track-like objects.
 */
function buildMusicMetadataChanges(
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

// =============================================================================
// MusicHandler Implementation
// =============================================================================

/**
 * ContentTypeHandler implementation for music tracks.
 *
 * Delegates to existing music sync functions from matching.ts, differ.ts,
 * planner.ts, and executor.ts.
 */
export class MusicHandler implements ContentTypeHandler<CollectionTrack, DeviceTrack> {
  readonly type = 'music';

  private executionConfig?: MusicExecutionConfig;
  private transformsConfig?: TransformsConfig;

  /**
   * Configure the music execution pipeline.
   * Must be called before executeBatch() for non-dry-run execution.
   */
  setExecutionConfig(config: MusicExecutionConfig): void {
    this.executionConfig = config;
  }

  /**
   * Set the transforms configuration for dual-key matching.
   * Must be called before diff() when transforms are in use.
   */
  setTransformsConfig(config: TransformsConfig | undefined): void {
    this.transformsConfig = config;
  }

  // ---- Diffing ----

  generateMatchKey(source: CollectionTrack): string {
    return getMatchKey(source);
  }

  generateDeviceMatchKey(device: DeviceTrack): string {
    return getMatchKey(device);
  }

  applyTransformKey(source: CollectionTrack): string {
    // getTransformMatchKeys always computes both keys; return the transformed one
    const keys = getTransformMatchKeys(source, this.transformsConfig);
    return keys.transformedKey;
  }

  getDeviceItemId(device: DeviceTrack): string {
    // DeviceTrack's filePath is unique per track on the device
    return device.filePath;
  }

  transformSourceForAdd(source: CollectionTrack): CollectionTrack {
    if (!this.transformsConfig || !hasEnabledTransforms(this.transformsConfig)) {
      return source;
    }

    const result = applyTransforms(source, this.transformsConfig);
    if (!result.applied) {
      return source;
    }

    // Create a copy with transformed metadata, preserving original source info
    return {
      ...source,
      artist: result.transformed.artist,
      title: result.transformed.title,
    };
  }

  detectUpdates(
    source: CollectionTrack,
    device: DeviceTrack,
    options: HandlerDiffOptions,
    matchInfo?: MatchInfo
  ): UpdateReason[] {
    // Transform detection (when matchInfo available)
    if (matchInfo) {
      const hasTransform = this.generateMatchKey(source) !== this.applyTransformKey(source);
      if (hasTransform) {
        if (!matchInfo.matchedByTransformKey && options.transformsEnabled) {
          // iPod has original metadata, transforms are enabled -> apply
          return ['transform-apply'];
        }
        if (matchInfo.matchedByTransformKey && !options.transformsEnabled) {
          // iPod has transformed metadata, transforms are disabled -> remove
          return ['transform-remove'];
        }
      }
    }

    let reasons = detectUpgrades(source, device) as UpdateReason[];

    // When transcoding is active, lossless source → lossy iPod is expected
    // ONLY if the iPod track is already in the target format (AAC).
    // If the iPod track is MP3 (a compatible-lossy copy from before the source
    // was upgraded to FLAC), that IS a genuine format upgrade opportunity.
    if (options.transcodingActive && reasons.includes('format-upgrade')) {
      const ipodFamily = getIpodFormatFamily(device);
      if (ipodFamily === 'aac') {
        reasons = reasons.filter((r) => r !== 'format-upgrade');
      }
    }

    // When skipUpgrades is set, filter out file-replacement upgrades
    if (options.skipUpgrades) {
      reasons = reasons.filter((r) => !isFileReplacementUpgrade(r as UpgradeReason));
    }

    // When forceTranscode is on and source is lossless, ensure file-replacement
    if (options.forceTranscode) {
      const category = categorizeSource(source);
      if (
        isLosslessSource(category) &&
        !reasons.some((r) => isFileReplacementUpgrade(r as UpgradeReason))
      ) {
        reasons.unshift('force-transcode');
      }
    }

    return reasons;
  }

  // ---- Post-processing ----

  postProcessDiff(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    options: HandlerDiffOptions
  ): void {
    const musicOpts = (options.handlerOptions ?? {}) as MusicHandlerDiffOptions;

    // Pass 0: Populate changes for transform and upgrade updates from detectUpdates
    this.postProcessBuildChanges(diff);

    // Pass 1: Preset change detection
    this.postProcessPresetChanges(diff, options, musicOpts);

    // Pass 2: Force transcode sweep
    this.postProcessForceTranscode(diff, options);

    // Pass 3: Sync tag writing
    this.postProcessSyncTags(diff, musicOpts);

    // Pass 4: Force metadata rewrite
    this.postProcessForceMetadata(diff, options);
  }

  /**
   * Pass 0: Populate changes arrays for updates detected by detectUpdates().
   *
   * detectUpdates() only returns reason strings — this pass builds the
   * MetadataChange arrays needed for planning and display.
   */
  private postProcessBuildChanges(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    for (const update of diff.toUpdate) {
      if (update.changes && update.changes.length > 0) continue; // already populated

      const reason = update.reasons[0];

      if (reason === 'transform-apply') {
        // Build changes from device metadata → transformed source metadata
        const transformedSource = this.transformSourceForAdd(update.source);
        update.changes = buildMusicMetadataChanges(update.device, transformedSource);
      } else if (reason === 'transform-remove') {
        // Build changes from device metadata → original source metadata
        update.changes = buildMusicMetadataChanges(update.device, update.source);
      } else if (reason === 'format-upgrade' || reason === 'quality-upgrade') {
        // Build changes showing the format/quality difference
        const changes: MetadataChange[] = [];
        if (reason === 'format-upgrade') {
          changes.push({
            field: 'fileType',
            from: update.device.filetype ?? 'unknown',
            to: update.source.fileType,
          });
        }
        if (reason === 'quality-upgrade') {
          changes.push({
            field: 'bitrate',
            from: String(update.device.bitrate),
            to: String(update.source.bitrate ?? 'unknown'),
          });
        }
        update.changes = changes;
      } else if (reason === 'metadata-correction') {
        // Build changes for metadata fields that differ
        const changes: MetadataChange[] = [];
        const metadataFields = [
          'genre',
          'year',
          'trackNumber',
          'discNumber',
          'albumArtist',
          'compilation',
        ] as const;
        for (const field of metadataFields) {
          const sourceValue = update.source[field as keyof CollectionTrack];
          const ipodValue = update.device[field as keyof DeviceTrack];
          if (metadataValuesDiffer(field, sourceValue, ipodValue)) {
            changes.push({
              field: field as MetadataChange['field'],
              from: String(ipodValue ?? ''),
              to: String(sourceValue ?? ''),
            });
          }
        }
        update.changes = changes;
      } else if (reason === 'soundcheck-update') {
        update.changes = [
          {
            field: 'soundcheck',
            from: String(update.device.soundcheck ?? 'absent'),
            to: String(update.source.soundcheck ?? 'absent'),
          },
        ];
      }
    }
  }

  /**
   * Pass 1: Detect quality preset changes on existing tracks.
   * When isAlacPreset is true, check format-based detection (no presetBitrate needed).
   * Otherwise, when transcoding is active and presetBitrate is provided, check bitrate.
   * Tracks with a mismatch are moved from existing -> toUpdate.
   *
   * Sync tag priority: if a track has a sync tag, use exact comparison against
   * the current config. If no sync tag, fall back to bitrate tolerance detection.
   */
  private postProcessPresetChanges(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    options: HandlerDiffOptions,
    musicOpts: MusicHandlerDiffOptions
  ): void {
    const shouldCheckPreset =
      !(options.skipUpgrades ?? false) &&
      (musicOpts.isAlacPreset || (options.transcodingActive && options.presetBitrate));

    if (!shouldCheckPreset) return;

    const presetBitrate = options.presetBitrate ?? 0;
    const presetChangeOptions = {
      encodingMode: musicOpts.encodingMode,
      bitrateTolerance: musicOpts.bitrateTolerance,
      isAlacPreset: musicOpts.isAlacPreset,
    };

    // Build expected sync tag from current config (for sync tag comparison)
    const resolvedQuality = musicOpts.resolvedQuality;
    const expectedSyncTag = resolvedQuality
      ? buildAudioSyncTag(resolvedQuality, musicOpts.encodingMode, musicOpts.customBitrate)
      : undefined;

    const stillExisting: Array<{ source: CollectionTrack; device: DeviceTrack }> = [];

    for (const match of diff.existing) {
      // Only check lossless-source tracks (lossy are copied as-is)
      if (!isSourceLossless(match.source)) {
        stillExisting.push(match);
        continue;
      }

      // Try sync tag comparison first
      const syncTag = parseSyncTag(match.device.comment);
      let presetChange: 'preset-upgrade' | 'preset-downgrade' | null = null;

      if (syncTag && expectedSyncTag) {
        // Sync tag exists — use exact comparison
        if (!syncTagMatchesConfig(syncTag, expectedSyncTag)) {
          // Determine direction from quality tier comparison
          presetChange = determineSyncTagDirection(syncTag, expectedSyncTag);
        }
        // else: sync tag matches -> in sync, presetChange stays null
      } else {
        // No sync tag on track, or no resolvedQuality in options — fall back to bitrate tolerance.
        // Callers must pass resolvedQuality to enable sync tag comparison.
        presetChange = detectPresetChange(
          match.source,
          match.device,
          presetBitrate,
          presetChangeOptions
        );
      }

      if (presetChange) {
        const changes: MetadataChange[] = musicOpts.isAlacPreset
          ? [
              {
                field: 'lossless' as const,
                from: String(match.device.filetype ?? 'AAC'),
                to: 'ALAC',
              },
            ]
          : [
              {
                field: 'bitrate' as const,
                from: String(match.device.bitrate),
                to: String(presetBitrate),
              },
            ];

        diff.toUpdate.push({
          source: match.source,
          device: match.device,
          reasons: [presetChange],
          changes,
        });
      } else {
        stillExisting.push(match);
      }
    }

    diff.existing.length = 0;
    diff.existing.push(...stillExisting);
  }

  /**
   * Pass 2: Force re-transcoding of all lossless-source tracks.
   * Only lossless sources are affected — compatible lossy (MP3, AAC) are always
   * copied as-is and re-encoding them would only degrade quality.
   */
  private postProcessForceTranscode(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    options: HandlerDiffOptions
  ): void {
    if (!options.forceTranscode) return;

    const stillExisting: Array<{ source: CollectionTrack; device: DeviceTrack }> = [];

    for (const match of diff.existing) {
      if (isSourceLossless(match.source)) {
        diff.toUpdate.push({
          source: match.source,
          device: match.device,
          reasons: ['force-transcode'],
          changes: [
            { field: 'bitrate', from: String(match.device.bitrate ?? 'unknown'), to: 'forced' },
          ],
        });
      } else {
        stillExisting.push(match);
      }
    }

    diff.existing.length = 0;
    diff.existing.push(...stillExisting);
  }

  /**
   * Pass 3: Write sync tags to lossless-source tracks that are missing
   * or have outdated tags. This is metadata-only — no file replacement.
   *
   * When checkArtwork is active (source tracks have artworkHash), this also processes
   * lossy/copied sources that have artwork but no art= hash in their sync tag.
   * This establishes the artwork hash baseline so --check-artwork can detect future changes.
   * The baseline assumes the iPod artwork currently matches the source, which is the
   * expected state for a freshly synced collection.
   */
  private postProcessSyncTags(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    musicOpts: MusicHandlerDiffOptions
  ): void {
    if (!(musicOpts.forceSyncTags && musicOpts.resolvedQuality)) return;

    const baseExpectedTag = buildAudioSyncTag(
      musicOpts.resolvedQuality,
      musicOpts.encodingMode,
      musicOpts.customBitrate
    );
    const stillExisting: Array<{ source: CollectionTrack; device: DeviceTrack }> = [];

    for (const match of diff.existing) {
      const sourceLossless = isSourceLossless(match.source);

      // For lossy (copied) sources, only process when the source has an artwork hash
      // and the iPod track is missing the art= baseline in its sync tag.
      // This ensures --force-sync-tags --check-artwork establishes baselines for ALL tracks.
      if (!sourceLossless) {
        if (match.source.artworkHash) {
          const currentTag = parseSyncTag(match.device.comment);
          if (!currentTag?.artworkHash || currentTag.artworkHash !== match.source.artworkHash) {
            // Build a minimal "copy" sync tag with just the artwork hash
            const copyTag: typeof baseExpectedTag = {
              quality: 'copy',
              artworkHash: match.source.artworkHash,
            };
            // If there's an existing tag, preserve its fields but update the artwork hash
            const expectedTag = currentTag
              ? { ...currentTag, artworkHash: match.source.artworkHash }
              : copyTag;
            diff.toUpdate.push({
              source: match.source,
              device: match.device,
              reasons: ['sync-tag-write'],
              changes: [
                {
                  field: 'comment',
                  from: match.device.comment ?? '',
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
      if (match.source.artworkHash) {
        expectedTag.artworkHash = match.source.artworkHash;
      }

      // Compare formatted tag strings — rewrite if the text differs,
      // even if the semantic meaning is equivalent (e.g., missing encoding=vbr).
      // This ensures all tags are complete and consistent.
      const expectedTagStr = formatSyncTag(expectedTag);
      const currentTag = parseSyncTag(match.device.comment);
      if (currentTag && formatSyncTag(currentTag) === expectedTagStr) {
        stillExisting.push(match);
        continue;
      }

      diff.toUpdate.push({
        source: match.source,
        device: match.device,
        reasons: ['sync-tag-write'],
        changes: [
          { field: 'comment', from: match.device.comment ?? '', to: formatSyncTag(expectedTag) },
        ],
      });
    }

    diff.existing.length = 0;
    diff.existing.push(...stillExisting);
  }

  /**
   * Pass 4: Force-metadata moves ALL remaining existing tracks to toUpdate.
   * This rewrites metadata on every matched track without re-transcoding or re-transferring.
   */
  private postProcessForceMetadata(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    options: HandlerDiffOptions
  ): void {
    if (!options.forceMetadata) return;

    for (const match of diff.existing) {
      const { source, device } = match;
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
        const ipodValue = device[field as keyof DeviceTrack];

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
          from: device.title,
          to: source.title,
        });
      }

      diff.toUpdate.push({
        source,
        device,
        reasons: ['force-metadata'],
        changes,
      });
    }
    diff.existing.length = 0;
  }

  // ---- Planning ----

  planAdd(source: CollectionTrack, options: HandlerPlanOptions): SyncOperation {
    // Device-level codec check: if the device natively supports this format,
    // copy directly regardless of source category
    if (isDeviceCompatible(source, options.supportedAudioCodecs)) {
      if (options.primaryArtworkSource === 'embedded') {
        return { type: 'add-optimized-copy', source };
      }
      if (options.transferMode === 'optimized') {
        return { type: 'add-optimized-copy', source };
      }
      return { type: 'add-direct-copy', source };
    }

    const category = categorizeSource(source);

    if (category === 'compatible-lossy') {
      // Embedded-artwork devices need FFmpeg to resize artwork in all modes
      if (options.primaryArtworkSource === 'embedded') {
        return { type: 'add-optimized-copy', source };
      }
      // Database-artwork devices: fast/portable = direct copy, optimized = FFmpeg strip
      if (options.transferMode === 'optimized') {
        return { type: 'add-optimized-copy', source };
      }
      return { type: 'add-direct-copy', source };
    }

    // Lossless or incompatible lossy — needs transcoding
    // Determine preset name based on options
    const presetName =
      options.qualityPreset === 'max'
        ? options.deviceSupportsAlac
          ? 'lossless'
          : 'high'
        : ((options.qualityPreset as 'high' | 'medium' | 'low') ?? 'high');

    // ALAC source with lossless preset can be copied directly
    if (presetName === 'lossless' && source.codec?.toLowerCase() === 'alac') {
      return { type: 'add-direct-copy', source };
    }

    return {
      type: 'add-transcode',
      source,
      preset: {
        name: presetName as Exclude<typeof presetName, 'max'>,
        ...(options.customBitrate !== undefined && { bitrateOverride: options.customBitrate }),
      },
    };
  }

  planRemove(device: DeviceTrack): SyncOperation {
    return { type: 'remove', track: device };
  }

  planUpdate(
    source: CollectionTrack,
    device: DeviceTrack,
    reasons: UpdateReason[],
    options?: HandlerPlanOptions,
    changes?: MetadataChange[]
  ): SyncOperation[] {
    if (reasons.length === 0) return [];

    const primaryReason = reasons[0]!;

    // artwork-updated and artwork-removed need source file access for artwork re-extraction
    // or removal, but don't replace the audio file — route as upgrade-artwork
    if (primaryReason === 'artwork-updated' || primaryReason === 'artwork-removed') {
      return [
        {
          type: 'upgrade-artwork',
          source,
          target: device,
          reason: primaryReason as UpgradeReason,
        },
      ];
    }

    // File-replacement upgrades
    if (isFileReplacementUpgrade(primaryReason as UpgradeReason)) {
      // Device-level codec check: if the device natively supports this format,
      // always use a copy upgrade regardless of source category
      if (isDeviceCompatible(source, options?.supportedAudioCodecs)) {
        if (options?.primaryArtworkSource === 'embedded') {
          return [
            {
              type: 'upgrade-optimized-copy',
              source,
              target: device,
              reason: primaryReason as UpgradeReason,
            },
          ];
        }
        if (options?.transferMode === 'optimized') {
          return [
            {
              type: 'upgrade-optimized-copy',
              source,
              target: device,
              reason: primaryReason as UpgradeReason,
            },
          ];
        }
        return [
          {
            type: 'upgrade-direct-copy',
            source,
            target: device,
            reason: primaryReason as UpgradeReason,
          },
        ];
      }

      // Resolve the transcode preset for the upgrade (same logic as planAdd)
      const category = categorizeSource(source);

      if (category !== 'compatible-lossy') {
        const presetName =
          options?.qualityPreset === 'max'
            ? options?.deviceSupportsAlac
              ? 'lossless'
              : 'high'
            : ((options?.qualityPreset as 'high' | 'medium' | 'low') ?? 'high');

        // ALAC source with lossless preset can be copied directly
        if (presetName === 'lossless' && source.codec?.toLowerCase() === 'alac') {
          return [
            {
              type: 'upgrade-direct-copy',
              source,
              target: device,
              reason: primaryReason as UpgradeReason,
            },
          ];
        }

        return [
          {
            type: 'upgrade-transcode',
            source,
            target: device,
            reason: primaryReason as UpgradeReason,
            preset: {
              name: presetName as Exclude<typeof presetName, 'max'>,
              ...(options?.customBitrate !== undefined && {
                bitrateOverride: options.customBitrate,
              }),
            },
          },
        ];
      }

      // compatible-lossy — copy upgrade
      if (options?.primaryArtworkSource === 'embedded') {
        return [
          {
            type: 'upgrade-optimized-copy',
            source,
            target: device,
            reason: primaryReason as UpgradeReason,
          },
        ];
      }
      return [
        {
          type: 'upgrade-direct-copy',
          source,
          target: device,
          reason: primaryReason as UpgradeReason,
        },
      ];
    }

    // Metadata-only updates — populate metadata from changes
    const metadata = changes ? changesToMetadata(changes) : {};
    return [
      {
        type: 'update-metadata',
        track: device,
        metadata,
      },
    ];
  }

  estimateSize(op: SyncOperation): number {
    return calculateMusicOperationSize(op);
  }

  estimateTime(op: SyncOperation): number {
    const size = calculateMusicOperationSize(op);
    if (op.type === 'remove') return 0.1;
    if (op.type === 'update-metadata') return 0.01;
    return estimateTransferTime(size);
  }

  collectPlanWarnings(operations: SyncOperation[], options?: HandlerPlanOptions): SyncWarning[] {
    const warnings: SyncWarning[] = [];
    const lossyToLossyTracks: CollectionTrack[] = [];

    for (const op of operations) {
      if (op.type === 'add-transcode' || op.type === 'upgrade-transcode') {
        const category = categorizeSource(op.source as CollectionTrack);
        if (willWarnLossyToLossy(category)) {
          lossyToLossyTracks.push(op.source as CollectionTrack);
        }
      }
    }

    if (lossyToLossyTracks.length > 0) {
      warnings.push({
        type: 'lossy-to-lossy',
        message: `${lossyToLossyTracks.length} track${lossyToLossyTracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion (OGG, Opus). This is unavoidable but results in quality loss.`,
        tracks: lossyToLossyTracks,
      });
    }

    // Warn when portable mode is used with an embedded-artwork device
    if (
      options?.primaryArtworkSource === 'embedded' &&
      options?.transferMode === 'portable' &&
      options?.artworkMaxResolution &&
      operations.length > 0
    ) {
      warnings.push({
        type: 'embedded-artwork-resize',
        message: `Artwork resized to device maximum (${options.artworkMaxResolution}px) — this device reads artwork from embedded file data and cannot use full-resolution images. Portable mode preserves audio quality but artwork is optimized for the device.`,
        tracks: [],
      });
    }

    return warnings;
  }

  // ---- Execution ----

  async *execute(op: SyncOperation, _ctx: ExecutionContext): AsyncGenerator<OperationProgress> {
    // Stub — real execution stays in MusicExecutor for now
    yield { operation: op, phase: 'starting' };
    yield { operation: op, phase: 'complete' };
  }

  async *executeBatch(
    operations: SyncOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    if (!this.executionConfig) {
      // Fallback to sequential stub when no execution config set
      for (const op of operations) {
        yield* this.execute(op, ctx);
      }
      return;
    }

    const {
      transcoder,
      adapter,
      syncTagConfig,
      artwork,
      continueOnError,
      retryConfig,
      artworkResize,
    } = this.executionConfig;

    // Wrap operations in a SyncPlan for MusicExecutor
    const plan: SyncPlan = {
      operations,
      estimatedSize: operations.reduce((sum, op) => sum + this.estimateSize(op), 0),
      estimatedTime: operations.reduce((sum, op) => sum + this.estimateTime(op), 0),
      warnings: [],
    };

    // Create the 3-stage pipeline executor.
    const executor = new MusicExecutor({ device: ctx.device, transcoder });

    // Execute and bridge events
    for await (const progress of executor.execute(plan, {
      dryRun: ctx.dryRun,
      signal: ctx.signal,
      tempDir: ctx.tempDir,
      artwork,
      adapter,
      syncTagConfig,
      continueOnError,
      retryConfig,
      artworkResize,
    })) {
      // Filter out batch-level events that don't map to per-operation progress
      if (progress.phase === 'updating-db' || progress.phase === 'complete') {
        continue;
      }

      // Bridge ExecutorProgress → OperationProgress
      yield this.bridgeProgress(progress);
    }
  }

  /**
   * Bridge an ExecutorProgress event from MusicExecutor to an OperationProgress event.
   *
   * MusicExecutor yields one event per completed/failed/skipped operation
   * (plus batch-level 'updating-db' and 'complete' which are filtered before this).
   */
  private bridgeProgress(progress: ExecutorProgress): OperationProgress {
    let phase: OperationProgress['phase'];

    if (progress.error) {
      phase = 'failed';
    } else if (progress.skipped) {
      phase = 'complete';
    } else {
      // Successful operation completion (transcoding, copying, removing, etc.)
      phase = 'complete';
    }

    return {
      operation: progress.operation,
      phase,
      progress: progress.bytesTotal > 0 ? progress.bytesProcessed / progress.bytesTotal : undefined,
      error: progress.error,
      skipped: progress.skipped,
      transcodeProgress: progress.transcodeProgress
        ? {
            percent: progress.transcodeProgress.percent,
            speed: progress.transcodeProgress.speed,
          }
        : undefined,
    };
  }

  // ---- Device ----

  getDeviceItems(device: DeviceAdapter): DeviceTrack[] {
    return device.getTracks().filter((track) => isMusicMediaType(track.mediaType));
  }

  // ---- Display ----

  getDisplayName(op: SyncOperation): string {
    return getMusicOperationDisplayName(op);
  }

  formatDryRun(plan: SyncPlan): DryRunSummary {
    const operationCounts: Record<string, number> = {};
    const operations: DryRunSummary['operations'] = [];
    let toAdd = 0;
    let toRemove = 0;
    let toUpdate = 0;

    for (const op of plan.operations) {
      operationCounts[op.type] = (operationCounts[op.type] ?? 0) + 1;

      if (
        op.type === 'add-transcode' ||
        op.type === 'add-direct-copy' ||
        op.type === 'add-optimized-copy'
      )
        toAdd++;
      else if (op.type === 'remove') toRemove++;
      else if (
        op.type === 'update-metadata' ||
        op.type === 'upgrade-transcode' ||
        op.type === 'upgrade-direct-copy' ||
        op.type === 'upgrade-optimized-copy' ||
        op.type === 'upgrade-artwork'
      )
        toUpdate++;

      operations.push({
        type: op.type,
        displayName: this.getDisplayName(op),
        size: this.estimateSize(op),
      });
    }

    return {
      toAdd,
      toRemove,
      existing: 0, // Not available from plan alone
      toUpdate,
      operationCounts,
      estimatedSize: plan.estimatedSize,
      estimatedTime: plan.estimatedTime,
      warnings: plan.warnings.map((w) => w.message),
      operations,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a MusicHandler instance
 */
export function createMusicHandler(): MusicHandler {
  return new MusicHandler();
}
