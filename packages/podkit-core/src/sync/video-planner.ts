/**
 * Video sync planner for converting video diffs into execution plans
 *
 * The planner takes a VideoSyncDiff (from the video differ) and produces a
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
import type { SyncOperation, SyncWarning } from './types.js';
import type { VideoSyncDiff, IPodVideo } from './video-differ.js';
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
}

/**
 * Execution plan for video sync operations
 */
export interface VideoSyncPlan {
  /** Ordered list of operations to execute */
  operations: SyncOperation[];

  /** Estimated time in seconds */
  estimatedTime: number;

  /** Estimated total size in bytes */
  estimatedSize: number;

  /** Warnings generated during planning */
  warnings: SyncWarning[];
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
 * Estimated transcoding speed factor
 *
 * A factor of 0.5 means transcoding takes about 2x the video duration.
 * With hardware acceleration, this could be 1.0 or higher (faster than realtime).
 */
const TRANSCODE_SPEED_FACTOR_SOFTWARE = 0.5;
const TRANSCODE_SPEED_FACTOR_HARDWARE = 1.5;

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
  operation: Extract<SyncOperation, { type: 'video-transcode' | 'video-copy' | 'video-remove' }>
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
    case 'video-remove':
      // Removal frees space rather than consuming it
      return 0;
  }
}

/**
 * Calculate estimated time for a video operation.
 *
 * Used by the audio planner to handle video operations in mixed plans.
 */
export function calculateVideoOperationTime(
  operation: Extract<SyncOperation, { type: 'video-transcode' | 'video-copy' | 'video-remove' }>
): number {
  switch (operation.type) {
    case 'video-transcode': {
      // Video transcoding is slow - estimate based on duration
      const duration = operation.source.duration ?? 3600;
      // Assume ~0.5x realtime for video transcoding + transfer
      return duration * 2;
    }
    case 'video-copy': {
      // Video copy is transfer-limited
      const size = calculateVideoOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'video-remove':
      // Removal is nearly instant
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
  useHardwareAcceleration: boolean
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

    // Check if passthrough is possible
    if (canPassthrough(video, device)) {
      operations.push({
        type: 'video-copy',
        source: video,
      });
    } else {
      // Calculate transcode settings
      const settings = calculateTranscodeSettings(video, device, preset, useHardwareAcceleration);

      operations.push({
        type: 'video-transcode',
        source: video,
        settings,
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
function planRemoveOperations(videos: IPodVideo[], removeOrphans: boolean): SyncOperation[] {
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
  const copies: SyncOperation[] = [];
  const transcodes: SyncOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case 'video-remove':
        removes.push(op);
        break;
      case 'video-copy':
        copies.push(op);
        break;
      case 'video-transcode':
        transcodes.push(op);
        break;
    }
  }

  return [...removes, ...copies, ...transcodes];
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
 * const diff = diffVideos(collectionVideos, ipodVideos);
 * const plan = planVideoSync(diff, { qualityPreset: 'high' });
 * console.log(`${plan.operations.length} operations to execute`);
 * console.log(`Estimated size: ${plan.estimatedSize} bytes`);
 * ```
 */
export function planVideoSync(
  diff: VideoSyncDiff,
  options: VideoSyncPlanOptions = {}
): VideoSyncPlan {
  const {
    deviceProfile = getDefaultDeviceProfile(),
    qualityPreset = DEFAULT_QUALITY_PRESET,
    removeOrphans = false,
    useHardwareAcceleration = true,
  } = options;

  // Plan add operations
  const {
    operations: addOperations,
    lowQualityVideos,
    unsupportedVideos,
  } = planAddOperations(diff.toAdd, deviceProfile, qualityPreset, useHardwareAcceleration);

  // Plan remove operations (if enabled)
  const removeOperations = planRemoveOperations(diff.toRemove, removeOrphans);

  // Combine and order operations
  const allOperations = [...removeOperations, ...addOperations];
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
export function willVideoPlanFit(plan: VideoSyncPlan, availableSpace: number): boolean {
  return plan.estimatedSize <= availableSpace;
}

/**
 * Get a summary of operations in a video plan
 */
export function getVideoPlanSummary(plan: VideoSyncPlan): VideoPlanSummary {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;

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
    }
  }

  return {
    transcodeCount,
    copyCount,
    removeCount,
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
  plan(diff: VideoSyncDiff, options?: VideoSyncPlanOptions): VideoSyncPlan;
}

/**
 * Default implementation of VideoSyncPlanner
 */
export class DefaultVideoSyncPlanner implements VideoSyncPlanner {
  /**
   * Create an execution plan from a video diff
   */
  plan(diff: VideoSyncDiff, options?: VideoSyncPlanOptions): VideoSyncPlan {
    return planVideoSync(diff, options);
  }
}

/**
 * Create a new VideoSyncPlanner instance
 */
export function createVideoPlanner(): VideoSyncPlanner {
  return new DefaultVideoSyncPlanner();
}
