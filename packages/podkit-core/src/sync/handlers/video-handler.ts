/**
 * VideoHandler — ContentTypeHandler implementation for video content
 *
 * Implements video sync operations including transcoding with progress
 * reporting, file copy, removal, metadata updates, and upgrades.
 *
 * @module
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, rm } from '../video-executor-fs.js';

import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { DeviceAdapter, DeviceTrack, DeviceTrackInput } from '../../device/adapter.js';
import { isVideoMediaType, createVideoTrackInput } from '../../ipod/video.js';
import { transcodeVideo } from '../../video/transcode.js';
import { probeVideo } from '../../video/probe.js';
import { generateVideoMatchKey, type IPodVideo } from '../video-differ.js';
import { calculateVideoOperationSize, calculateVideoOperationTime } from '../video-planner.js';
import { getVideoOperationDisplayName } from '../video-executor.js';
import { buildVideoSyncTag, syncTagMatchesConfig } from '../sync-tags.js';
import { detectBitratePresetMismatch } from '../upgrades.js';
import type { SyncOperation, SyncPlan, UpdateReason, UpgradeReason } from '../types.js';
import type { TranscodeProgress } from '../../transcode/types.js';
import type { VideoTransformsConfig } from '../../transforms/types.js';
import {
  getVideoTransformMatchKeys,
  hasEnabledVideoTransforms,
} from '../../transforms/video-pipeline.js';
import type {
  ContentTypeHandler,
  HandlerDiffOptions,
  HandlerPlanOptions,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
} from '../content-type.js';
import type { UnifiedSyncDiff } from '../content-type.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Video-specific options for postProcessDiff.
 *
 * Passed via the `handlerOptions` field on the diff options object
 * when the caller needs video-specific post-processing (preset change
 * detection, force-metadata sweep).
 */
export interface VideoHandlerDiffOptions {
  /** Resolved video quality preset name for sync tag comparison */
  resolvedVideoQuality?: string;
  /** Video transform configuration */
  videoTransforms?: VideoTransformsConfig;
}

// =============================================================================
// VideoHandler Implementation
// =============================================================================

/**
 * ContentTypeHandler implementation for video content.
 *
 * Delegates to existing video sync functions from video-differ.ts,
 * video-planner.ts, and video-executor.ts.
 */
export class VideoHandler implements ContentTypeHandler<CollectionVideo, IPodVideo> {
  readonly type = 'video';

  /** Stored video transforms config (set via setVideoTransformsConfig) */
  private videoTransformsConfig?: VideoTransformsConfig;

  /**
   * Set the video transforms configuration for transform-aware matching.
   * When set, applyTransformKey generates transformed keys and detectUpdates
   * detects transform apply/remove scenarios.
   */
  setVideoTransformsConfig(config: VideoTransformsConfig | undefined): void {
    this.videoTransformsConfig = config;
  }

  // ---- Diffing ----

  generateMatchKey(source: CollectionVideo): string {
    return generateVideoMatchKey(source);
  }

  generateDeviceMatchKey(device: IPodVideo): string {
    return generateVideoMatchKey(device);
  }

  applyTransformKey(source: CollectionVideo): string {
    if (!this.videoTransformsConfig) {
      return generateVideoMatchKey(source);
    }

    const { transformedKey } = getVideoTransformMatchKeys(
      source,
      generateVideoMatchKey,
      this.videoTransformsConfig
    );
    return transformedKey;
  }

  /**
   * Transform a source video for add operations.
   *
   * When transforms are enabled and the video is a TV show, returns a copy
   * with the transformed series title. Returns the original source unchanged
   * if no transform applies.
   */
  transformSourceForAdd(source: CollectionVideo): CollectionVideo {
    const transformedTitle = this.getTransformedSeriesTitle(source);
    if (!transformedTitle) return source;
    return { ...source, seriesTitle: transformedTitle };
  }

  /**
   * Get the transformed series title for a video, or undefined if no transform applies.
   * @internal
   */
  private getTransformedSeriesTitle(source: CollectionVideo): string | undefined {
    if (!this.videoTransformsConfig) return undefined;
    if (!hasEnabledVideoTransforms(this.videoTransformsConfig)) return undefined;
    if (source.contentType !== 'tvshow') return undefined;

    const { transformedSeriesTitle, transformApplied } = getVideoTransformMatchKeys(
      source,
      generateVideoMatchKey,
      this.videoTransformsConfig
    );

    return transformApplied ? transformedSeriesTitle : undefined;
  }

  getDeviceItemId(device: IPodVideo): string {
    return device.id;
  }

  detectUpdates(
    source: CollectionVideo,
    device: IPodVideo,
    _options: HandlerDiffOptions
  ): UpdateReason[] {
    const reasons: UpdateReason[] = [];

    // Detect numeric metadata corrections (same logic as video-differ.ts)
    const hasMetadataCorrection =
      (source.seasonNumber !== undefined &&
        device.seasonNumber !== undefined &&
        source.seasonNumber !== device.seasonNumber) ||
      (source.episodeNumber !== undefined &&
        device.episodeNumber !== undefined &&
        source.episodeNumber !== device.episodeNumber) ||
      (source.year !== undefined && device.year !== undefined && source.year !== device.year);

    if (hasMetadataCorrection) {
      reasons.push('metadata-correction');
    }

    // Transform detection: determine if transforms need to be applied or removed.
    // The unified differ matches by primary key first, then falls back to transform key.
    // We can detect the match type by comparing the primary and transform keys.
    if (this.videoTransformsConfig) {
      const transformsEnabled = hasEnabledVideoTransforms(this.videoTransformsConfig);
      const { originalKey, transformedKey, transformApplied } = getVideoTransformMatchKeys(
        source,
        generateVideoMatchKey,
        this.videoTransformsConfig
      );

      if (transformApplied) {
        // Check which key the device item matches
        const deviceKey = generateVideoMatchKey(device);
        const matchedByOriginalKey = deviceKey === originalKey;
        const matchedByTransformKey = deviceKey === transformedKey;

        if (matchedByOriginalKey && transformsEnabled) {
          // iPod has original metadata, transforms are enabled → apply transform
          reasons.push('transform-apply');
        } else if (matchedByTransformKey && !transformsEnabled) {
          // iPod has transformed metadata, transforms are disabled → revert
          reasons.push('transform-remove');
        }
      }
    }

    return reasons;
  }

  /**
   * Post-process a unified diff to detect preset changes and force-metadata sweeps.
   *
   * This method handles two passes over the diff's `existing` array:
   *
   * 1. **Preset change detection** — When `options.presetBitrate` is set, checks each
   *    existing video against sync tags and/or bitrate comparison. Mismatches are
   *    moved from `existing` to `toUpdate` with reason `'preset-upgrade'` or `'preset-downgrade'`.
   *
   * 2. **Force metadata sweep** — When `options.forceMetadata` is true, moves ALL
   *    remaining `existing` items to `toUpdate` with reason `'force-metadata'`.
   *    For TV shows, computes the effective series title (with transforms if configured).
   *
   * @param diff - The unified diff to post-process (mutated in place)
   * @param options - Diff options including presetBitrate and forceMetadata
   */
  postProcessDiff(
    diff: UnifiedSyncDiff<CollectionVideo, IPodVideo>,
    options: HandlerDiffOptions & {
      forceMetadata?: boolean;
      handlerOptions?: VideoHandlerDiffOptions;
    }
  ): void {
    const handlerOpts = options.handlerOptions;

    // Pass 1: Preset change detection
    if (options.presetBitrate) {
      const presetBitrate = options.presetBitrate;
      const resolvedVideoQuality = handlerOpts?.resolvedVideoQuality;
      const expectedSyncTag = resolvedVideoQuality
        ? buildVideoSyncTag(resolvedVideoQuality)
        : undefined;
      const stillExisting: Array<{ source: CollectionVideo; device: IPodVideo }> = [];

      for (const match of diff.existing) {
        // Try sync tag comparison first
        const syncTag = match.device.syncTag ?? null;
        let mismatch = false;

        if (syncTag && expectedSyncTag) {
          // Sync tag exists — use exact comparison
          mismatch = !syncTagMatchesConfig(syncTag, expectedSyncTag);
        } else {
          // No sync tag — fall back to bitrate comparison
          mismatch = detectBitratePresetMismatch(match.device.bitrate, presetBitrate) !== null;
        }

        if (mismatch) {
          // Determine direction from bitrate comparison (default to upgrade)
          const direction =
            detectBitratePresetMismatch(match.device.bitrate, presetBitrate) ?? 'preset-upgrade';
          diff.toUpdate.push({
            source: match.source,
            device: match.device,
            reasons: [direction],
          });
        } else {
          stillExisting.push(match);
        }
      }

      diff.existing.length = 0;
      diff.existing.push(...stillExisting);
    }

    // Pass 2: Force metadata sweep — move ALL remaining existing items to toUpdate.
    // The effective series title (with transforms if configured) is computed
    // downstream by planUpdate via transformSourceForAdd / videoTransformsConfig.
    if (options.forceMetadata) {
      for (const match of diff.existing) {
        diff.toUpdate.push({
          source: match.source,
          device: match.device,
          reasons: ['force-metadata'],
        });
      }

      diff.existing.length = 0;
    }
  }

  // ---- Planning ----

  planAdd(source: CollectionVideo, _options: HandlerPlanOptions): SyncOperation {
    // Default to video-transcode; the actual planner determines passthrough vs transcode
    // based on compatibility checking. This stub provides a reasonable default.
    const transformedSeriesTitle = this.getTransformedSeriesTitle(source);

    return {
      type: 'video-transcode',
      source,
      settings: {
        targetVideoBitrate: 1500,
        targetAudioBitrate: 128,
        targetWidth: 640,
        targetHeight: 480,
        videoProfile: 'baseline',
        videoLevel: '3.0',
        crf: 23,
        frameRate: 30,
        useHardwareAcceleration: _options.hardwareAcceleration ?? true,
      },
      ...(transformedSeriesTitle && { transformedSeriesTitle }),
    };
  }

  planRemove(device: IPodVideo): SyncOperation {
    return { type: 'video-remove', video: device };
  }

  planUpdate(
    source: CollectionVideo,
    device: IPodVideo,
    reasons: UpdateReason[],
    _options?: HandlerPlanOptions,
    _changes?: import('../types.js').MetadataChange[]
  ): SyncOperation[] {
    if (reasons.length === 0) return [];

    const primaryReason = reasons[0]!;

    // Preset changes require re-transcoding via upgrade
    if (primaryReason === 'preset-upgrade' || primaryReason === 'preset-downgrade') {
      return [
        {
          type: 'video-upgrade',
          source,
          target: device,
          reason: primaryReason as UpgradeReason,
        },
      ];
    }

    // Transform and force-metadata updates need the effective series title
    if (
      primaryReason === 'transform-apply' ||
      primaryReason === 'transform-remove' ||
      primaryReason === 'force-metadata' ||
      primaryReason === 'metadata-correction'
    ) {
      // Compute the new series title for transform-aware metadata updates
      let newSeriesTitle: string | undefined;

      if (source.contentType === 'tvshow') {
        if (primaryReason === 'transform-apply' || primaryReason === 'force-metadata') {
          newSeriesTitle = this.getTransformedSeriesTitle(source) ?? source.seriesTitle;
        } else if (primaryReason === 'transform-remove') {
          newSeriesTitle = source.seriesTitle;
        }
      }

      return [
        {
          type: 'video-update-metadata',
          source,
          video: device,
          newSeriesTitle,
        },
      ];
    }

    // Metadata-only updates (fallback)
    return [
      {
        type: 'video-update-metadata',
        source,
        video: device,
      },
    ];
  }

  estimateSize(op: SyncOperation): number {
    if (
      op.type === 'video-transcode' ||
      op.type === 'video-copy' ||
      op.type === 'video-remove' ||
      op.type === 'video-update-metadata' ||
      op.type === 'video-upgrade'
    ) {
      return calculateVideoOperationSize(op);
    }
    return 0;
  }

  estimateTime(op: SyncOperation): number {
    if (
      op.type === 'video-transcode' ||
      op.type === 'video-copy' ||
      op.type === 'video-remove' ||
      op.type === 'video-update-metadata' ||
      op.type === 'video-upgrade'
    ) {
      return calculateVideoOperationTime(op);
    }
    return 0;
  }

  // ---- Execution ----

  /** Video quality preset for sync tag writing (set via setVideoQuality) */
  private videoQuality?: string;

  /**
   * Set the video quality preset name for sync tag writing.
   * When set, sync tags are written to transcoded video tracks.
   */
  setVideoQuality(quality: string | undefined): void {
    this.videoQuality = quality;
  }

  async *execute(op: SyncOperation, ctx: ExecutionContext): AsyncGenerator<OperationProgress> {
    switch (op.type) {
      case 'video-transcode':
        yield* this.executeTranscode(op, ctx);
        break;
      case 'video-copy':
        yield* this.executeCopy(op, ctx);
        break;
      case 'video-remove':
        yield* this.executeRemove(op, ctx);
        break;
      case 'video-update-metadata':
        yield* this.executeUpdateMetadata(op, ctx);
        break;
      case 'video-upgrade':
        yield* this.executeUpgrade(op, ctx);
        break;
      default:
        yield { operation: op, phase: 'starting' };
        yield { operation: op, phase: 'complete' };
    }
  }

  async *executeBatch(
    operations: SyncOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    // Create a shared temp directory for all transcodes in this batch
    const tempDir = ctx.tempDir ?? tmpdir();
    const transcodeDir = join(tempDir, `podkit-video-${randomUUID()}`);
    const hasTranscodes = operations.some(
      (op) => op.type === 'video-transcode' || (op.type === 'video-upgrade' && op.settings)
    );

    if (hasTranscodes && !ctx.dryRun) {
      await mkdir(transcodeDir, { recursive: true });
    }

    try {
      for (const op of operations) {
        // Use a context with the shared transcode dir
        const batchCtx: ExecutionContext = { ...ctx, tempDir: transcodeDir };
        yield* this.execute(op, batchCtx);
      }
    } finally {
      if (hasTranscodes && !ctx.dryRun) {
        try {
          await rm(transcodeDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  // ---- Private execution helpers ----

  /**
   * Execute a video transcode operation with progress reporting.
   *
   * Uses an async queue pattern to bridge the onProgress callback
   * from transcodeVideo() into the async generator yield pattern.
   */
  private async *executeTranscode(
    op: Extract<SyncOperation, { type: 'video-transcode' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    const { source, settings } = op;

    yield { operation: op, phase: 'starting' };

    // Set up temp directory for output
    const tempDir = ctx.tempDir ?? tmpdir();
    const outputFilename = `${randomUUID()}.m4v`;
    const tempOutputPath = join(tempDir, outputFilename);

    // Async queue for bridging onProgress callback → yield
    const progressQueue: Array<{ percent: number; speed?: number }> = [];
    let resolveWaiter: (() => void) | null = null;
    let transcodeComplete = false;
    let transcodeError: Error | undefined;

    const transcodePromise = transcodeVideo(source.filePath, tempOutputPath, settings, {
      signal: ctx.signal,
      onProgress: (p: TranscodeProgress) => {
        progressQueue.push({
          percent: p.percent,
          speed: p.speed,
        });
        resolveWaiter?.();
      },
    });

    transcodePromise
      .then(() => {
        transcodeComplete = true;
        resolveWaiter?.();
      })
      .catch((err) => {
        transcodeError = err instanceof Error ? err : new Error(String(err));
        transcodeComplete = true;
        resolveWaiter?.();
      });

    // Yield progress events as they arrive
    while (!transcodeComplete) {
      if (progressQueue.length === 0) {
        await new Promise<void>((r) => {
          resolveWaiter = r;
        });
      }
      while (progressQueue.length > 0) {
        const p = progressQueue.shift()!;
        yield {
          operation: op,
          phase: 'in-progress',
          progress: p.percent / 100,
          transcodeProgress: { percent: p.percent, speed: p.speed },
        };
      }
    }

    // Check for errors
    if (transcodeError) {
      throw transcodeError;
    }

    // Ensure promise is fully resolved
    await transcodePromise;

    // Get transcoded file size and probe for metadata
    const outputStats = await stat(tempOutputPath);
    const analysis = await probeVideo(source.filePath);
    const outputAnalysis = await probeVideo(tempOutputPath);

    // Create track input for iPod database
    const trackInput = createVideoTrackInput(source, analysis, {
      size: outputStats.size,
      bitrate: outputAnalysis.videoBitrate + outputAnalysis.audioBitrate,
    });

    // Apply transformed series title if set
    if (op.transformedSeriesTitle) {
      trackInput.artist = op.transformedSeriesTitle;
      trackInput.tvShow = op.transformedSeriesTitle;
      if (trackInput.album && source.contentType === 'tvshow') {
        trackInput.album = `${op.transformedSeriesTitle}, Season ${source.seasonNumber ?? 1}`;
      }
    }

    // Write sync tag if quality preset is configured
    const deviceTrackInput: DeviceTrackInput = trackInput;
    if (this.videoQuality) {
      const syncTag = buildVideoSyncTag(this.videoQuality);
      deviceTrackInput.syncTag = syncTag;
    }

    // Add track to device and copy file
    const track = ctx.device.addTrack(deviceTrackInput);
    ctx.device.copyTrackFile(track, tempOutputPath);

    yield { operation: op, phase: 'complete' };
  }

  /**
   * Execute a video copy (passthrough) operation.
   */
  private async *executeCopy(
    op: Extract<SyncOperation, { type: 'video-copy' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    const { source } = op;

    yield { operation: op, phase: 'starting' };

    // Get file stats and probe metadata
    const fileStats = await stat(source.filePath);
    const analysis = await probeVideo(source.filePath);

    // Create track input
    const trackInput = createVideoTrackInput(source, analysis, {
      size: fileStats.size,
    });

    // Apply transformed series title if set
    if (op.transformedSeriesTitle) {
      trackInput.artist = op.transformedSeriesTitle;
      trackInput.tvShow = op.transformedSeriesTitle;
      if (trackInput.album && source.contentType === 'tvshow') {
        trackInput.album = `${op.transformedSeriesTitle}, Season ${source.seasonNumber ?? 1}`;
      }
    }

    // Add track to device and copy file
    const track = ctx.device.addTrack(trackInput);
    ctx.device.copyTrackFile(track, source.filePath);

    yield { operation: op, phase: 'complete' };
  }

  /**
   * Execute a video remove operation.
   */
  private async *executeRemove(
    op: Extract<SyncOperation, { type: 'video-remove' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    const { video } = op;

    yield { operation: op, phase: 'starting' };

    const tracks = ctx.device.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.filePath === video.filePath || (t.title === video.title && t.tvShow === video.seriesTitle)
    );

    if (!foundTrack) {
      throw new Error(`Video track not found in database: ${video.title}`);
    }

    foundTrack.remove();

    yield { operation: op, phase: 'complete' };
  }

  /**
   * Execute a video metadata update operation.
   */
  private async *executeUpdateMetadata(
    op: Extract<SyncOperation, { type: 'video-update-metadata' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    const { video, source, newSeriesTitle } = op;

    yield { operation: op, phase: 'starting' };

    const tracks = ctx.device.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.filePath === video.filePath || (t.title === video.title && t.tvShow === video.seriesTitle)
    );

    if (!foundTrack) {
      throw new Error(`Video track not found in database: ${video.title}`);
    }

    if (source.contentType === 'tvshow') {
      const seriesTitle = newSeriesTitle ?? source.seriesTitle ?? source.title;
      const episodeTitle = source.title || formatVideoEpisodeTitle(source);

      ctx.device.updateTrack(foundTrack, {
        title: episodeTitle,
        artist: seriesTitle,
        album: `${seriesTitle}, Season ${source.seasonNumber ?? 1}`,
        tvShow: seriesTitle,
        tvEpisode: episodeTitle,
        trackNumber: source.episodeNumber,
        discNumber: source.seasonNumber,
      });
    } else if (source.contentType === 'movie') {
      ctx.device.updateTrack(foundTrack, {
        title: source.title,
        artist: source.director ?? source.studio,
        album: source.title,
      });
    } else if (newSeriesTitle !== undefined) {
      ctx.device.updateTrack(foundTrack, {
        artist: newSeriesTitle,
        album: `${newSeriesTitle}, Season ${video.seasonNumber ?? 1}`,
        tvShow: newSeriesTitle,
      });
    }

    yield { operation: op, phase: 'complete' };
  }

  /**
   * Execute a video upgrade operation (remove old + transcode/copy new).
   */
  private async *executeUpgrade(
    op: Extract<SyncOperation, { type: 'video-upgrade' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress> {
    const { source, target, settings } = op;

    yield { operation: op, phase: 'starting' };

    // Step 1: Remove the old iPod track
    const tracks = ctx.device.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.filePath === target.filePath ||
        (t.title === target.title && t.tvShow === target.seriesTitle)
    );

    if (foundTrack) {
      foundTrack.remove();
    }

    // Step 2: Transcode or copy the new source
    if (settings) {
      // Needs transcoding — delegate to executeTranscode
      const transcodeOp: Extract<SyncOperation, { type: 'video-transcode' }> = {
        type: 'video-transcode',
        source,
        settings,
      };

      for await (const progress of this.executeTranscode(transcodeOp, ctx)) {
        // Re-tag progress events with the upgrade operation
        yield { ...progress, operation: op };
      }
    } else {
      // Passthrough copy
      const copyOp: Extract<SyncOperation, { type: 'video-copy' }> = {
        type: 'video-copy',
        source,
      };

      for await (const progress of this.executeCopy(copyOp, ctx)) {
        yield { ...progress, operation: op };
      }
    }
  }

  // ---- Device ----

  getDeviceItems(device: DeviceAdapter): IPodVideo[] {
    const tracks = device.getTracks().filter((track) => isVideoMediaType(track.mediaType));

    // Map DeviceTrack to IPodVideo for video-specific operations
    return tracks.map((track) => deviceTrackToVideo(track));
  }

  // ---- Display ----

  getDisplayName(op: SyncOperation): string {
    return getVideoOperationDisplayName(op);
  }

  formatDryRun(plan: SyncPlan): DryRunSummary {
    const operationCounts: Record<string, number> = {};
    const operations: DryRunSummary['operations'] = [];
    let toAdd = 0;
    let toRemove = 0;
    let toUpdate = 0;

    for (const op of plan.operations) {
      operationCounts[op.type] = (operationCounts[op.type] ?? 0) + 1;

      if (op.type === 'video-transcode' || op.type === 'video-copy') toAdd++;
      else if (op.type === 'video-remove') toRemove++;
      else if (op.type === 'video-update-metadata' || op.type === 'video-upgrade') toUpdate++;

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
// Helpers
// =============================================================================

/**
 * Format episode title from video metadata
 */
function formatVideoEpisodeTitle(video: CollectionVideo): string {
  if (video.episodeId) {
    return video.episodeId;
  }
  if (video.seasonNumber !== undefined && video.episodeNumber !== undefined) {
    const ep = String(video.episodeNumber).padStart(2, '0');
    const season = String(video.seasonNumber).padStart(2, '0');
    return `S${season}E${ep}`;
  }
  return `Episode ${video.episodeNumber ?? 1}`;
}

/**
 * Convert a DeviceTrack (from the adapter) to an IPodVideo for video operations.
 *
 * Maps the track's metadata fields to the IPodVideo interface used by the
 * video differ and planner.
 */
function deviceTrackToVideo(track: DeviceTrack): IPodVideo {
  // Determine content type from media type flags
  const MediaType = { Movie: 0x0002, TVShow: 0x0040 };
  const contentType = (track.mediaType & MediaType.TVShow) !== 0 ? 'tvshow' : 'movie';

  return {
    id: track.filePath, // filePath is unique per track
    filePath: track.filePath,
    contentType: contentType as 'movie' | 'tvshow',
    title: track.title,
    year: track.year,
    seriesTitle: track.tvShow,
    seasonNumber: track.seasonNumber,
    episodeNumber: track.episodeNumber,
    duration: track.duration ? track.duration / 1000 : undefined, // ms to seconds
    bitrate: track.bitrate,
    comment: track.comment,
    syncTag: track.syncTag,
  };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a VideoHandler instance
 */
export function createVideoHandler(): VideoHandler {
  return new VideoHandler();
}
