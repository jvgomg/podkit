/**
 * Video sync executor interface
 *
 * This module defines the interface for executing video sync plans.
 * The full implementation depends on iPod database video support (TASK-069.14).
 *
 * ## Execution Pipeline
 *
 * Video transcoding follows the same pipelined approach as audio:
 * - Producer: transcodes video to temp file (CPU bound)
 * - Consumer: transfers file to iPod (USB I/O bound)
 *
 * This keeps the USB bus saturated during transcoding.
 *
 * ## Progress Reporting
 *
 * Progress is reported at two granularities:
 * - Per-file: overall operation progress
 * - Per-transcode: transcoding percentage for long videos
 *
 * @module
 */

import type { SyncProgress, SyncOperation, ExecuteOptions } from './types.js';
import type { VideoSyncPlan } from './video-planner.js';
import type { VideoTranscodeProgress } from '../video/transcode.js';

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

// =============================================================================
// Interface
// =============================================================================

/**
 * Interface for executing video sync plans
 *
 * This interface defines the contract for video sync executors.
 * Full implementation depends on iPod database video support.
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
   * const executor = createVideoExecutor(deps);
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
// Placeholder Implementation
// =============================================================================

/**
 * Placeholder video sync executor
 *
 * This is a minimal implementation that will be replaced when
 * iPod database video support is complete (TASK-069.14).
 *
 * Currently only supports dry-run mode.
 */
export class PlaceholderVideoSyncExecutor implements VideoSyncExecutor {
  /**
   * Execute a video sync plan (dry-run only)
   */
  async *execute(
    plan: VideoSyncPlan,
    options: VideoExecuteOptions = {}
  ): AsyncIterable<VideoExecutorProgress> {
    const { dryRun = true } = options;

    if (!dryRun) {
      throw new Error(
        'Video sync execution not yet implemented. ' +
        'iPod database video support required (TASK-069.14). ' +
        'Use dryRun: true for planning only.'
      );
    }

    const total = plan.operations.length;
    let bytesProcessed = 0;

    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]!;

      // Get phase name based on operation type
      const phase = operation.type === 'video-transcode'
        ? 'video-transcoding'
        : operation.type === 'video-copy'
          ? 'video-copying'
          : 'preparing';

      // Get display name for the operation
      const currentTrack = getVideoOperationDisplayName(operation);

      yield {
        phase,
        operation,
        index,
        current: index,
        total,
        currentTrack,
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
    case 'video-copy':
      return operation.source.title;
    default:
      return 'Unknown operation';
  }
}

/**
 * Create a placeholder video sync executor
 *
 * This returns a placeholder implementation that only supports dry-run mode.
 * Full implementation will be available when iPod database video support
 * is complete (TASK-069.14).
 */
export function createVideoExecutor(): VideoSyncExecutor {
  return new PlaceholderVideoSyncExecutor();
}
