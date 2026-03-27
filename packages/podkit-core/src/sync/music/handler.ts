/**
 * MusicHandler — ContentTypeHandler implementation for music tracks
 *
 * Thin wrapper that delegates to the Classifier + Factory + Config pattern
 * for routing decisions, and to existing music sync functions for matching,
 * diffing, and execution.
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceAdapter, DeviceTrack } from '../../device/adapter.js';
import { isMusicMediaType } from '../../ipod/constants.js';
import { applyTransforms } from '../../transforms/pipeline.js';
import { getMatchKey, getTransformMatchKeys } from '../../metadata/matching.js';
import {
  detectUpgrades,
  getIpodFormatFamily,
  isFileReplacementUpgrade,
  isSourceLossless,
  metadataValuesDiffer,
  detectPresetChange,
} from '../engine/upgrades.js';
import { calculateMusicOperationSize, categorizeSource, isLosslessSource } from './planner.js';
import { MusicPipeline, getMusicOperationDisplayName } from './pipeline.js';
import { estimateTransferTime } from '../engine/estimation.js';
import {
  buildAudioSyncTag,
  syncTagMatchesConfig,
  syncTagsEqual,
} from '../../metadata/sync-tags.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type {
  MetadataChange,
  SyncPlan,
  SyncWarning,
  ExecutorProgress,
  UpdateReason,
  UpgradeReason,
} from '../engine/types.js';
import type { MusicOperation } from './types.js';
import type {
  ContentTypeHandler,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
  MatchInfo,
  UnifiedSyncDiff,
} from '../engine/content-type.js';
import { partitionExisting, sweepAllExisting, formatDryRunFromPlan } from '../engine/diff-utils.js';
import type { MusicSyncConfig, ResolvedMusicConfig } from './config.js';
import { resolveMusicConfig } from './config.js';
import { MusicTrackClassifier, classifierFromConfig } from './classifier.js';
import { MusicOperationFactory } from './operation-factory.js';

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
 * Takes a `MusicSyncConfig` at construction and derives all internal state
 * up front via the Classifier + Factory + Config pattern.
 */
export class MusicHandler implements ContentTypeHandler<
  CollectionTrack,
  DeviceTrack,
  MusicOperation
> {
  readonly type = 'music';

  private readonly config: ResolvedMusicConfig;
  private readonly classifier: MusicTrackClassifier;
  private readonly factory: MusicOperationFactory;

  constructor(config: MusicSyncConfig) {
    this.config = resolveMusicConfig(config);
    this.classifier = new MusicTrackClassifier(classifierFromConfig(this.config));
    this.factory = new MusicOperationFactory();
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
    const keys = getTransformMatchKeys(source, this.config.raw.transforms);
    return keys.transformedKey;
  }

  getDeviceItemId(device: DeviceTrack): string {
    // DeviceTrack's filePath is unique per track on the device
    return device.filePath;
  }

  transformSourceForAdd(source: CollectionTrack): CollectionTrack {
    if (!this.config.transformsEnabled) {
      return source;
    }

    const result = applyTransforms(source, this.config.raw.transforms);
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
    matchInfo?: MatchInfo
  ): UpdateReason[] {
    // Transform detection (when matchInfo available)
    if (matchInfo) {
      const hasTransform = this.generateMatchKey(source) !== this.applyTransformKey(source);
      if (hasTransform) {
        if (!matchInfo.matchedByTransformKey && this.config.transformsEnabled) {
          // iPod has original metadata, transforms are enabled -> apply
          return ['transform-apply'];
        }
        if (matchInfo.matchedByTransformKey && !this.config.transformsEnabled) {
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
    if (reasons.includes('format-upgrade')) {
      const ipodFamily = getIpodFormatFamily(device);
      if (ipodFamily === 'aac') {
        reasons = reasons.filter((r) => r !== 'format-upgrade');
      }
    }

    // When forceTranscode is on and source is lossless, ensure file-replacement
    if (this.config.raw.forceTranscode) {
      const category = categorizeSource(source);
      if (
        isLosslessSource(category) &&
        !reasons.some((r) => isFileReplacementUpgrade(r as UpgradeReason))
      ) {
        reasons.unshift('force-transcode');
      }
    }

    // When skipUpgrades is set, filter out file-replacement upgrades
    if (this.config.raw.skipUpgrades) {
      reasons = reasons.filter((r) => !isFileReplacementUpgrade(r as UpgradeReason));
    }

    return reasons;
  }

  // ---- Post-processing ----

  postProcessDiff(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    // Pass 0: Populate changes for transform and upgrade updates from detectUpdates
    this.postProcessBuildChanges(diff);

    // Pass 1: Preset change detection
    this.postProcessPresetChanges(diff);

    // Pass 2: Force transcode sweep
    this.postProcessForceTranscode(diff);

    // Pass 3: Transfer mode mismatch detection
    this.postProcessTransferMode(diff);

    // Pass 4: Sync tag writing
    this.postProcessSyncTags(diff);

    // Pass 5: Force metadata rewrite
    this.postProcessForceMetadata(diff);
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
   * Otherwise, when presetBitrate is provided, check bitrate.
   * Tracks with a mismatch are moved from existing -> toUpdate.
   *
   * Sync tag priority: if a track has a sync tag, use exact comparison against
   * the current config. If no sync tag, fall back to bitrate tolerance detection.
   */
  private postProcessPresetChanges(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    const shouldCheckPreset =
      !(this.config.raw.skipUpgrades ?? false) &&
      (this.config.isAlacPreset || this.config.presetBitrate);

    if (!shouldCheckPreset) return;

    const presetBitrate = this.config.presetBitrate ?? 0;
    const presetChangeOptions = {
      encodingMode: this.config.raw.encoding,
      bitrateTolerance: this.config.raw.bitrateTolerance,
      isAlacPreset: this.config.isAlacPreset,
    };

    // Build expected sync tag from current config (for sync tag comparison)
    const resolvedQuality = this.config.resolvedQuality;
    const expectedSyncTag = resolvedQuality
      ? buildAudioSyncTag(resolvedQuality, this.config.raw.encoding, this.config.raw.customBitrate)
      : undefined;

    partitionExisting(diff, (match) => {
      // Only check lossless-source tracks (lossy are copied as-is)
      if (!isSourceLossless(match.source)) return null;

      // Try sync tag comparison first
      const syncTag = match.device.syncTag;
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
        presetChange = detectPresetChange(
          match.source,
          match.device,
          presetBitrate,
          presetChangeOptions
        );
      }

      if (!presetChange) return null;

      const changes: MetadataChange[] = this.config.isAlacPreset
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

      return { reasons: [presetChange], changes };
    });
  }

  /**
   * Pass 2: Force re-transcoding of all lossless-source tracks.
   * Only lossless sources are affected — compatible lossy (MP3, AAC) are always
   * copied as-is and re-encoding them would only degrade quality.
   */
  private postProcessForceTranscode(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!this.config.raw.forceTranscode) return;

    partitionExisting(diff, (match) => {
      if (!isSourceLossless(match.source)) return null;
      return {
        reasons: ['force-transcode'],
        changes: [
          { field: 'bitrate', from: String(match.device.bitrate ?? 'unknown'), to: 'forced' },
        ],
      };
    });
  }

  /**
   * Pass 3: Force re-processing when transfer mode changed.
   * Affects ALL tracks (including copy-format), unlike forceTranscode which only
   * affects lossless-source tracks.
   *
   * Two cases:
   * 1. Transfer mode is missing from sync tag (legacy tracks) — if the effective
   *    mode is 'fast' (the legacy default behavior), this is metadata-only (stamp
   *    the tag). If the effective mode is different, the file needs re-processing.
   * 2. Transfer mode is present but differs — file replacement needed.
   */
  private postProcessTransferMode(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!(this.config.raw.forceTransferMode && this.config.transferMode)) return;

    const targetTransferMode = this.config.transferMode;

    partitionExisting(diff, (match) => {
      const syncTag = match.device.syncTag;
      const tagTransferMode = syncTag?.transferMode;

      if (tagTransferMode === targetTransferMode) {
        return null;
      } else if (!syncTag) {
        // No sync tag at all — can't stamp transfer mode. Treat as existing.
        return null;
      } else if (tagTransferMode === undefined && targetTransferMode === 'fast') {
        // Missing transfer mode + effective is 'fast': the file was already
        // transferred with fast behavior (the only behavior before transfer modes).
        // Just stamp the sync tag — no file re-transfer needed.
        const updatedTag: SyncTagData = { ...syncTag, transferMode: targetTransferMode };
        return { reasons: ['sync-tag-write'], changes: [], syncTag: updatedTag };
      } else {
        // Transfer mode actually changed (or missing + effective is not 'fast')
        // — file needs re-processing.
        return {
          reasons: ['transfer-mode-changed'],
          changes: [
            { field: 'transferMode', from: tagTransferMode ?? 'none', to: targetTransferMode },
          ],
        };
      }
    });
  }

  /**
   * Pass 4 (formerly Pass 3): Write sync tags to lossless-source tracks that are missing
   * or have outdated tags. This is metadata-only — no file replacement.
   *
   * When checkArtwork is active (source tracks have artworkHash), this also processes
   * lossy/copied sources that have artwork but no art= hash in their sync tag.
   * This establishes the artwork hash baseline so --check-artwork can detect future changes.
   * The baseline assumes the iPod artwork currently matches the source, which is the
   * expected state for a freshly synced collection.
   */
  private postProcessSyncTags(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!(this.config.raw.forceSyncTags && this.config.resolvedQuality)) return;

    const baseExpectedTag = buildAudioSyncTag(
      this.config.resolvedQuality,
      this.config.raw.encoding,
      this.config.raw.customBitrate
    );

    partitionExisting(diff, (match) => {
      const sourceLossless = isSourceLossless(match.source);

      // For lossy (copied) sources, only process when the source has an artwork hash
      // and the iPod track is missing the art= baseline in its sync tag.
      // This ensures --force-sync-tags --check-artwork establishes baselines for ALL tracks.
      if (!sourceLossless) {
        if (match.source.artworkHash) {
          const currentTag = match.device.syncTag;
          if (!currentTag?.artworkHash || currentTag.artworkHash !== match.source.artworkHash) {
            // Build a minimal "copy" sync tag with just the artwork hash
            const copyTag: SyncTagData = {
              quality: 'copy',
              artworkHash: match.source.artworkHash,
            };
            // If there's an existing tag, preserve its fields but update the artwork hash
            const expectedTag: SyncTagData = currentTag
              ? { ...currentTag, artworkHash: match.source.artworkHash }
              : copyTag;
            return { reasons: ['sync-tag-write'], changes: [], syncTag: expectedTag };
          }
        }
        return null;
      }

      // Include artwork hash in the expected tag when available (--check-artwork active).
      // This establishes the baseline by writing the source's artwork hash — it assumes
      // the iPod artwork currently matches the source, which is the expected state for
      // a freshly synced collection.
      const expectedTag = { ...baseExpectedTag };
      if (match.source.artworkHash) {
        expectedTag.artworkHash = match.source.artworkHash;
      }

      // Structural comparison — rewrite if any field differs,
      // even if the semantic meaning is equivalent (e.g., missing encoding=vbr).
      // This ensures all tags are complete and consistent.
      const currentTag = match.device.syncTag;
      if (currentTag && syncTagsEqual(currentTag, expectedTag)) {
        return null;
      }

      return { reasons: ['sync-tag-write'], changes: [], syncTag: expectedTag };
    });
  }

  /**
   * Pass 5: Force-metadata moves ALL remaining existing tracks to toUpdate.
   * This rewrites metadata on every matched track without re-transcoding or re-transferring.
   */
  private postProcessForceMetadata(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!this.config.raw.forceMetadata) return;

    sweepAllExisting(diff, 'force-metadata', (match) => {
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

      return { changes };
    });
  }

  // ---- Planning ----

  planAdd(source: CollectionTrack): MusicOperation {
    const { action } = this.classifier.classify(source);
    return this.factory.createAdd(source, action);
  }

  planRemove(device: DeviceTrack): MusicOperation {
    return this.factory.createRemove(device);
  }

  planUpdate(
    source: CollectionTrack,
    device: DeviceTrack,
    reasons: UpdateReason[],
    changes?: MetadataChange[],
    syncTag?: SyncTagData
  ): MusicOperation[] {
    if (reasons.length === 0) return [];

    // Handle sync-tag-write: create update-sync-tag operation
    const ops: MusicOperation[] = [];
    const nonSyncTagReasons = reasons.filter((r) => r !== 'sync-tag-write');

    if (reasons.includes('sync-tag-write') && syncTag) {
      ops.push(this.factory.createSyncTagUpdate(device, syncTag));
    }

    if (nonSyncTagReasons.length === 0) return ops;

    const primaryReason = nonSyncTagReasons[0]!;

    // artwork-updated and artwork-removed need source file access for artwork re-extraction
    // or removal, but don't replace the audio file — route as upgrade-artwork
    if (primaryReason === 'artwork-updated' || primaryReason === 'artwork-removed') {
      ops.push(this.factory.createArtworkUpgrade(source, device, primaryReason as UpgradeReason));
      return ops;
    }

    // File-replacement upgrades
    if (isFileReplacementUpgrade(primaryReason as UpgradeReason)) {
      const { action } = this.classifier.classify(source);
      ops.push(this.factory.createUpgrade(source, device, primaryReason as UpgradeReason, action));
      return ops;
    }

    // Metadata-only updates — populate metadata from changes
    ops.push(this.factory.createMetadataUpdate(device, changes ?? []));
    return ops;
  }

  estimateSize(op: MusicOperation): number {
    return calculateMusicOperationSize(op);
  }

  estimateTime(op: MusicOperation): number {
    const size = calculateMusicOperationSize(op);
    if (op.type === 'remove') return 0.1;
    if (op.type === 'update-metadata' || op.type === 'update-sync-tag') return 0.01;
    return estimateTransferTime(size);
  }

  collectPlanWarnings(operations: MusicOperation[]): SyncWarning[] {
    const warnings: SyncWarning[] = [];
    const lossyToLossyTracks: CollectionTrack[] = [];

    for (const op of operations) {
      if (op.type === 'add-transcode' || op.type === 'upgrade-transcode') {
        const { warnLossyToLossy } = this.classifier.classify(op.source as CollectionTrack);
        if (warnLossyToLossy) {
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
      this.config.primaryArtworkSource === 'embedded' &&
      this.config.transferMode === 'portable' &&
      this.config.artworkResize &&
      operations.length > 0
    ) {
      warnings.push({
        type: 'embedded-artwork-resize',
        message: `Artwork resized to device maximum (${this.config.artworkResize}px) — this device reads artwork from embedded file data and cannot use full-resolution images. Portable mode preserves audio quality but artwork is optimized for the device.`,
        tracks: [],
      });
    }

    return warnings;
  }

  // ---- Priority ----

  /**
   * Get the execution priority for a sync operation.
   * Lower numbers execute first. Used by the engine for ordering.
   */
  getOperationPriority(op: MusicOperation): number {
    switch (op.type) {
      case 'remove':
        return 0;
      case 'update-metadata':
      case 'update-sync-tag':
        return 1;
      case 'add-direct-copy':
      case 'add-optimized-copy':
        return 2;
      case 'upgrade-transcode':
      case 'upgrade-direct-copy':
      case 'upgrade-optimized-copy':
      case 'upgrade-artwork':
        return 3;
      case 'add-transcode':
        return 4;
      default:
        return 5;
    }
  }

  // ---- Execution ----

  async *execute(
    op: MusicOperation,
    _ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<MusicOperation>> {
    // Stub — real execution stays in MusicPipeline for now
    yield { operation: op, phase: 'starting' };
    yield { operation: op, phase: 'complete' };
  }

  async *executeBatch(
    operations: MusicOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<MusicOperation>> {
    const transcoder = this.config.raw.transcoder;

    // Wrap operations in a SyncPlan for MusicPipeline
    const plan: SyncPlan<MusicOperation> = {
      operations,
      estimatedSize: operations.reduce((sum, op) => sum + this.estimateSize(op), 0),
      estimatedTime: operations.reduce((sum, op) => sum + this.estimateTime(op), 0),
      warnings: [],
    };

    // Create the 3-stage pipeline executor.
    const executor = new MusicPipeline({ device: ctx.device, transcoder });

    // Execute and bridge events
    for await (const progress of executor.execute(plan, {
      dryRun: ctx.dryRun,
      signal: ctx.signal,
      tempDir: ctx.tempDir,
      artwork: this.config.raw.artwork,
      adapter: this.config.raw.adapter,
      syncTagConfig: {
        encodingMode: this.config.raw.encoding,
        customBitrate: this.config.raw.customBitrate,
      },
      continueOnError: this.config.raw.continueOnError,
      retryConfig: this.config.raw.retryConfig,
      transferMode: this.config.transferMode,
      artworkResize: this.config.artworkResize,
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
   * Bridge an ExecutorProgress event from MusicPipeline to an OperationProgress event.
   *
   * MusicPipeline yields one event per completed/failed/skipped operation
   * (plus batch-level 'updating-db' and 'complete' which are filtered before this).
   */
  private bridgeProgress(progress: ExecutorProgress): OperationProgress<MusicOperation> {
    let phase: OperationProgress<MusicOperation>['phase'];

    if (progress.error) {
      phase = 'failed';
    } else if (progress.skipped) {
      phase = 'complete';
    } else {
      // Successful operation completion (transcoding, copying, removing, etc.)
      phase = 'complete';
    }

    return {
      operation: progress.operation as MusicOperation,
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

  getDisplayName(op: MusicOperation): string {
    return getMusicOperationDisplayName(op);
  }

  formatDryRun(plan: SyncPlan<MusicOperation>): DryRunSummary {
    return formatDryRunFromPlan(
      plan,
      (type) => {
        if (type === 'add-transcode' || type === 'add-direct-copy' || type === 'add-optimized-copy')
          return 'add';
        if (type === 'remove') return 'remove';
        if (
          type === 'update-metadata' ||
          type === 'update-sync-tag' ||
          type === 'upgrade-transcode' ||
          type === 'upgrade-direct-copy' ||
          type === 'upgrade-optimized-copy' ||
          type === 'upgrade-artwork'
        )
          return 'update';
        return null;
      },
      (op) => this.getDisplayName(op),
      (op) => this.estimateSize(op)
    );
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a MusicHandler instance
 */
export function createMusicHandler(config: MusicSyncConfig): MusicHandler {
  return new MusicHandler(config);
}
