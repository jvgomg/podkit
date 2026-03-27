/**
 * Video sync estimation utilities
 *
 * Provides size and time estimation for video sync operations, used by
 * VideoHandler.estimateSize() and VideoHandler.estimateTime().
 *
 * @module
 */

import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { SyncOperation } from '../engine/types.js';
import { estimateTransferTime } from '../engine/estimation.js';

// =============================================================================
// Constants
// =============================================================================

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
