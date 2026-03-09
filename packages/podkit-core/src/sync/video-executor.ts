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

import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { SyncProgress, SyncOperation, ExecuteOptions } from './types.js';
import type { VideoSyncPlan } from './video-planner.js';
import type { VideoTranscodeProgress } from '../video/transcode.js';
import type { IpodDatabase } from '../ipod/index.js';
import { transcodeVideo } from '../video/transcode.js';
import { probeVideo } from '../video/probe.js';
import { createVideoTrackInput } from '../ipod/video.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended progress information for video sync operations
 */
export interface VideoExecutorProgress extends SyncProgress {
  /** Current operation being executed */
  operation: SyncOperation;

  /** Index of current operation (0-based) */
  index: number;

  /** Error if operation failed */
  error?: Error;

  /** Whether this operation was skipped (dry-run) */
  skipped?: boolean;

  /** Transcode progress for video-transcode operations */
  transcodeProgress?: VideoTranscodeProgress;
}

/**
 * Extended options for video sync execution
 */
export interface VideoExecuteOptions extends ExecuteOptions {
  /** Continue executing remaining operations after an error */
  continueOnError?: boolean;

  /** Temporary directory for transcoded files (defaults to system temp) */
  tempDir?: string;

  /** Callback for transcode progress updates (within a single video) */
  onTranscodeProgress?: (progress: VideoTranscodeProgress) => void;
}

/**
 * Result of video sync execution
 */
export interface VideoExecuteResult {
  /** Number of operations completed successfully */
  completed: number;

  /** Number of operations that failed */
  failed: number;

  /** Number of operations skipped (dry-run or unsupported) */
  skipped: number;

  /** Errors encountered during execution */
  errors: Array<{ operation: SyncOperation; error: Error }>;

  /** Total bytes transferred */
  bytesTransferred: number;
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
   * const executor = createVideoExecutor({ ipod });
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
  execute(
    plan: VideoSyncPlan,
    options?: VideoExecuteOptions
  ): AsyncIterable<VideoExecutorProgress>;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Default video sync executor implementation
 */
export class DefaultVideoSyncExecutor implements VideoSyncExecutor {
  private ipod: IpodDatabase;

  constructor(deps: VideoExecutorDependencies) {
    this.ipod = deps.ipod;
  }

  /**
   * Execute a video sync plan
   */
  async *execute(
    plan: VideoSyncPlan,
    options: VideoExecuteOptions = {}
  ): AsyncIterable<VideoExecutorProgress> {
    const {
      dryRun = false,
      continueOnError = false,
      tempDir = tmpdir(),
      signal,
      onTranscodeProgress,
    } = options;

    const total = plan.operations.length;
    let bytesProcessed = 0;

    // Create temp directory for transcoded files
    const transcodeDir = join(tempDir, `podkit-video-${randomUUID()}`);
    const hasTranscodes = plan.operations.some((op) => op.type === 'video-transcode');

    if (hasTranscodes && !dryRun) {
      await mkdir(transcodeDir, { recursive: true });
    }

    try {
      // Dry-run mode - just simulate
      if (dryRun) {
        yield* this.executeDryRun(plan);
        return;
      }

      // Real execution
      for (let index = 0; index < plan.operations.length; index++) {
        const operation = plan.operations[index]!;

        // Check for abort
        if (signal?.aborted) {
          throw new Error('Video sync aborted');
        }

        try {
          if (operation.type === 'video-transcode') {
            // Track bytes through yielded progress
            let lastProgress: VideoExecutorProgress | undefined;
            for await (const progress of this.executeTranscode(
              operation,
              index,
              total,
              bytesProcessed,
              plan.estimatedSize,
              transcodeDir,
              onTranscodeProgress,
              signal
            )) {
              yield progress;
              lastProgress = progress;
            }
            // Update bytes from final progress
            if (lastProgress) {
              bytesProcessed = lastProgress.bytesProcessed;
            }
          } else if (operation.type === 'video-copy') {
            // Track bytes through yielded progress
            let lastProgress: VideoExecutorProgress | undefined;
            for await (const progress of this.executeCopy(
              operation,
              index,
              total,
              bytesProcessed,
              plan.estimatedSize
            )) {
              yield progress;
              lastProgress = progress;
            }
            // Update bytes from final progress
            if (lastProgress) {
              bytesProcessed = lastProgress.bytesProcessed;
            }
          } else if (operation.type === 'video-remove') {
            yield* this.executeRemove(
              operation,
              index,
              total,
              bytesProcessed,
              plan.estimatedSize
            );
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          yield {
            phase: 'video-transcoding',
            operation,
            index,
            current: index,
            total,
            currentTrack: getVideoOperationDisplayName(operation),
            bytesProcessed,
            bytesTotal: plan.estimatedSize,
            error: err,
          };

          if (!continueOnError) {
            throw err;
          }
        }
      }

      // Emit completion
      if (plan.operations.length > 0) {
        yield {
          phase: 'complete',
          operation: plan.operations[plan.operations.length - 1]!,
          index: plan.operations.length - 1,
          current: plan.operations.length - 1,
          total,
          currentTrack: getVideoOperationDisplayName(plan.operations[plan.operations.length - 1]!),
          bytesProcessed,
          bytesTotal: plan.estimatedSize,
        };
      }
    } finally {
      // Cleanup temp directory
      if (hasTranscodes && !dryRun) {
        try {
          await rm(transcodeDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Execute in dry-run mode
   */
  private async *executeDryRun(
    plan: VideoSyncPlan
  ): AsyncIterable<VideoExecutorProgress> {
    const total = plan.operations.length;
    const bytesProcessed = 0;

    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]!;

      const phase = operation.type === 'video-transcode'
        ? 'video-transcoding'
        : operation.type === 'video-copy'
          ? 'video-copying'
          : operation.type === 'video-remove'
            ? 'removing'
            : 'preparing';

      yield {
        phase,
        operation,
        index,
        current: index,
        total,
        currentTrack: getVideoOperationDisplayName(operation),
        bytesProcessed,
        bytesTotal: plan.estimatedSize,
        skipped: true,
      };
    }

    // Emit completion
    if (plan.operations.length > 0) {
      yield {
        phase: 'complete',
        operation: plan.operations[plan.operations.length - 1]!,
        index: plan.operations.length - 1,
        current: plan.operations.length - 1,
        total,
        currentTrack: getVideoOperationDisplayName(plan.operations[plan.operations.length - 1]!),
        bytesProcessed,
        bytesTotal: plan.estimatedSize,
      };
    }
  }

  /**
   * Execute a video transcode operation
   */
  private async *executeTranscode(
    operation: Extract<SyncOperation, { type: 'video-transcode' }>,
    index: number,
    total: number,
    bytesProcessed: number,
    bytesTotal: number,
    transcodeDir: string,
    onTranscodeProgress?: (progress: VideoTranscodeProgress) => void,
    signal?: AbortSignal
  ): AsyncIterable<VideoExecutorProgress> {
    const { source, settings } = operation;

    // Generate output filename
    const outputFilename = `${randomUUID()}.m4v`;
    const tempOutputPath = join(transcodeDir, outputFilename);

    // Track latest progress for yielding
    let latestTranscodeProgress: VideoTranscodeProgress | undefined;
    let transcodeComplete = false;
    let transcodeError: Error | undefined;

    // Start transcoding in background
    const transcodePromise = transcodeVideo(source.filePath, tempOutputPath, settings, {
      onProgress: (progress) => {
        latestTranscodeProgress = progress;
        onTranscodeProgress?.(progress);
      },
      signal,
    }).then(() => {
      transcodeComplete = true;
    }).catch((err) => {
      transcodeError = err instanceof Error ? err : new Error(String(err));
      transcodeComplete = true;
    });

    // Yield progress updates while transcoding
    while (!transcodeComplete) {
      yield {
        phase: 'video-transcoding',
        operation,
        index,
        current: index,
        total,
        currentTrack: source.title,
        bytesProcessed,
        bytesTotal,
        transcodeProgress: latestTranscodeProgress,
      };

      // Wait a bit before next update (100ms)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Check for errors
    if (transcodeError) {
      throw transcodeError;
    }

    // Wait for promise to fully resolve
    await transcodePromise;

    // Get transcoded file size
    const outputStats = await stat(tempOutputPath);

    // Probe the source video for metadata
    const analysis = await probeVideo(source.filePath);

    // Create track input for iPod database
    const trackInput = createVideoTrackInput(source, analysis, {
      size: outputStats.size,
    });

    // Add track to iPod and copy file
    const track = this.ipod.addTrack(trackInput);
    track.copyFile(tempOutputPath);

    // Yield completion progress
    yield {
      phase: 'video-transcoding',
      operation,
      index,
      current: index,
      total,
      currentTrack: source.title,
      bytesProcessed: bytesProcessed + outputStats.size,
      bytesTotal,
    };
  }

  /**
   * Execute a video copy operation (passthrough)
   */
  private async *executeCopy(
    operation: Extract<SyncOperation, { type: 'video-copy' }>,
    index: number,
    total: number,
    bytesProcessed: number,
    bytesTotal: number
  ): AsyncIterable<VideoExecutorProgress> {
    const { source } = operation;

    // Yield start progress
    yield {
      phase: 'video-copying',
      operation,
      index,
      current: index,
      total,
      currentTrack: source.title,
      bytesProcessed,
      bytesTotal,
    };

    // Get file stats
    const fileStats = await stat(source.filePath);

    // Probe the source video for metadata
    const analysis = await probeVideo(source.filePath);

    // Create track input for iPod database
    const trackInput = createVideoTrackInput(source, analysis, {
      size: fileStats.size,
    });

    // Add track to iPod and copy file
    const track = this.ipod.addTrack(trackInput);
    track.copyFile(source.filePath);

    // Yield completion progress
    yield {
      phase: 'video-copying',
      operation,
      index,
      current: index,
      total,
      currentTrack: source.title,
      bytesProcessed: bytesProcessed + fileStats.size,
      bytesTotal,
    };
  }

  /**
   * Execute a video remove operation
   */
  private async *executeRemove(
    operation: Extract<SyncOperation, { type: 'video-remove' }>,
    index: number,
    total: number,
    bytesProcessed: number,
    bytesTotal: number
  ): AsyncIterable<VideoExecutorProgress> {
    const { video } = operation;

    // Yield start progress
    yield {
      phase: 'removing',
      operation,
      index,
      current: index,
      total,
      currentTrack: video.title,
      bytesProcessed,
      bytesTotal,
    };

    // Find the matching track in the database by file path or metadata
    const tracks = this.ipod.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.filePath === video.filePath ||
        (t.title === video.title && t.tvShow === video.seriesTitle)
    );

    if (!foundTrack) {
      throw new Error(`Video track not found in database: ${video.title}`);
    }

    // Remove the track (this also removes the file)
    foundTrack.remove();

    // Yield completion progress
    yield {
      phase: 'removing',
      operation,
      index,
      current: index,
      total,
      currentTrack: video.title,
      bytesProcessed,
      bytesTotal,
    };
  }
}

/**
 * Placeholder video sync executor (dry-run only, no dependencies)
 *
 * Use this when you don't have an iPod connection but want to preview plans.
 */
export class PlaceholderVideoSyncExecutor implements VideoSyncExecutor {
  /**
   * Execute a video sync plan (dry-run only)
   */
  async *execute(
    plan: VideoSyncPlan,
    options: VideoExecuteOptions = {}
  ): AsyncIterable<VideoExecutorProgress> {
    const { dryRun = false } = options;

    if (!dryRun) {
      throw new Error(
        'PlaceholderVideoSyncExecutor only supports dry-run mode. ' +
        'Use createVideoExecutor({ ipod }) for real execution.'
      );
    }

    const total = plan.operations.length;
    const bytesProcessed = 0;

    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]!;

      const phase = operation.type === 'video-transcode'
        ? 'video-transcoding'
        : operation.type === 'video-copy'
          ? 'video-copying'
          : operation.type === 'video-remove'
            ? 'removing'
            : 'preparing';

      yield {
        phase,
        operation,
        index,
        current: index,
        total,
        currentTrack: getVideoOperationDisplayName(operation),
        bytesProcessed,
        bytesTotal: plan.estimatedSize,
        skipped: true,
      };
    }

    // Emit completion
    if (plan.operations.length > 0) {
      yield {
        phase: 'complete',
        operation: plan.operations[plan.operations.length - 1]!,
        index: plan.operations.length - 1,
        current: plan.operations.length - 1,
        total,
        currentTrack: getVideoOperationDisplayName(plan.operations[plan.operations.length - 1]!),
        bytesProcessed,
        bytesTotal: plan.estimatedSize,
      };
    }
  }
}

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
    case 'video-remove': {
      const video = operation.video;
      if (video.contentType === 'tvshow' && video.seasonNumber !== undefined && video.episodeNumber !== undefined) {
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

/**
 * Create a video sync executor
 *
 * @param deps - Dependencies including iPod database instance
 * @returns A video sync executor that can execute plans
 *
 * @example
 * ```typescript
 * const ipod = await IpodDatabase.open('/Volumes/iPod');
 * const executor = createVideoExecutor({ ipod });
 *
 * for await (const progress of executor.execute(plan)) {
 *   console.log(`${progress.phase}: ${progress.currentTrack}`);
 * }
 *
 * ipod.save();
 * ipod.close();
 * ```
 */
export function createVideoExecutor(deps?: VideoExecutorDependencies): VideoSyncExecutor {
  if (deps?.ipod) {
    return new DefaultVideoSyncExecutor(deps);
  }
  // Return placeholder for dry-run only usage
  return new PlaceholderVideoSyncExecutor();
}
