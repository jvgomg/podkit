/**
 * Video sync planner for converting video diffs into execution plans
 *
 * The planner takes a UnifiedSyncDiff<CollectionVideo, DeviceVideo> and produces a
 * VideoSyncPlan containing ordered operations. It determines whether each video
 * needs transcoding or can be copied directly (passthrough), estimates output
 * sizes, and calculates estimated times.
 *
 * ## Passthrough vs Transcode Decision
 *
 * | Condition | Decision |
 * |-----------|----------|
 * | MP4/M4V container + H.264 + AAC + within device limits | Passthrough |
 * | MKV container with compatible streams | Transcode (container only) |
 * | Incompatible codec/resolution/bitrate | Transcode (full) |
 *
 * ## Time Estimation
 *
 * - Passthrough: Based on USB transfer speed (file size / transfer rate)
 * - Transcode: Based on video duration (duration * speed factor)
 *
 * @module
 */

import type { CollectionVideo } from '../video/directory-adapter.js';
import type {
  VideoDeviceProfile,
  VideoQualityPreset,
  VideoTranscodeSettings,
  VideoSourceAnalysis,
} from '../video/types.js';
import { getDefaultDeviceProfile } from '../video/types.js';
import { checkVideoCompatibility } from '../video/compatibility.js';
import { calculateEffectiveSettings } from '../video/quality.js';
import type { SyncOperation, SyncPlan, SyncWarning } from './types.js';
import type { DeviceVideo } from './video-types.js';
import type { UnifiedSyncDiff } from './content-type.js';
import type { VideoTransformsConfig } from '../transforms/types.js';
import { applyVideoTransforms } from '../transforms/video-pipeline.js';
import { estimateTransferTime } from './estimation.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for video sync planning
 */
export interface VideoSyncPlanOptions {
  /** Target device profile (defaults to iPod Classic) */
  deviceProfile?: VideoDeviceProfile;

  /** Quality preset for transcoding (defaults to 'high') */
  qualityPreset?: VideoQualityPreset;

  /** Whether to remove videos not in collection */
  removeOrphans?: boolean;

  /** Maximum size in bytes (for space-constrained syncs) */
  maxSize?: number;

  /** Whether to use hardware acceleration for transcoding */
  useHardwareAcceleration?: boolean;

  /** Video transform configuration for applying transforms on add */
  videoTransforms?: import('../transforms/types.js').VideoTransformsConfig;
}

/**
 * Extended warning type for video operations
 */
export type VideoSyncWarningType = 'low-quality-source' | 'unsupported-format';

/**
 * Warning generated during video sync planning
 */
export interface VideoSyncWarning {
  type: VideoSyncWarningType;
  /** Human-readable description of the warning */
  message: string;
  /** Videos affected by this warning */
  videos: CollectionVideo[];
}

/**
 * Summary of video plan operations
 */
export interface VideoPlanSummary {
  /** Number of videos that will be transcoded */
  transcodeCount: number;
  /** Number of videos that will be copied directly (passthrough) */
  copyCount: number;
  /** Number of videos that will be removed */
  removeCount: number;
  /** Number of videos that need metadata updates */
  updateCount: number;
  /** Number of videos that will be upgraded (re-transcoded due to preset change) */
  upgradeCount: number;
  /** Number of unsupported videos skipped */
  skippedCount: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default quality preset for video transcoding
 */
const DEFAULT_QUALITY_PRESET: VideoQualityPreset = 'high';

/**
 * Estimated transcoding speed factor (multiples of realtime)
 *
 * Software: x264 at iPod resolution (~640x480) on modern CPUs typically
 * achieves 5-10x realtime. Using 5x as a conservative estimate.
 *
 * Hardware: VideoToolbox on Apple Silicon achieves 20-30x+ realtime for
 * iPod-resolution H.264. At these speeds, USB 2.0 transfer (~2.5 MB/s)
 * is always the bottleneck, so the hardware factor rarely matters.
 */
const TRANSCODE_SPEED_FACTOR_SOFTWARE = 5;
const TRANSCODE_SPEED_FACTOR_HARDWARE = 25;

/**
 * M4V container overhead in bytes
 */
const M4V_CONTAINER_OVERHEAD_BYTES = 4096;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a synthetic VideoSourceAnalysis from CollectionVideo
 *
 * CollectionVideo contains the probe results embedded, so we can construct
 * a VideoSourceAnalysis for compatibility checking.
 */
function toSourceAnalysis(video: CollectionVideo): VideoSourceAnalysis {
  return {
    filePath: video.filePath,
    container: video.container,
    videoCodec: video.videoCodec,
    videoProfile: null, // We don't have profile info in CollectionVideo
    videoLevel: null,
    width: video.width,
    height: video.height,
    videoBitrate: 0, // Not available in CollectionVideo
    frameRate: 0, // Not available in CollectionVideo
    audioCodec: video.audioCodec,
    audioBitrate: 0,
    audioChannels: 2, // Assume stereo
    audioSampleRate: 48000, // Assume standard sample rate
    duration: video.duration,
    hasVideoStream: true,
    hasAudioStream: true,
  };
}

/**
 * Check if a video can be copied directly without transcoding
 */
function canPassthrough(video: CollectionVideo, device: VideoDeviceProfile): boolean {
  const analysis = toSourceAnalysis(video);
  const compatibility = checkVideoCompatibility(analysis, device);
  return compatibility.status === 'passthrough';
}

/**
 * Check if a video can be transcoded (vs unsupported)
 */
function canTranscode(video: CollectionVideo, device: VideoDeviceProfile): boolean {
  const analysis = toSourceAnalysis(video);
  const compatibility = checkVideoCompatibility(analysis, device);
  return compatibility.status !== 'unsupported';
}

/**
 * Calculate transcode settings for a video
 */
function calculateTranscodeSettings(
  video: CollectionVideo,
  device: VideoDeviceProfile,
  preset: VideoQualityPreset,
  useHardwareAcceleration: boolean
): VideoTranscodeSettings {
  const analysis = toSourceAnalysis(video);

  // Get base settings from quality capping module
  const settings = calculateEffectiveSettings(analysis, preset, device);

  // Override hardware acceleration setting
  return {
    ...settings,
    useHardwareAcceleration,
  };
}

/**
 * Estimate output file size for a transcoded video
 *
 * Formula: (duration_sec * bitrate_kbps * 1000 / 8) + overhead
 */
export function estimateTranscodedSize(
  durationSeconds: number,
  videoBitrateKbps: number,
  audioBitrateKbps: number
): number {
  const videoBytes = (durationSeconds * videoBitrateKbps * 1000) / 8;
  const audioBytes = (durationSeconds * audioBitrateKbps * 1000) / 8;
  return Math.ceil(videoBytes + audioBytes + M4V_CONTAINER_OVERHEAD_BYTES);
}

/**
 * Estimate output file size for a passthrough video
 *
 * For passthrough, the file size is approximately the same as the source.
 * We estimate based on duration and typical bitrates if actual size not available.
 */
export function estimatePassthroughSize(video: CollectionVideo): number {
  // Estimate using typical bitrates for the resolution
  const videoBitrateKbps = video.width >= 1280 ? 2500 : video.width >= 640 ? 1500 : 800;
  const audioBitrateKbps = 128;

  return estimateTranscodedSize(video.duration, videoBitrateKbps, audioBitrateKbps);
}

/**
 * Estimate transcoding time in seconds
 */
function estimateTranscodeTime(durationSeconds: number, useHardwareAcceleration: boolean): number {
  const speedFactor = useHardwareAcceleration
    ? TRANSCODE_SPEED_FACTOR_HARDWARE
    : TRANSCODE_SPEED_FACTOR_SOFTWARE;
  return durationSeconds / speedFactor;
}

/**
 * Calculate estimated size for a video operation.
 *
 * Used by the audio planner to handle video operations in mixed plans.
 */
export function calculateVideoOperationSize(
  operation: Extract<
    SyncOperation,
    {
      type:
        | 'video-transcode'
        | 'video-copy'
        | 'video-remove'
        | 'video-update-metadata'
        | 'video-upgrade';
    }
  >
): number {
  switch (operation.type) {
    case 'video-transcode': {
      // Estimate video size based on duration and bitrate
      const duration = operation.source.duration ?? 3600; // default 1 hour in seconds
      const videoBitrate = operation.settings.targetVideoBitrate ?? 1500; // kbps
      const audioBitrate = operation.settings.targetAudioBitrate ?? 128; // kbps
      const totalBitrate = videoBitrate + audioBitrate; // kbps
      return Math.round((duration * totalBitrate * 1000) / 8); // bytes
    }
    case 'video-copy': {
      // For passthrough, estimate based on source duration and typical bitrate
      const duration = operation.source.duration ?? 3600;
      return Math.round((duration * 2000 * 1000) / 8); // ~2 Mbps estimate
    }
    case 'video-upgrade': {
      // Upgrade replaces the video — size depends on whether it needs transcoding
      if (operation.settings) {
        const duration = operation.source.duration ?? 3600;
        const videoBitrate = operation.settings.targetVideoBitrate ?? 1500;
        const audioBitrate = operation.settings.targetAudioBitrate ?? 128;
        const totalBitrate = videoBitrate + audioBitrate;
        return Math.round((duration * totalBitrate * 1000) / 8);
      }
      // Passthrough upgrade
      const duration = operation.source.duration ?? 3600;
      return Math.round((duration * 2000 * 1000) / 8);
    }
    case 'video-remove':
    case 'video-update-metadata':
      // Removal frees space rather than consuming it; metadata updates have no size
      return 0;
  }
}

/**
 * Calculate estimated time for a video operation.
 *
 * Used by the audio planner to handle video operations in mixed plans.
 * Assumes hardware acceleration is available (the default).
 */
export function calculateVideoOperationTime(
  operation: Extract<
    SyncOperation,
    {
      type:
        | 'video-transcode'
        | 'video-copy'
        | 'video-remove'
        | 'video-update-metadata'
        | 'video-upgrade';
    }
  >
): number {
  switch (operation.type) {
    case 'video-transcode': {
      const duration = operation.source.duration ?? 3600;
      const size = calculateVideoOperationSize(operation);
      // Transcode and transfer are pipelined; use whichever is slower
      const transcodeTime = estimateTranscodeTime(duration, true);
      const transferTime = estimateTransferTime(size);
      return Math.max(transcodeTime, transferTime);
    }
    case 'video-copy': {
      // Video copy is transfer-limited
      const size = calculateVideoOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'video-upgrade': {
      // Upgrade time depends on whether transcoding is needed
      const size = calculateVideoOperationSize(operation);
      if (operation.settings) {
        const duration = operation.source.duration ?? 3600;
        const transcodeTime = estimateTranscodeTime(duration, true);
        const transferTime = estimateTransferTime(size);
        return Math.max(transcodeTime, transferTime);
      }
      return estimateTransferTime(size);
    }
    case 'video-remove':
      // Removal is nearly instant
      return 0.1;
    case 'video-update-metadata':
      // Metadata update is nearly instant (database update only)
      return 0.1;
  }
}

// =============================================================================
// Planning Functions
// =============================================================================

/**
 * Plan operations for videos to be added
 */
function planAddOperations(
  videos: CollectionVideo[],
  device: VideoDeviceProfile,
  preset: VideoQualityPreset,
  useHardwareAcceleration: boolean,
  videoTransforms?: VideoTransformsConfig
): {
  operations: SyncOperation[];
  lowQualityVideos: CollectionVideo[];
  unsupportedVideos: CollectionVideo[];
} {
  const operations: SyncOperation[] = [];
  const lowQualityVideos: CollectionVideo[] = [];
  const unsupportedVideos: CollectionVideo[] = [];

  for (const video of videos) {
    // Check if video can be transcoded at all
    if (!canTranscode(video, device)) {
      unsupportedVideos.push(video);
      continue;
    }

    // Compute transformed series title if video transforms are configured
    let transformedSeriesTitle: string | undefined;
    if (videoTransforms) {
      const result = applyVideoTransforms(video, videoTransforms);
      if (result.applied) {
        transformedSeriesTitle = result.transformed.seriesTitle;
      }
    }

    // Check if passthrough is possible
    if (canPassthrough(video, device)) {
      operations.push({
        type: 'video-copy',
        source: video,
        transformedSeriesTitle,
      });
    } else {
      // Calculate transcode settings
      const settings = calculateTranscodeSettings(video, device, preset, useHardwareAcceleration);

      operations.push({
        type: 'video-transcode',
        source: video,
        settings,
        transformedSeriesTitle,
      });

      // Track low quality sources for warnings
      if (video.width < 320 || video.height < 240) {
        lowQualityVideos.push(video);
      }
    }
  }

  return { operations, lowQualityVideos, unsupportedVideos };
}

/**
 * Plan operations for videos to be removed
 */
function planRemoveOperations(videos: DeviceVideo[], removeOrphans: boolean): SyncOperation[] {
  if (!removeOrphans) {
    return [];
  }
  return videos.map((video) => ({
    type: 'video-remove' as const,
    video,
  }));
}

/**
 * Calculate operation size and time estimates
 */
function calculateOperationEstimates(
  operation: SyncOperation,
  useHardwareAcceleration: boolean
): { size: number; time: number } {
  switch (operation.type) {
    case 'video-transcode': {
      const video = operation.source as CollectionVideo;
      const settings = operation.settings;
      const size = estimateTranscodedSize(
        video.duration,
        settings.targetVideoBitrate,
        settings.targetAudioBitrate
      );
      // Time = transcode time + transfer time
      const transcodeTime = estimateTranscodeTime(video.duration, useHardwareAcceleration);
      const transferTime = estimateTransferTime(size);
      // Transcode and transfer can be pipelined, so use max of the two
      const time = Math.max(transcodeTime, transferTime);
      return { size, time };
    }

    case 'video-copy': {
      const video = operation.source as CollectionVideo;
      const size = estimatePassthroughSize(video);
      const time = estimateTransferTime(size);
      return { size, time };
    }

    case 'video-remove':
      // Removal is nearly instant (database update + file delete)
      return { size: 0, time: 0.1 };

    case 'video-update-metadata':
      // Metadata updates are instant (database update only, no file transfer)
      return { size: 0, time: 0.1 };

    case 'video-upgrade': {
      // Video upgrades re-transcode and replace the file
      if (operation.settings) {
        const video = operation.source as CollectionVideo;
        const settings = operation.settings;
        const size = estimateTranscodedSize(
          video.duration,
          settings.targetVideoBitrate,
          settings.targetAudioBitrate
        );
        const transcodeTime = estimateTranscodeTime(video.duration, useHardwareAcceleration);
        const transferTime = estimateTransferTime(size);
        const time = Math.max(transcodeTime, transferTime);
        return { size, time };
      }
      // Passthrough upgrade (no transcode settings)
      const video = operation.source as CollectionVideo;
      const size = estimatePassthroughSize(video);
      const time = estimateTransferTime(size);
      return { size, time };
    }

    default:
      return { size: 0, time: 0 };
  }
}

/**
 * Order operations for efficient execution
 *
 * Strategy:
 * 1. Remove operations first (free up space)
 * 2. Copy operations next (faster, no CPU intensive work)
 * 3. Transcode operations last (can be pipelined with transfer)
 */
function orderOperations(operations: SyncOperation[]): SyncOperation[] {
  const removes: SyncOperation[] = [];
  const updates: SyncOperation[] = [];
  const upgrades: SyncOperation[] = [];
  const copies: SyncOperation[] = [];
  const transcodes: SyncOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case 'video-remove':
        removes.push(op);
        break;
      case 'video-update-metadata':
        updates.push(op);
        break;
      case 'video-upgrade':
        upgrades.push(op);
        break;
      case 'video-copy':
        copies.push(op);
        break;
      case 'video-transcode':
        transcodes.push(op);
        break;
    }
  }

  return [...removes, ...updates, ...upgrades, ...copies, ...transcodes];
}

// =============================================================================
// Main Planning Logic
// =============================================================================

/**
 * Create a video sync plan from a diff
 *
 * This function analyzes the diff and produces an ordered list of operations
 * to execute, along with estimated time and size requirements.
 *
 * @param diff - The video diff from the differ
 * @param options - Planning options
 * @returns The video sync plan with operations, estimated time, size, and warnings
 *
 * @example
 * ```typescript
 * const handler = createVideoHandler();
 * const differ = createSyncDiffer(handler);
 * const diff = differ.diff(collectionVideos, ipodVideos);
 * const plan = planVideoSync(diff, { qualityPreset: 'high' });
 * console.log(`${plan.operations.length} operations to execute`);
 * console.log(`Estimated size: ${plan.estimatedSize} bytes`);
 * ```
 */
export function planVideoSync(
  diff: UnifiedSyncDiff<CollectionVideo, DeviceVideo>,
  options: VideoSyncPlanOptions = {}
): SyncPlan {
  const {
    deviceProfile = getDefaultDeviceProfile(),
    qualityPreset = DEFAULT_QUALITY_PRESET,
    removeOrphans = false,
    useHardwareAcceleration = true,
    videoTransforms,
  } = options;

  // Plan add operations
  const {
    operations: addOperations,
    lowQualityVideos,
    unsupportedVideos,
  } = planAddOperations(
    diff.toAdd,
    deviceProfile,
    qualityPreset,
    useHardwareAcceleration,
    videoTransforms
  );

  // Plan remove operations (if enabled)
  const removeOperations = planRemoveOperations(diff.toRemove, removeOrphans);

  // Plan update/upgrade operations from toUpdate
  const updateOperations: SyncOperation[] = [];
  if (diff.toUpdate && diff.toUpdate.length > 0) {
    for (const update of diff.toUpdate) {
      const primaryReason = update.reasons[0];
      if (primaryReason === 'preset-upgrade' || primaryReason === 'preset-downgrade') {
        // Preset changes require re-transcoding — create a video-upgrade operation
        const video = update.source;
        if (canTranscode(video, deviceProfile)) {
          const settings = calculateTranscodeSettings(
            video,
            deviceProfile,
            qualityPreset,
            useHardwareAcceleration
          );
          updateOperations.push({
            type: 'video-upgrade',
            source: video,
            target: update.device,
            reason: primaryReason,
            settings,
          });
        }
      } else if (primaryReason === 'metadata-correction') {
        // Metadata corrections are metadata-only updates
        updateOperations.push({
          type: 'video-update-metadata',
          source: update.source,
          video: update.device,
        });
      } else if (primaryReason) {
        // Transform changes, force-metadata: compute effective series title
        let newSeriesTitle: string | undefined;
        if (update.source.contentType === 'tvshow') {
          if (
            (primaryReason === 'transform-apply' || primaryReason === 'force-metadata') &&
            videoTransforms
          ) {
            const result = applyVideoTransforms(update.source, videoTransforms);
            newSeriesTitle = result.applied
              ? result.transformed.seriesTitle
              : update.source.seriesTitle;
          } else if (primaryReason === 'transform-remove' || primaryReason === 'force-metadata') {
            // No transforms available or removing transforms — use original series title
            newSeriesTitle = update.source.seriesTitle;
          }
        }

        updateOperations.push({
          type: 'video-update-metadata',
          source: update.source,
          video: update.device,
          newSeriesTitle,
        });
      }
    }
  }

  // Combine and order operations (removes first, then adds/transcodes)
  const allOperations = [...removeOperations, ...updateOperations, ...addOperations];
  const orderedOperations = orderOperations(allOperations);

  // Calculate totals
  let estimatedSize = 0;
  let estimatedTime = 0;

  for (const op of orderedOperations) {
    const estimates = calculateOperationEstimates(op, useHardwareAcceleration);
    estimatedSize += estimates.size;
    estimatedTime += estimates.time;
  }

  // Build warnings
  const warnings: SyncWarning[] = [];

  if (lowQualityVideos.length > 0) {
    warnings.push({
      type: 'lossy-to-lossy', // Re-using existing warning type for now
      message: `${lowQualityVideos.length} video${lowQualityVideos.length === 1 ? ' has' : 's have'} low source quality (below 320x240). Output quality may be limited.`,
      tracks: [], // SyncWarning uses tracks, we'll update this when video-specific warnings are added
    });
  }

  if (unsupportedVideos.length > 0) {
    warnings.push({
      type: 'lossy-to-lossy', // Re-using existing warning type for now
      message: `${unsupportedVideos.length} video${unsupportedVideos.length === 1 ? ' is' : 's are'} in an unsupported format and will be skipped.`,
      tracks: [],
    });
  }

  return {
    operations: orderedOperations,
    estimatedTime,
    estimatedSize,
    warnings,
  };
}

/**
 * Check if a plan will fit within available space
 */
export function willVideoPlanFit(plan: SyncPlan, availableSpace: number): boolean {
  return plan.estimatedSize <= availableSpace;
}

/**
 * Get a summary of operations in a video plan
 */
export function getVideoPlanSummary(plan: SyncPlan): VideoPlanSummary {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;
  let updateCount = 0;
  let upgradeCount = 0;

  for (const op of plan.operations) {
    switch (op.type) {
      case 'video-transcode':
        transcodeCount++;
        break;
      case 'video-copy':
        copyCount++;
        break;
      case 'video-remove':
        removeCount++;
        break;
      case 'video-update-metadata':
        updateCount++;
        break;
      case 'video-upgrade':
        upgradeCount++;
        break;
    }
  }

  return {
    transcodeCount,
    copyCount,
    removeCount,
    updateCount,
    upgradeCount,
    skippedCount: 0, // Would track unsupported videos if needed
  };
}

// =============================================================================
// Interface and Factory
// =============================================================================

/**
 * Interface for video sync planning
 */
export interface VideoSyncPlanner {
  /**
   * Create an execution plan from a video diff
   */
  plan(
    diff: UnifiedSyncDiff<CollectionVideo, DeviceVideo>,
    options?: VideoSyncPlanOptions
  ): SyncPlan;
}
