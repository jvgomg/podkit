/**
 * Sync executor - executes sync plans
 *
 * The executor takes a SyncPlan (from the planner) and executes each operation:
 * - transcode: Convert audio with FFmpeg, then add to iPod
 * - copy: Add track to iPod directly
 * - remove: Remove track from iPod database
 *
 * Features:
 * - Progress reporting via async iterator
 * - Dry-run mode (simulate without writing)
 * - Error handling with continue-on-error option
 * - Abort signal support for cancellation
 *
 * @module
 */

import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { CollectionTrack } from '../adapters/interface.js';
import type { FFmpegTranscoder } from '../transcode/ffmpeg.js';
import { PRESETS, type TranscodePreset } from '../transcode/types.js';
import type {
  ExecuteOptions,
  SyncExecutor,
  SyncOperation,
  SyncPlan,
  SyncProgress,
  TranscodePresetRef,
} from './types.js';
import type { IpodDatabase, IPodTrack as IpodDatabaseTrack, TrackInput } from '../ipod/index.js';

// =============================================================================
// Extended Types
// =============================================================================

/**
 * Error category for determining retry behavior and reporting
 */
export type ErrorCategory =
  | 'transcode' // FFmpeg failure - retry once
  | 'copy' // File copy failure - retry once
  | 'database' // iPod database error - no retry
  | 'artwork' // Artwork error - skip artwork only, continue sync
  | 'unknown'; // Other errors - no retry

/**
 * Extended error with category information
 */
export interface CategorizedError {
  /** The original error */
  error: Error;
  /** Category of the error */
  category: ErrorCategory;
  /** Track identifier for display */
  trackName: string;
  /** Number of retry attempts made */
  retryAttempts: number;
  /** Whether this error type was retried */
  wasRetried: boolean;
}

/**
 * Extended progress information for sync operations
 */
export interface ExecutorProgress extends SyncProgress {
  /** Current operation being executed */
  operation: SyncOperation;
  /** Index of current operation (0-based) */
  index: number;
  /** Error if operation failed */
  error?: Error;
  /** Categorized error with additional context */
  categorizedError?: CategorizedError;
  /** Whether this operation was skipped (dry-run) */
  skipped?: boolean;
  /** Current retry attempt (0 = first try, 1 = first retry) */
  retryAttempt?: number;
}

/**
 * Retry configuration for different operation types
 */
export interface RetryConfig {
  /** Number of retries for transcode operations (default: 1) */
  transcodeRetries?: number;
  /** Number of retries for copy operations (default: 1) */
  copyRetries?: number;
  /** Number of retries for database operations (default: 0) */
  databaseRetries?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  transcodeRetries: 1,
  copyRetries: 1,
  databaseRetries: 0, // Database errors are usually persistent
  retryDelayMs: 1000,
};

/**
 * Extended options for sync execution
 */
export interface ExtendedExecuteOptions extends ExecuteOptions {
  /** Continue executing remaining operations after an error */
  continueOnError?: boolean;
  /** Temporary directory for transcoded files (defaults to system temp) */
  tempDir?: string;
  /** Retry configuration for failed operations */
  retryConfig?: RetryConfig;
}

/**
 * Result of sync execution
 */
export interface ExecuteResult {
  /** Number of operations completed successfully */
  completed: number;
  /** Number of operations that failed */
  failed: number;
  /** Number of operations skipped (dry-run) */
  skipped: number;
  /** Errors encountered during execution (legacy format) */
  errors: Array<{ operation: SyncOperation; error: Error }>;
  /** Categorized errors with full context */
  categorizedErrors: CategorizedError[];
  /** Total bytes transferred */
  bytesTransferred: number;
}

/**
 * Dependencies required by the executor
 */
export interface ExecutorDependencies {
  /** iPod database connection (high-level IpodDatabase API) */
  ipod: IpodDatabase;
  /** FFmpeg transcoder for audio conversion */
  transcoder: FFmpegTranscoder;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the preset configuration from a preset reference
 */
function getPreset(ref: TranscodePresetRef): TranscodePreset {
  if (ref.name === 'custom') {
    return PRESETS.medium;
  }
  return PRESETS[ref.name];
}

/**
 * Convert CollectionTrack to TrackInput for libgpod
 */
function toTrackInput(track: CollectionTrack): TrackInput {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    genre: track.genre,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    duration: track.duration,
  };
}

/**
 * Get a display name for an operation (for progress reporting)
 */
export function getOperationDisplayName(operation: SyncOperation): string {
  switch (operation.type) {
    case 'transcode':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'remove':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'update-metadata':
      return `${operation.track.artist} - ${operation.track.title}`;
  }
}

/**
 * Calculate total bytes for a plan
 */
function calculateTotalBytes(plan: SyncPlan): number {
  // Use the estimated size from the plan
  return plan.estimatedSize;
}

/**
 * Categorize an error based on its message and operation type
 *
 * Priority order:
 * 1. Check error message for specific keywords (most reliable)
 * 2. Fall back to operation type as a hint
 */
export function categorizeError(
  error: Error,
  operationType: SyncOperation['type']
): ErrorCategory {
  const message = error.message.toLowerCase();

  // Check for database errors FIRST (most specific, no retry)
  if (
    message.includes('database') ||
    message.includes('itunes') ||
    message.includes('libgpod') ||
    message.includes('ipod')
  ) {
    return 'database';
  }

  // Check for artwork errors (no retry, but continue sync)
  if (message.includes('artwork') || message.includes('image')) {
    return 'artwork';
  }

  // Check for file I/O errors (retry once)
  if (
    message.includes('enoent') ||
    message.includes('eacces') ||
    message.includes('enospc') ||
    message.includes('file not found') ||
    message.includes('permission denied') ||
    message.includes('no space')
  ) {
    return 'copy';
  }

  // Check for FFmpeg/transcode related errors (retry once)
  if (
    message.includes('ffmpeg') ||
    message.includes('transcode') ||
    message.includes('encoder') ||
    message.includes('codec')
  ) {
    return 'transcode';
  }

  // Fall back to operation type as a hint for generic errors
  if (operationType === 'transcode') {
    return 'transcode';
  }
  if (operationType === 'copy') {
    return 'copy';
  }

  return 'unknown';
}

/**
 * Get the number of retries allowed for an error category
 */
export function getRetriesForCategory(
  category: ErrorCategory,
  config: Required<RetryConfig>
): number {
  switch (category) {
    case 'transcode':
      return config.transcodeRetries;
    case 'copy':
      return config.copyRetries;
    case 'database':
      return config.databaseRetries;
    case 'artwork':
      return 0; // Artwork errors should skip artwork, not retry
    case 'unknown':
      return 0;
  }
}

/**
 * Create a categorized error object
 */
export function createCategorizedError(
  error: Error,
  operation: SyncOperation,
  retryAttempts: number,
  wasRetried: boolean
): CategorizedError {
  return {
    error,
    category: categorizeError(error, operation.type),
    trackName: getOperationDisplayName(operation),
    retryAttempts,
    wasRetried,
  };
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Executor Implementation
// =============================================================================

/**
 * Default sync executor implementation
 */
export class DefaultSyncExecutor implements SyncExecutor {
  private ipod: IpodDatabase;
  private transcoder: FFmpegTranscoder;

  constructor(deps: ExecutorDependencies) {
    this.ipod = deps.ipod;
    this.transcoder = deps.transcoder;
  }

  /**
   * Execute a sync plan
   *
   * Yields progress updates for each operation. In dry-run mode,
   * operations are simulated without making actual changes.
   *
   * Retry behavior:
   * - Transcode failures: retry once (might be transient)
   * - Copy failures: retry once (might be transient I/O)
   * - Database errors: do NOT retry (likely persistent)
   * - Artwork errors: do NOT retry (skip artwork, continue sync)
   */
  async *execute(
    plan: SyncPlan,
    options: ExtendedExecuteOptions = {}
  ): AsyncIterable<ExecutorProgress> {
    const {
      dryRun = false,
      continueOnError = false,
      signal,
      tempDir = tmpdir(),
      retryConfig = {},
    } = options;

    // Merge retry config with defaults
    const mergedRetryConfig: Required<RetryConfig> = {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
    };

    const total = plan.operations.length;
    const totalBytes = calculateTotalBytes(plan);
    let bytesProcessed = 0;
    let completed = 0;
    let failed = 0;
    // Track skipped operations for dry-run mode
    let _skipped = 0;

    // Create temp directory for transcoded files if needed
    const transcodeDir = join(tempDir, `podkit-transcode-${randomUUID()}`);
    const hasTranscodes = plan.operations.some((op) => op.type === 'transcode');
    if (hasTranscodes && !dryRun) {
      await mkdir(transcodeDir, { recursive: true });
    }

    try {
      for (let index = 0; index < plan.operations.length; index++) {
        const operation = plan.operations[index]!;

        // Check for abort signal
        if (signal?.aborted) {
          throw new Error('Sync aborted');
        }

        // Determine phase based on operation type
        const phase = getPhaseForOperation(operation);

        // Emit preparing progress
        yield {
          phase: 'preparing',
          operation,
          index,
          current: index,
          total,
          currentTrack: getOperationDisplayName(operation),
          bytesProcessed,
          bytesTotal: totalBytes,
        };

        if (dryRun) {
          // Dry-run: simulate the operation
          yield {
            phase,
            operation,
            index,
            current: index,
            total,
            currentTrack: getOperationDisplayName(operation),
            bytesProcessed,
            bytesTotal: totalBytes,
            skipped: true,
          };
          _skipped++;
        } else {
          // Execute with retry logic
          let lastError: Error | undefined;
          let retryAttempt = 0;
          let success = false;

          // Determine max retries based on operation type
          const category = categorizeError(
            new Error('placeholder'),
            operation.type
          );
          // Override category for known operation types
          const effectiveCategory =
            operation.type === 'transcode'
              ? 'transcode'
              : operation.type === 'copy'
                ? 'copy'
                : category;
          const maxRetries = getRetriesForCategory(
            effectiveCategory,
            mergedRetryConfig
          );

          while (!success && retryAttempt <= maxRetries) {
            // Check abort signal before each attempt
            if (signal?.aborted) {
              throw new Error('Sync aborted');
            }

            try {
              const result = await this.executeOperation(
                operation,
                transcodeDir,
                signal
              );

              bytesProcessed += result.bytesTransferred;
              completed++;
              success = true;

              yield {
                phase,
                operation,
                index,
                current: index,
                total,
                currentTrack: getOperationDisplayName(operation),
                bytesProcessed,
                bytesTotal: totalBytes,
                retryAttempt: retryAttempt > 0 ? retryAttempt : undefined,
              };
            } catch (error) {
              lastError =
                error instanceof Error ? error : new Error(String(error));
              const errorCategory = categorizeError(lastError, operation.type);
              const retriesForThisError = getRetriesForCategory(
                errorCategory,
                mergedRetryConfig
              );

              // Check if we should retry this specific error
              if (retryAttempt < retriesForThisError) {
                retryAttempt++;
                // Wait before retry
                if (mergedRetryConfig.retryDelayMs > 0) {
                  await sleep(mergedRetryConfig.retryDelayMs);
                }
                // Continue to next iteration (retry)
              } else {
                // No more retries available
                break;
              }
            }
          }

          // If we exhausted retries and still failed
          if (!success && lastError) {
            failed++;
            const categorizedError = createCategorizedError(
              lastError,
              operation,
              retryAttempt,
              retryAttempt > 0
            );

            yield {
              phase,
              operation,
              index,
              current: index,
              total,
              currentTrack: getOperationDisplayName(operation),
              bytesProcessed,
              bytesTotal: totalBytes,
              error: lastError,
              categorizedError,
              retryAttempt,
            };

            if (!continueOnError) {
              throw lastError;
            }
          }
        }
      }

      // Save database after all operations (unless dry-run)
      if (!dryRun && (completed > 0 || failed > 0)) {
        yield {
          phase: 'updating-db',
          operation: plan.operations[plan.operations.length - 1]!,
          index: plan.operations.length - 1,
          current: plan.operations.length - 1,
          total,
          currentTrack: 'Saving iPod database',
          bytesProcessed,
          bytesTotal: totalBytes,
        };

        await this.ipod.save();
      }

      // Emit completion
      yield {
        phase: 'complete',
        operation: plan.operations[plan.operations.length - 1]!,
        index: plan.operations.length - 1,
        current: plan.operations.length - 1,
        total,
        bytesProcessed,
        bytesTotal: totalBytes,
      };
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
   * Execute a single sync operation
   */
  private async executeOperation(
    operation: SyncOperation,
    transcodeDir: string,
    signal?: AbortSignal
  ): Promise<{ bytesTransferred: number; track?: IpodDatabaseTrack }> {
    switch (operation.type) {
      case 'transcode':
        return this.executeTranscode(operation, transcodeDir, signal);
      case 'copy':
        return this.executeCopy(operation);
      case 'remove':
        return this.executeRemove(operation);
      case 'update-metadata':
        // TODO: Implement metadata updates
        return { bytesTransferred: 0 };
    }
  }

  /**
   * Execute a transcode operation
   */
  private async executeTranscode(
    operation: Extract<SyncOperation, { type: 'transcode' }>,
    transcodeDir: string,
    signal?: AbortSignal
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { source, preset: presetRef } = operation;
    const preset = getPreset(presetRef);

    // Generate output path in temp directory
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}.m4a`);

    // Transcode the file
    const result = await this.transcoder.transcode(
      source.filePath,
      outputPath,
      preset,
      { signal }
    );

    // Add track to iPod database using IpodDatabase API
    const trackInput: TrackInput = {
      ...toTrackInput(source),
      bitrate: result.bitrate,
      filetype: 'AAC audio file',
    };

    const track = this.ipod.addTrack(trackInput);

    // Copy transcoded file to iPod using the fluent IPodTrack API
    track.copyFile(outputPath);

    return { bytesTransferred: result.size, track };
  }

  /**
   * Execute a copy operation
   */
  private async executeCopy(
    operation: Extract<SyncOperation, { type: 'copy' }>
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { source } = operation;

    // Determine filetype based on extension
    const ext = extname(source.filePath).toLowerCase();
    let filetype: string;
    switch (ext) {
      case '.mp3':
        filetype = 'MPEG audio file';
        break;
      case '.m4a':
      case '.aac':
        filetype = 'AAC audio file';
        break;
      case '.alac':
        filetype = 'Apple Lossless audio file';
        break;
      default:
        filetype = 'Audio file';
    }

    // Add track to iPod database using IpodDatabase API
    const trackInput: TrackInput = {
      ...toTrackInput(source),
      filetype,
    };

    const track = this.ipod.addTrack(trackInput);

    // Copy source file to iPod using the fluent IPodTrack API
    track.copyFile(source.filePath);

    // Estimate bytes transferred (we don't have actual file size)
    const bytesTransferred = source.duration
      ? Math.round((source.duration / 1000) * 32000) // ~256 kbps estimate
      : 5000000; // default 5MB

    return { bytesTransferred, track };
  }

  /**
   * Execute a remove operation
   */
  private async executeRemove(
    operation: Extract<SyncOperation, { type: 'remove' }>
  ): Promise<{ bytesTransferred: number }> {
    const { track: targetTrack } = operation;

    // The SyncOperation uses the old IPodTrack from sync/types.ts (data-only interface)
    // We need to find the matching track in IpodDatabase and remove it
    const tracks = this.ipod.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.title === targetTrack.title &&
        t.artist === targetTrack.artist &&
        t.album === targetTrack.album
    );

    if (!foundTrack) {
      throw new Error(
        `Track not found in database: ${targetTrack.artist} - ${targetTrack.title}`
      );
    }

    // Remove using the fluent IPodTrack API
    foundTrack.remove();

    return { bytesTransferred: 0 };
  }
}

/**
 * Get the phase name for an operation type
 */
function getPhaseForOperation(
  operation: SyncOperation
): SyncProgress['phase'] {
  switch (operation.type) {
    case 'transcode':
      return 'transcoding';
    case 'copy':
      return 'copying';
    case 'remove':
      return 'removing';
    case 'update-metadata':
      return 'updating-db';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new sync executor
 */
export function createExecutor(deps: ExecutorDependencies): SyncExecutor {
  return new DefaultSyncExecutor(deps);
}

/**
 * Execute a sync plan with simplified interface
 *
 * This is a convenience function that collects all progress events
 * and returns a final result.
 */
export async function executePlan(
  plan: SyncPlan,
  deps: ExecutorDependencies,
  options: ExtendedExecuteOptions = {}
): Promise<ExecuteResult> {
  const executor = new DefaultSyncExecutor(deps);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytesTransferred = 0;
  const errors: Array<{ operation: SyncOperation; error: Error }> = [];
  const categorizedErrors: CategorizedError[] = [];

  for await (const progress of executor.execute(plan, options)) {
    if (progress.phase === 'complete') {
      // Final progress
    } else if (progress.error) {
      failed++;
      errors.push({ operation: progress.operation, error: progress.error });
      if (progress.categorizedError) {
        categorizedErrors.push(progress.categorizedError);
      } else {
        // Create a categorized error if not provided
        categorizedErrors.push(
          createCategorizedError(progress.error, progress.operation, 0, false)
        );
      }
    } else if (progress.skipped) {
      skipped++;
    } else if (
      progress.phase !== 'preparing' &&
      progress.phase !== 'updating-db'
    ) {
      completed++;
    }

    bytesTransferred = progress.bytesProcessed;
  }

  return {
    completed,
    failed,
    skipped,
    errors,
    categorizedErrors,
    bytesTransferred,
  };
}
