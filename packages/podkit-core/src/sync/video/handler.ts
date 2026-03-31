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
import { mkdir, stat, rm } from './executor-fs.js';

import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { DeviceAdapter, DeviceTrack, DeviceTrackInput } from '../../device/adapter.js';
import { isVideoMediaType, createVideoTrackInput } from '../../ipod/video.js';
import { MediaType } from '../../ipod/constants.js';
import { transcodeVideo } from '../../video/transcode.js';
import { probeVideo } from '../../video/probe.js';
import { generateVideoMatchKey, type DeviceVideo, type VideoOperation } from './types.js';
import { calculateVideoOperationSize, calculateVideoOperationTime } from './planner.js';
import { getVideoOperationDisplayName } from './executor.js';
import { buildVideoSyncTag, syncTagMatchesConfig } from '../../metadata/sync-tags.js';
import { detectBitratePresetMismatch } from '../engine/upgrades.js';
import type { SyncPlan, UpdateReason, UpgradeReason } from '../engine/types.js';
import type { TranscodeProgress } from '../../transcode/types.js';
import {
  getVideoTransformMatchKeys,
  hasEnabledVideoTransforms,
} from '../../transforms/video-pipeline.js';
import type {
  ContentTypeHandler,
  CollisionCheckInput,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
} from '../engine/content-type.js';
import type { UnifiedSyncDiff } from '../engine/content-type.js';
import { partitionExisting, sweepAllExisting, formatDryRunFromPlan } from '../engine/diff-utils.js';
import type { VideoSyncConfig } from './config.js';
import { resolveVideoConfig, type ResolvedVideoConfig } from './config.js';
import { VideoTrackClassifier } from './classifier.js';

// =============================================================================
// VideoHandler Implementation
// =============================================================================

/**
 * ContentTypeHandler implementation for video content.
 *
 * Delegates to existing video sync functions from video-types.ts,
 * video-planner.ts, and video-executor.ts.
 */
export class VideoHandler implements ContentTypeHandler<
  CollectionVideo,
  DeviceVideo,
  VideoOperation
> {
  readonly type = 'video';

  /** Resolved configuration derived from the input VideoSyncConfig */
  private readonly config: ResolvedVideoConfig;

  /** Classifier for passthrough vs transcode decisions */
  private readonly classifier: VideoTrackClassifier;

  constructor(config?: VideoSyncConfig) {
    this.config = resolveVideoConfig(config);
    this.classifier = new VideoTrackClassifier(this.config);
  }

  // ---- Diffing ----

  generateMatchKey(source: CollectionVideo): string {
    return generateVideoMatchKey(source);
  }

  generateDeviceMatchKey(device: DeviceVideo): string {
    return generateVideoMatchKey(device);
  }

  applyTransformKey(source: CollectionVideo): string {
    const videoTransforms = this.config.raw.videoTransforms;
    if (!videoTransforms) {
      return generateVideoMatchKey(source);
    }

    const { transformedKey } = getVideoTransformMatchKeys(
      source,
      generateVideoMatchKey,
      videoTransforms
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
    const videoTransforms = this.config.raw.videoTransforms;
    if (!videoTransforms) return undefined;
    // Don't guard on hasEnabledVideoTransforms — when showLanguage is disabled,
    // the transform strips language markers (that IS the transform behavior).
    // The config existing means the user has configured transforms.
    if (!videoTransforms.showLanguage) return undefined;
    if (source.contentType !== 'tvshow') return undefined;

    const { transformedSeriesTitle } = getVideoTransformMatchKeys(
      source,
      generateVideoMatchKey,
      videoTransforms
    );

    // Return the transformed title if it differs from the original
    // (covers both enabled=true expansion AND enabled=false stripping)
    return transformedSeriesTitle !== source.seriesTitle ? transformedSeriesTitle : undefined;
  }

  getDeviceItemId(device: DeviceVideo): string {
    return device.id;
  }

  detectUpdates(source: CollectionVideo, device: DeviceVideo): UpdateReason[] {
    const reasons: UpdateReason[] = [];

    // Detect numeric metadata corrections (same logic as video-types.ts)
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
    const videoTransforms = this.config.raw.videoTransforms;
    if (videoTransforms) {
      const transformsEnabled = hasEnabledVideoTransforms(videoTransforms);
      const { originalKey, transformedKey, transformApplied } = getVideoTransformMatchKeys(
        source,
        generateVideoMatchKey,
        videoTransforms
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
   * 1. **Preset change detection** — When `this.config.presetBitrate` is set, checks each
   *    existing video against sync tags and/or bitrate comparison. Mismatches are
   *    moved from `existing` to `toUpdate` with reason `'preset-upgrade'` or `'preset-downgrade'`.
   *
   * 2. **Force metadata sweep** — When `this.config.raw.forceMetadata` is true, moves ALL
   *    remaining `existing` items to `toUpdate` with reason `'force-metadata'`.
   *    For TV shows, computes the effective series title (with transforms if configured).
   *
   * @param diff - The unified diff to post-process (mutated in place)
   * @param _options - Diff options (unused; config is read from this.config)
   */
  postProcessDiff(diff: UnifiedSyncDiff<CollectionVideo, DeviceVideo>): void {
    // Pass 1: Preset change detection
    if (this.config.presetBitrate) {
      const presetBitrate = this.config.presetBitrate;
      const expectedSyncTag = buildVideoSyncTag(this.config.videoQuality);

      partitionExisting(diff, (match) => {
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

        if (!mismatch) return null;

        // Determine direction from bitrate comparison (default to upgrade)
        const direction =
          detectBitratePresetMismatch(match.device.bitrate, presetBitrate) ?? 'preset-upgrade';
        return { reasons: [direction] };
      });
    }

    // Pass 2: Force metadata sweep — move ALL remaining existing items to toUpdate.
    if (this.config.raw.forceMetadata) {
      sweepAllExisting(diff, 'force-metadata');
    }
  }

  // ---- Planning ----

  planAdd(source: CollectionVideo): VideoOperation {
    const { action } = this.classifier.classify(source);
    const transformedSeriesTitle = this.getTransformedSeriesTitle(source);

    if (action.type === 'passthrough') {
      return {
        type: 'video-copy',
        source,
        ...(transformedSeriesTitle && { transformedSeriesTitle }),
      };
    }

    return {
      type: 'video-transcode',
      source,
      settings: action.settings,
      ...(transformedSeriesTitle && { transformedSeriesTitle }),
    };
  }

  planRemove(device: DeviceVideo): VideoOperation {
    return { type: 'video-remove', video: device };
  }

  planUpdate(
    source: CollectionVideo,
    device: DeviceVideo,
    reasons: UpdateReason[],
    _changes?: import('../engine/types.js').MetadataChange[],
    _syncTag?: import('../../metadata/sync-tags.js').SyncTagData
  ): VideoOperation[] {
    if (reasons.length === 0) return [];

    const primaryReason = reasons[0]!;

    // Preset changes require re-transcoding via upgrade
    if (primaryReason === 'preset-upgrade' || primaryReason === 'preset-downgrade') {
      const { action } = this.classifier.classify(source);
      return [
        {
          type: 'video-upgrade',
          source,
          target: device,
          reason: primaryReason as UpgradeReason,
          // Include settings if the classifier says transcode is needed
          ...(action.type === 'transcode' && { settings: action.settings }),
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

  estimateSize(op: VideoOperation): number {
    return calculateVideoOperationSize(op);
  }

  estimateTime(op: VideoOperation): number {
    return calculateVideoOperationTime(op);
  }

  getOperationPriority(op: VideoOperation): number {
    switch (op.type) {
      case 'video-remove':
        return 0;
      case 'video-update-metadata':
        return 1;
      case 'video-copy':
        return 2;
      case 'video-upgrade':
        return 3;
      case 'video-transcode':
        return 4;
      default:
        return 5;
    }
  }

  // ---- Execution ----

  async *execute(
    op: VideoOperation,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    operations: VideoOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    op: Extract<VideoOperation, { type: 'video-transcode' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    const videoQuality = this.config.videoQuality;
    if (videoQuality) {
      const syncTag = buildVideoSyncTag(videoQuality);
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
    op: Extract<VideoOperation, { type: 'video-copy' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    op: Extract<VideoOperation, { type: 'video-remove' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    op: Extract<VideoOperation, { type: 'video-update-metadata' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
    op: Extract<VideoOperation, { type: 'video-upgrade' }>,
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<VideoOperation>> {
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
      const transcodeOp: Extract<VideoOperation, { type: 'video-transcode' }> = {
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
      const copyOp: Extract<VideoOperation, { type: 'video-copy' }> = {
        type: 'video-copy',
        source,
      };

      for await (const progress of this.executeCopy(copyOp, ctx)) {
        yield { ...progress, operation: op };
      }
    }
  }

  // ---- Collision checking ----

  getCollisionCheckInputs(plan: SyncPlan<VideoOperation>): CollisionCheckInput[] {
    const inputs: CollisionCheckInput[] = [];
    for (const op of plan.operations) {
      if (op.type === 'video-transcode') {
        inputs.push({
          title: op.source.title,
          filetype: 'M4V video file',
          mediaType: op.source.contentType === 'tvshow' ? MediaType.TVShow : MediaType.Movie,
          tvShow: op.source.seriesTitle,
          tvEpisode: op.source.episodeId,
          seasonNumber: op.source.seasonNumber,
          episodeNumber: op.source.episodeNumber,
          year: op.source.year,
        });
      } else if (op.type === 'video-copy') {
        const ext = op.source.filePath?.split('.').pop();
        inputs.push({
          title: op.source.title,
          filetype: ext ? `.${ext}` : undefined,
          mediaType: op.source.contentType === 'tvshow' ? MediaType.TVShow : MediaType.Movie,
          tvShow: op.source.seriesTitle,
          tvEpisode: op.source.episodeId,
          seasonNumber: op.source.seasonNumber,
          episodeNumber: op.source.episodeNumber,
          year: op.source.year,
        });
      }
    }
    return inputs;
  }

  // ---- Device ----

  getDeviceItems(device: DeviceAdapter): DeviceVideo[] {
    return getVideoDeviceItems(device);
  }

  // ---- Display ----

  getDisplayName(op: VideoOperation): string {
    return getVideoOperationDisplayName(op);
  }

  formatDryRun(plan: SyncPlan<VideoOperation>): DryRunSummary {
    return formatDryRunFromPlan(
      plan,
      (type) => {
        if (type === 'video-transcode' || type === 'video-copy') return 'add';
        if (type === 'video-remove') return 'remove';
        if (type === 'video-update-metadata' || type === 'video-upgrade') return 'update';
        return null;
      },
      (op) => this.getDisplayName(op),
      (op) => this.estimateSize(op)
    );
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
 * Convert a DeviceTrack (from the adapter) to an DeviceVideo for video operations.
 *
 * Maps the track's metadata fields to the DeviceVideo interface used by the
 * video differ and planner.
 */
function deviceTrackToVideo(track: DeviceTrack): DeviceVideo {
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
 * Get video tracks from a device, excluding unmanaged mass-storage files.
 *
 * Filters by video media type and excludes unmanaged files on mass-storage devices.
 * Mirrors iPod behavior where only database tracks are surfaced. Duck-typed
 * because `managed` is a MassStorageTrack property, not on the DeviceTrack interface.
 */
export function getVideoDeviceItems(device: DeviceAdapter): DeviceVideo[] {
  const tracks = device
    .getTracks()
    .filter((track) => isVideoMediaType(track.mediaType))
    .filter((track) => !('managed' in track && !track.managed));

  return tracks.map((track) => deviceTrackToVideo(track));
}

/**
 * Create a VideoHandler instance
 */
export function createVideoHandler(config?: VideoSyncConfig): VideoHandler {
  return new VideoHandler(config);
}
