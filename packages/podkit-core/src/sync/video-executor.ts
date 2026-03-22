/**
 * Video sync executor - executes video sync plans
 *
 * This module implements video sync execution including:
 * - Video transcoding to iPod-compatible format
 * - File transfer to iPod
 * - Adding video tracks to iPod database
 *
 * ## Execution Pipeline
 *
 * Video transcoding follows a sequential approach (videos are large):
 * - Transcode video to temp file
 * - Transfer file to iPod
 * - Add track to database
 *
 * ## Progress Reporting
 *
 * Progress is reported at two granularities:
 * - Per-file: overall operation progress
 * - Per-transcode: transcoding percentage for long videos
 *
 * @module
 */

import type { SyncOperation, SyncPlan, ExecuteOptions, ExecutorProgress } from './types.js';
import type { TranscodeProgress } from '../transcode/types.js';
import type { IpodDatabase } from '../ipod/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended options for video sync execution
 */
export interface VideoExecuteOptions extends ExecuteOptions {
  /** Continue executing remaining operations after an error */
  continueOnError?: boolean;

  /** Temporary directory for transcoded files (defaults to system temp) */
  tempDir?: string;

  /** Callback for transcode progress updates (within a single video) */
  onTranscodeProgress?: (progress: TranscodeProgress) => void;

  /**
   * Video quality preset name for sync tag writing.
   * When set, sync tags are written to transcoded video tracks.
   */
  videoQuality?: string;

  /**
   * Save the iPod database every N completed video operations (transcode + copy).
   *
   * Reduces data loss if the process is killed, at the cost of triggering
   * libgpod's ithmb compaction more frequently. Set to 0 to disable.
   *
   * @default 10
   */
  saveInterval?: number;
}

/**
 * Dependencies required for video executor
 */
export interface VideoExecutorDependencies {
  /** iPod database instance */
  ipod: IpodDatabase;
}

// =============================================================================
// Interface
// =============================================================================

/**
 * Interface for executing video sync plans
 */
export interface VideoSyncExecutor {
  /**
   * Execute a video sync plan
   *
   * Yields progress updates during execution. Each yield represents
   * either an operation starting, completing, or failing.
   *
   * @param plan - The video sync plan to execute
   * @param options - Execution options
   * @yields Progress updates during execution
   *
   * @example
   * ```typescript
   * const plan = planVideoSync(diff);
   *
   * for await (const progress of executor.execute(plan)) {
   *   console.log(`${progress.phase}: ${progress.currentTrack}`);
   *   if (progress.transcodeProgress) {
   *     console.log(`  Transcoding: ${progress.transcodeProgress.percent.toFixed(1)}%`);
   *   }
   * }
   * ```
   */
  execute(plan: SyncPlan, options?: VideoExecuteOptions): AsyncIterable<ExecutorProgress>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get display name for a video operation
 */
export function getVideoOperationDisplayName(operation: SyncOperation): string {
  switch (operation.type) {
    case 'video-transcode':
    case 'video-copy': {
      const video = operation.source;
      if (video.contentType === 'tvshow' && video.episodeId) {
        // Format: "Series Title - S01E01" or "Title - S01E01" if no series title
        const showName = video.seriesTitle || video.title;
        return `${showName} - ${video.episodeId}`;
      }
      // For movies, just use the title (with year if available)
      if (video.year) {
        return `${video.title} (${video.year})`;
      }
      return video.title;
    }
    case 'video-upgrade': {
      const video = operation.source;
      if (video.contentType === 'tvshow' && video.episodeId) {
        const showName = video.seriesTitle || video.title;
        return `${showName} - ${video.episodeId}`;
      }
      if (video.year) {
        return `${video.title} (${video.year})`;
      }
      return video.title;
    }
    case 'video-remove': {
      const video = operation.video;
      if (
        video.contentType === 'tvshow' &&
        video.seasonNumber !== undefined &&
        video.episodeNumber !== undefined
      ) {
        const showName = video.seriesTitle || video.title;
        const episodeId = `S${String(video.seasonNumber).padStart(2, '0')}E${String(video.episodeNumber).padStart(2, '0')}`;
        return `${showName} - ${episodeId}`;
      }
      return video.title;
    }
    case 'video-update-metadata': {
      const video = operation.video;
      if (
        video.contentType === 'tvshow' &&
        video.seasonNumber !== undefined &&
        video.episodeNumber !== undefined
      ) {
        const showName = video.seriesTitle || video.title;
        const episodeId = `S${String(video.seasonNumber).padStart(2, '0')}E${String(video.episodeNumber).padStart(2, '0')}`;
        return `${showName} - ${episodeId}`;
      }
      return video.title;
    }
    default:
      return 'Unknown operation';
  }
}
