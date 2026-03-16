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

import { mkdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { AsyncQueue } from './async-queue.js';
import { streamToTempFile, cleanupTempFile } from '../utils/stream.js';
import { buildAudioSyncTag, parseSyncTag, writeSyncTag } from './sync-tags.js';
import type { SyncTagData } from './sync-tags.js';

import type { CollectionTrack, CollectionAdapter } from '../adapters/interface.js';
import type { FFmpegTranscoder } from '../transcode/ffmpeg.js';
import type {
  ExecuteOptions,
  SyncExecutor,
  SyncOperation,
  SyncPlan,
  SyncProgress,
} from './types.js';
import type { IpodDatabase, IPodTrack as IpodDatabaseTrack, TrackInput } from '../ipod/index.js';
import { extractArtwork } from '../artwork/extractor.js';

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
 * Warning type for non-fatal issues during sync execution
 */
export type ExecutionWarningType = 'artwork' | 'metadata';

/**
 * A non-fatal warning generated during sync execution
 *
 * Warnings represent issues that don't prevent the sync from completing
 * (e.g., artwork extraction failures) but should be reported to the user.
 */
export interface ExecutionWarning {
  /** Type of warning */
  type: ExecutionWarningType;
  /** Track that triggered the warning */
  track: { artist: string; title: string; album?: string };
  /** Human-readable description of the issue */
  message: string;
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
/**
 * Configuration for writing sync tags to iPod tracks.
 *
 * When provided, sync tags are written to the comment field of transcoded
 * tracks, enabling exact preset change detection on future syncs.
 */
export interface SyncTagConfig {
  /** Encoding mode: 'vbr' | 'cbr' */
  encodingMode?: string;
  /** Custom bitrate override (only when explicitly set by user) */
  customBitrate?: number;
}

export interface ExtendedExecuteOptions extends ExecuteOptions {
  /** Continue executing remaining operations after an error */
  continueOnError?: boolean;
  /** Temporary directory for transcoded files (defaults to system temp) */
  tempDir?: string;
  /** Retry configuration for failed operations */
  retryConfig?: RetryConfig;
  /**
   * Collection adapter for resolving file access
   *
   * Required for remote sources (e.g., Subsonic) to stream files.
   * Optional for local sources where filePath is directly usable.
   */
  adapter?: CollectionAdapter;
  /**
   * Sync tag configuration for writing transcode metadata to iPod tracks.
   *
   * When provided, the executor writes sync tags (e.g., `[podkit:v1 quality=high encoding=vbr]`)
   * to the comment field of transcoded tracks. This enables exact preset change detection
   * without bitrate tolerance comparison.
   *
   * The resolved quality preset name comes from the operation's preset ref;
   * this config supplies the encoding mode and optional custom bitrate.
   */
  syncTagConfig?: SyncTagConfig;
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
  /** Non-fatal warnings (e.g., artwork extraction failures) */
  warnings: ExecutionWarning[];
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

/**
 * A file that has been prepared for transfer to iPod.
 *
 * For transcode operations, this contains the path to the transcoded temp file.
 * For copy operations, this contains the path to the original source file.
 */
export interface PreparedFile {
  /** The sync operation this file is for */
  operation: Extract<SyncOperation, { type: 'transcode' | 'copy' | 'upgrade' }>;
  /** Path to the file to transfer (temp file for transcode, source for copy) */
  sourcePath: string;
  /** Whether this is a temp file that should be deleted after transfer */
  isTemp: boolean;
  /** Size of the file in bytes */
  size: number;
  /** Bitrate for transcoded files (used for database entry) */
  bitrate?: number;
  /** Filetype string for database entry */
  filetype: string;
  /** Number of retry attempts during prepare phase (0 = first try succeeded) */
  prepareAttempts?: number;
  /**
   * Path to use for artwork extraction
   * For local files, this is the original file path.
   * For remote files, this is the path to the downloaded temp file.
   */
  artworkSourcePath: string;
  /**
   * Path to downloaded source file that needs cleanup after prepare
   * Set when source was streamed from a remote adapter.
   * For transcode ops, this is cleaned up after transcoding.
   * For copy ops, the sourcePath itself is the download (artworkSourcePath = sourcePath).
   */
  downloadedSourcePath?: string;
}

/** Default pipeline buffer size (number of prepared files to buffer) */
const PIPELINE_BUFFER_SIZE = 3;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolved file access with local path
 */
interface ResolvedFileAccess {
  /** Local path to the file (either original or downloaded temp) */
  path: string;
  /** Whether this is a downloaded temp file that needs cleanup */
  isDownloaded: boolean;
  /** File size in bytes (if known from stream metadata) */
  size?: number;
}

/**
 * Resolve file access for a track, downloading if necessary
 *
 * For local sources (path-based), returns the path directly.
 * For remote sources (stream-based), downloads to a temp file.
 *
 * @param adapter - Collection adapter to get file access from
 * @param track - Track to resolve file access for
 * @returns Resolved file access with local path
 */
async function resolveFileAccess(
  adapter: CollectionAdapter,
  track: CollectionTrack
): Promise<ResolvedFileAccess> {
  const access = await adapter.getFileAccess(track);

  if (access.type === 'path') {
    return {
      path: access.path,
      isDownloaded: false,
    };
  }

  // Stream-based access - download to temp file
  const tempPath = await streamToTempFile(access.getStream, access.size);
  return {
    path: tempPath,
    isDownloaded: true,
    size: access.size,
  };
}

/**
 * Get file access path for a track, using adapter if provided
 *
 * When no adapter is provided, falls back to track.filePath (legacy behavior).
 * This allows gradual migration and backward compatibility.
 *
 * @param track - Track to get file path for
 * @param adapter - Optional adapter for resolving file access
 * @returns Resolved file access
 */
async function getTrackFilePath(
  track: CollectionTrack,
  adapter?: CollectionAdapter
): Promise<ResolvedFileAccess> {
  if (adapter) {
    return resolveFileAccess(adapter, track);
  }

  // Legacy fallback: use track.filePath directly
  return {
    path: track.filePath,
    isDownloaded: false,
  };
}

/**
 * Get a human-readable filetype label based on file extension.
 *
 * Used for the iPod database `filetype` field which displays the format
 * in iTunes and on the device.
 */
function getFileTypeLabel(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3':
      return 'MPEG audio file';
    case '.m4a':
    case '.aac':
      return 'AAC audio file';
    case '.alac':
      return 'Apple Lossless audio file';
    default:
      return 'Audio file';
  }
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
    compilation: track.compilation,
    duration: track.duration,
    bitrate: track.bitrate,
    soundcheck: track.soundcheck,
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
    case 'upgrade':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'video-transcode':
    case 'video-copy':
      return operation.source.title;
    case 'video-remove':
      return operation.video.title;
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
export function categorizeError(error: Error, operationType: SyncOperation['type']): ErrorCategory {
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
  if (operationType === 'upgrade') {
    return 'copy'; // Upgrade errors are treated like copy errors for retry purposes
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
  /** Warnings collected during execution */
  private warnings: ExecutionWarning[] = [];
  /** Sync tag config for the current execution (set during execute()) */
  private syncTagConfig?: SyncTagConfig;

  constructor(deps: ExecutorDependencies) {
    this.ipod = deps.ipod;
    this.transcoder = deps.transcoder;
  }

  /**
   * Get warnings collected during the most recent execution
   */
  getWarnings(): ExecutionWarning[] {
    return [...this.warnings];
  }

  /**
   * Clear collected warnings (called at start of each execution)
   */
  private clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Add a warning to the collection
   */
  private addWarning(warning: ExecutionWarning): void {
    this.warnings.push(warning);
  }

  /**
   * Execute a sync plan using a pipeline architecture.
   *
   * Transcoding and USB transfer happen in parallel:
   * - Producer: prepares files (transcode to temp, or identify copy source)
   * - Consumer: transfers files to iPod (USB I/O bound)
   *
   * This keeps the USB bus saturated during transcoding.
   *
   * In dry-run mode, operations are simulated without making actual changes.
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
      artwork = true,
      adapter,
      syncTagConfig,
    } = options;

    // Store sync tag config for use during transfer
    this.syncTagConfig = syncTagConfig;

    // Clear warnings from previous execution
    this.clearWarnings();

    // Merge retry config with defaults
    const mergedRetryConfig: Required<RetryConfig> = {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
    };

    const totalBytes = calculateTotalBytes(plan);

    // Create temp directory for transcoded files if needed
    const transcodeDir = join(tempDir, `podkit-transcode-${randomUUID()}`);
    const hasTranscodes = plan.operations.some(
      (op) => op.type === 'transcode' || (op.type === 'upgrade' && op.preset !== undefined)
    );
    if (hasTranscodes && !dryRun) {
      await mkdir(transcodeDir, { recursive: true });
    }

    try {
      // In dry-run mode, use sequential execution (no actual work to pipeline)
      if (dryRun) {
        yield* this.executeDryRun(plan, totalBytes);
        return;
      }

      // Pipeline execution for real sync
      yield* this.executePipeline(
        plan,
        totalBytes,
        transcodeDir,
        mergedRetryConfig,
        continueOnError,
        artwork,
        adapter,
        signal
      );
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
   * Execute sync plan in dry-run mode (sequential, no actual work)
   */
  private async *executeDryRun(
    plan: SyncPlan,
    totalBytes: number
  ): AsyncIterable<ExecutorProgress> {
    const total = plan.operations.length;
    const bytesProcessed = 0;

    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]!;
      const phase = getPhaseForOperation(operation);

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
        bytesTotal: totalBytes,
      };
    }
  }

  /**
   * Execute sync plan using pipeline architecture.
   *
   * Producer prepares files (transcode/copy) and pushes to transfer queue.
   * Consumer transfers files to iPod and yields progress.
   * Remove/update-metadata operations execute inline in producer.
   */
  private async *executePipeline(
    plan: SyncPlan,
    totalBytes: number,
    transcodeDir: string,
    retryConfig: Required<RetryConfig>,
    continueOnError: boolean,
    artworkEnabled: boolean,
    adapter?: CollectionAdapter,
    signal?: AbortSignal
  ): AsyncIterable<ExecutorProgress> {
    const total = plan.operations.length;
    const transferQueue = new AsyncQueue<PreparedFile>(PIPELINE_BUFFER_SIZE);

    // Shared state between producer and consumer
    let bytesProcessed = 0;
    let completed = 0;
    let failed = 0;
    let inlineCompleted = 0;
    let producerError: Error | undefined;
    let abortRequested = false;

    // Track errors for yielding
    interface FailedOperation {
      operation: SyncOperation;
      error: Error;
      attempts: number;
    }
    const producerFailures: FailedOperation[] = [];

    // Track completed inline operations (remove/update-metadata) for yielding
    const inlineCompletions: SyncOperation[] = [];

    // Producer: prepare files and handle inline operations
    const producer = async () => {
      for (const operation of plan.operations) {
        // Check for abort
        if (signal?.aborted || abortRequested) {
          break;
        }

        try {
          if (operation.type === 'transcode') {
            const result = await this.prepareWithRetry(
              () => this.prepareTranscode(operation, transcodeDir, adapter, signal),
              operation,
              retryConfig
            );
            if (result.value) {
              await transferQueue.push(result.value);
            } else {
              // Prepare failed after retries
              producerFailures.push({ operation, error: result.error, attempts: result.attempts });
              failed++;
              if (!continueOnError) {
                producerError = result.error;
                abortRequested = true;
                break;
              }
            }
          } else if (operation.type === 'copy') {
            const result = await this.prepareWithRetry(
              () => this.prepareCopy(operation, adapter),
              operation,
              retryConfig
            );
            if (result.value) {
              await transferQueue.push(result.value);
            } else {
              producerFailures.push({ operation, error: result.error, attempts: result.attempts });
              failed++;
              if (!continueOnError) {
                producerError = result.error;
                abortRequested = true;
                break;
              }
            }
          } else if (operation.type === 'upgrade') {
            const result = await this.prepareWithRetry(
              () => this.prepareUpgrade(operation, transcodeDir, adapter, signal),
              operation,
              retryConfig
            );
            if (result.value) {
              await transferQueue.push(result.value);
            } else {
              producerFailures.push({ operation, error: result.error, attempts: result.attempts });
              failed++;
              if (!continueOnError) {
                producerError = result.error;
                abortRequested = true;
                break;
              }
            }
          } else if (operation.type === 'remove') {
            await this.executeRemove(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          } else if (operation.type === 'update-metadata') {
            await this.executeUpdateMetadata(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          producerFailures.push({ operation, error: err, attempts: 0 });
          failed++;
          if (!continueOnError) {
            producerError = err;
            abortRequested = true;
            break;
          }
        }
      }
      transferQueue.close();
    };

    // Start producer in background
    const producerPromise = producer();

    // Consumer: transfer files and yield progress
    for await (const prepared of transferQueue) {
      // Check for abort - but drain queue on abort (don't waste transcoded files)
      if (signal?.aborted) {
        // On abort, still transfer remaining items in queue (drain)
        // but stop after this batch
        abortRequested = true;
      }

      try {
        const result = await this.transferWithRetry(prepared, artworkEnabled, retryConfig);

        if (result.value) {
          bytesProcessed += result.value.bytesTransferred;
          completed++;

          // Total retry attempts = prepare phase + transfer phase
          const totalRetries = (prepared.prepareAttempts ?? 0) + (result.attempts ?? 0);

          yield {
            phase: getPhaseForOperation(prepared.operation),
            operation: prepared.operation,
            index: completed + failed + inlineCompleted - 1,
            current: completed + failed + inlineCompleted,
            total,
            currentTrack: getOperationDisplayName(prepared.operation),
            bytesProcessed,
            bytesTotal: totalBytes,
            // Include retry attempt if there were retries
            ...(totalRetries > 0 ? { retryAttempt: totalRetries } : {}),
          };
        } else {
          // Transfer failed after retries
          failed++;
          const categorizedError = createCategorizedError(
            result.error,
            prepared.operation,
            result.attempts,
            result.attempts > 0
          );

          yield {
            phase: getPhaseForOperation(prepared.operation),
            operation: prepared.operation,
            index: completed + failed + inlineCompleted - 1,
            current: completed + failed + inlineCompleted,
            total,
            currentTrack: getOperationDisplayName(prepared.operation),
            bytesProcessed,
            bytesTotal: totalBytes,
            error: result.error,
            categorizedError,
          };

          if (!continueOnError) {
            abortRequested = true;
            // Don't process remaining items
            await this.cleanupPreparedFile(prepared);
            break;
          }
        }
      } finally {
        await this.cleanupPreparedFile(prepared);
      }
    }

    // Yield progress for producer failures (errors that happened during prepare phase)
    for (const failure of producerFailures) {
      const categorizedError = createCategorizedError(
        failure.error,
        failure.operation,
        failure.attempts,
        failure.attempts > 0
      );

      yield {
        phase: getPhaseForOperation(failure.operation),
        operation: failure.operation,
        index: completed + failed + inlineCompleted - 1,
        current: completed + failed + inlineCompleted,
        total,
        currentTrack: getOperationDisplayName(failure.operation),
        bytesProcessed,
        bytesTotal: totalBytes,
        error: failure.error,
        categorizedError,
      };
    }

    // Yield progress for completed inline operations (remove/update-metadata)
    for (const operation of inlineCompletions) {
      yield {
        phase: getPhaseForOperation(operation),
        operation,
        index: completed + failed + inlineCompleted - 1,
        current: completed + failed + inlineCompleted,
        total,
        currentTrack: getOperationDisplayName(operation),
        bytesProcessed,
        bytesTotal: totalBytes,
      };
    }

    // Wait for producer to finish
    await producerPromise;

    // If aborted, throw after draining (we finished transferring queued files)
    if (signal?.aborted) {
      throw new Error('Sync aborted');
    }

    // If producer had a fatal error, throw it
    if (producerError && !continueOnError) {
      throw producerError;
    }

    // Save database after all operations
    if (completed > 0 || inlineCompleted > 0 || failed > 0) {
      const lastOp = plan.operations[plan.operations.length - 1]!;
      yield {
        phase: 'updating-db',
        operation: lastOp,
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
    if (plan.operations.length > 0) {
      yield {
        phase: 'complete',
        operation: plan.operations[plan.operations.length - 1]!,
        index: plan.operations.length - 1,
        current: plan.operations.length - 1,
        total,
        bytesProcessed,
        bytesTotal: totalBytes,
      };
    }
  }

  /**
   * Result from a retry operation, including success/failure and error details
   */
  private prepareWithRetryResult<T>(
    value: T | null,
    error: Error | undefined,
    attempts: number
  ): { value: T; error?: undefined } | { value: null; error: Error; attempts: number } {
    if (value !== null) {
      return { value };
    }
    return { value: null, error: error!, attempts };
  }

  /**
   * Prepare a file with retry logic
   */
  private async prepareWithRetry(
    prepareFn: () => Promise<PreparedFile>,
    operation: SyncOperation,
    retryConfig: Required<RetryConfig>
  ): Promise<
    | { value: PreparedFile; error?: undefined; attempts: number }
    | { value: null; error: Error; attempts: number }
  > {
    const maxRetries =
      operation.type === 'transcode' ||
      (operation.type === 'upgrade' &&
        (operation as Extract<SyncOperation, { type: 'upgrade' }>).preset !== undefined)
        ? retryConfig.transcodeRetries
        : retryConfig.copyRetries;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await prepareFn();
        // Include prepare attempts in the result
        result.prepareAttempts = attempt;
        return { value: result, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries && retryConfig.retryDelayMs > 0) {
          await sleep(retryConfig.retryDelayMs);
        }
      }
    }

    return { value: null, error: lastError!, attempts: maxRetries };
  }

  /**
   * Transfer a prepared file with retry logic.
   *
   * Respects error categorization - database errors are not retried.
   */
  private async transferWithRetry(
    prepared: PreparedFile,
    artworkEnabled: boolean,
    retryConfig: Required<RetryConfig>
  ): Promise<
    | { value: { bytesTransferred: number }; error?: undefined; attempts?: number }
    | { value: null; error: Error; attempts: number }
  > {
    let lastError: Error | undefined;
    let attempt = 0;

    while (true) {
      try {
        const result = await this.transferToIpod(prepared, artworkEnabled);
        return { value: result, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this error type should be retried
        const errorCategory = categorizeError(lastError, prepared.operation.type);
        const maxRetries = getRetriesForCategory(errorCategory, retryConfig);

        if (attempt < maxRetries) {
          attempt++;
          if (retryConfig.retryDelayMs > 0) {
            await sleep(retryConfig.retryDelayMs);
          }
          // Continue to retry
        } else {
          // No more retries
          return { value: null, error: lastError, attempts: attempt };
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
    signal?: AbortSignal,
    artworkEnabled?: boolean
  ): Promise<{ bytesTransferred: number; track?: IpodDatabaseTrack }> {
    switch (operation.type) {
      case 'transcode':
        return this.executeTranscode(operation, transcodeDir, signal, artworkEnabled);
      case 'copy':
        return this.executeCopy(operation, artworkEnabled);
      case 'remove':
        return this.executeRemove(operation);
      case 'update-metadata':
        return this.executeUpdateMetadata(operation);
      case 'upgrade':
        // Upgrade operations are handled via the pipeline (prepare + transfer)
        throw new Error('Upgrade operations should be handled via the pipeline');
      case 'video-transcode':
      case 'video-copy':
      case 'video-remove':
        // Video operations are handled by VideoSyncExecutor, not this executor
        throw new Error(
          `Video operations (${operation.type}) should be handled by VideoSyncExecutor`
        );
    }
  }

  /**
   * Extract and transfer artwork for a track
   *
   * Handles artwork extraction from source file and transfers it to iPod.
   * Errors are caught and collected as warnings, but don't fail the sync operation.
   */
  private async transferArtwork(track: IpodDatabaseTrack, sourceFilePath: string): Promise<void> {
    try {
      const artwork = await extractArtwork(sourceFilePath);
      if (artwork) {
        track.setArtworkFromData(artwork.data);
      }
    } catch (error) {
      // Collect warning but don't fail the sync - artwork is optional
      this.addWarning({
        type: 'artwork',
        track: {
          artist: track.artist ?? 'Unknown Artist',
          title: track.title ?? 'Unknown Title',
          album: track.album,
        },
        message: `Failed to extract/transfer artwork: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  /**
   * Execute a transcode operation
   */
  private async executeTranscode(
    operation: Extract<SyncOperation, { type: 'transcode' }>,
    transcodeDir: string,
    signal?: AbortSignal,
    artworkEnabled?: boolean
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { source, preset: presetRef } = operation;

    // Generate output path in temp directory
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}.m4a`);

    // Transcode the file (using the quality preset name directly)
    const result = await this.transcoder.transcode(source.filePath, outputPath, presetRef.name, {
      signal,
    });

    // Add track to iPod database using IpodDatabase API
    const trackInput: TrackInput = {
      ...toTrackInput(source),
      bitrate: result.bitrate,
      filetype: 'AAC audio file',
    };

    const track = this.ipod.addTrack(trackInput);

    // Copy transcoded file to iPod using the fluent IPodTrack API
    track.copyFile(outputPath);

    // Extract and transfer artwork if enabled
    if (artworkEnabled) {
      await this.transferArtwork(track, source.filePath);
    }

    return { bytesTransferred: result.size, track };
  }

  /**
   * Execute a copy operation
   */
  private async executeCopy(
    operation: Extract<SyncOperation, { type: 'copy' }>,
    artworkEnabled?: boolean
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { source } = operation;

    // Add track to iPod database using IpodDatabase API
    const trackInput: TrackInput = {
      ...toTrackInput(source),
      filetype: getFileTypeLabel(source.filePath),
    };

    const track = this.ipod.addTrack(trackInput);

    // Copy source file to iPod using the fluent IPodTrack API
    track.copyFile(source.filePath);

    // Extract and transfer artwork if enabled
    if (artworkEnabled) {
      await this.transferArtwork(track, source.filePath);
    }

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
      throw new Error(`Track not found in database: ${targetTrack.artist} - ${targetTrack.title}`);
    }

    // Remove using the fluent IPodTrack API
    foundTrack.remove();

    return { bytesTransferred: 0 };
  }

  /**
   * Execute an update-metadata operation
   *
   * Updates iPod track metadata without transferring any files.
   * Used for transform changes (e.g., clean artists enable/disable) where
   * only artist/title fields need updating.
   *
   * Preserves play statistics (play count, rating, skip count).
   */
  private async executeUpdateMetadata(
    operation: Extract<SyncOperation, { type: 'update-metadata' }>
  ): Promise<{ bytesTransferred: number }> {
    const { track: targetTrack, metadata } = operation;

    // Find the matching track in the database
    // Use filePath as primary identifier when available (most reliable)
    const tracks = this.ipod.getTracks();
    let foundTrack = tracks.find((t) => t.filePath === targetTrack.filePath);

    // Fall back to metadata matching if filePath doesn't match
    // (can happen if the operation was created from a different session)
    if (!foundTrack) {
      foundTrack = tracks.find(
        (t) =>
          t.title === targetTrack.title &&
          t.artist === targetTrack.artist &&
          t.album === targetTrack.album
      );
    }

    if (!foundTrack) {
      throw new Error(`Track not found in database: ${targetTrack.artist} - ${targetTrack.title}`);
    }

    // Convert TrackMetadata to TrackFields format for update()
    // Only include fields that are actually being changed
    const updateFields: Parameters<IpodDatabaseTrack['update']>[0] = {};

    if (metadata.title !== undefined) {
      updateFields.title = metadata.title;
    }
    if (metadata.artist !== undefined) {
      updateFields.artist = metadata.artist;
    }
    if (metadata.album !== undefined) {
      updateFields.album = metadata.album;
    }
    if (metadata.albumArtist !== undefined) {
      updateFields.albumArtist = metadata.albumArtist;
    }
    if (metadata.genre !== undefined) {
      updateFields.genre = metadata.genre;
    }
    if (metadata.year !== undefined) {
      updateFields.year = metadata.year;
    }
    if (metadata.trackNumber !== undefined) {
      updateFields.trackNumber = metadata.trackNumber;
    }
    if (metadata.discNumber !== undefined) {
      updateFields.discNumber = metadata.discNumber;
    }
    if (metadata.compilation !== undefined) {
      updateFields.compilation = metadata.compilation;
    }
    if (metadata.soundcheck !== undefined) {
      updateFields.soundcheck = metadata.soundcheck;
    }
    if (metadata.comment !== undefined) {
      // For sync-tag-write: the comment value is a formatted sync tag string.
      // Parse it back to SyncTagData, then use writeSyncTag to merge it into
      // the track's existing comment (preserving any user text).
      const syncTagData = parseSyncTag(metadata.comment);
      if (syncTagData) {
        updateFields.comment = writeSyncTag(foundTrack.comment, syncTagData);
      } else {
        updateFields.comment = metadata.comment;
      }
    }

    // Update the track metadata (preserves play stats automatically)
    foundTrack.update(updateFields);

    // No bytes transferred for metadata-only updates
    return { bytesTransferred: 0 };
  }

  // ===========================================================================
  // Pipeline Methods (prepare/transfer separation)
  // ===========================================================================

  /**
   * Prepare a transcode operation by transcoding to a temp file.
   *
   * This is the CPU-bound part of the operation that can run in parallel
   * with USB transfers.
   *
   * For remote sources (via adapter), the source is first downloaded to a temp file,
   * then transcoded. The downloaded source is kept for artwork extraction and
   * cleaned up after transfer completes.
   */
  private async prepareTranscode(
    operation: Extract<SyncOperation, { type: 'transcode' }>,
    transcodeDir: string,
    adapter?: CollectionAdapter,
    signal?: AbortSignal
  ): Promise<PreparedFile> {
    const { source, preset: presetRef } = operation;

    // Resolve file access (may download from remote source)
    const fileAccess = await getTrackFilePath(source, adapter);
    const inputPath = fileAccess.path;

    // Generate output path in temp directory
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}.m4a`);

    // Transcode the file
    const result = await this.transcoder.transcode(inputPath, outputPath, presetRef.name, {
      signal,
    });

    return {
      operation,
      sourcePath: outputPath,
      isTemp: true,
      size: result.size,
      bitrate: result.bitrate,
      filetype: 'AAC audio file',
      // Use the resolved input path for artwork extraction
      artworkSourcePath: inputPath,
      // Track downloaded file for cleanup after transfer (for artwork extraction)
      downloadedSourcePath: fileAccess.isDownloaded ? inputPath : undefined,
    };
  }

  /**
   * Prepare a copy operation by getting file info.
   *
   * Copy operations don't need CPU work, so this just returns the source info.
   * For remote sources (via adapter), the file is downloaded to a temp location.
   */
  private async prepareCopy(
    operation: Extract<SyncOperation, { type: 'copy' }>,
    adapter?: CollectionAdapter
  ): Promise<PreparedFile> {
    const { source } = operation;

    // Resolve file access (may download from remote source)
    const fileAccess = await getTrackFilePath(source, adapter);
    const sourcePath = fileAccess.path;

    // Get actual file size
    let size: number;
    if (fileAccess.size !== undefined) {
      // Use size from file access (for remote sources)
      size = fileAccess.size;
    } else {
      try {
        const stats = await stat(sourcePath);
        size = stats.size;
      } catch {
        // Estimate size based on duration (fallback for tests or missing files)
        size = source.duration
          ? Math.round((source.duration / 1000) * 32000) // ~256 kbps estimate
          : 5000000; // default 5MB
      }
    }

    return {
      operation,
      sourcePath,
      // Mark as temp if downloaded from remote source
      isTemp: fileAccess.isDownloaded,
      size,
      filetype: getFileTypeLabel(source.filePath),
      // For copy operations, the source is also the artwork source
      artworkSourcePath: sourcePath,
      // No separate downloaded file - sourcePath IS the download for copy ops
      downloadedSourcePath: undefined,
    };
  }

  /**
   * Prepare an upgrade operation by transcoding or getting file info.
   *
   * Delegates to prepareTranscode when a preset is set (transcode needed),
   * or prepareCopy when no preset is set (direct file copy). The operation
   * field on the returned PreparedFile is rewritten to the upgrade operation
   * so the transfer phase can target the existing iPod track.
   */
  private async prepareUpgrade(
    operation: Extract<SyncOperation, { type: 'upgrade' }>,
    transcodeDir: string,
    adapter?: CollectionAdapter,
    signal?: AbortSignal
  ): Promise<PreparedFile> {
    if (operation.preset) {
      // Needs transcoding — delegate to prepareTranscode using a synthetic transcode op
      const transcodeOp: Extract<SyncOperation, { type: 'transcode' }> = {
        type: 'transcode',
        source: operation.source,
        preset: operation.preset,
      };
      const prepared = await this.prepareTranscode(transcodeOp, transcodeDir, adapter, signal);
      return { ...prepared, operation };
    } else {
      // Copy directly — delegate to prepareCopy using a synthetic copy op
      const copyOp: Extract<SyncOperation, { type: 'copy' }> = {
        type: 'copy',
        source: operation.source,
      };
      const prepared = await this.prepareCopy(copyOp, adapter);
      return { ...prepared, operation };
    }
  }

  /**
   * Transfer a prepared file to the iPod.
   *
   * This is the USB I/O-bound part of the operation. It adds the track to
   * the database, copies the file, and transfers artwork.
   *
   * For upgrade operations, replaces the existing file while preserving
   * the database entry (play counts, ratings, playlists).
   */
  private async transferToIpod(
    prepared: PreparedFile,
    artworkEnabled: boolean
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { operation, sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;

    // Upgrade operations: replace file on existing track
    if (operation.type === 'upgrade') {
      return this.transferUpgradeToIpod(prepared, artworkEnabled);
    }

    const source = operation.source;

    // Add track to iPod database
    const trackInput: TrackInput = {
      ...toTrackInput(source),
      filetype,
      ...(bitrate !== undefined && { bitrate }),
    };

    // Write sync tag for transcode operations (not copy operations)
    if (operation.type === 'transcode' && operation.preset) {
      const syncTag = this.buildSyncTagForPreset(operation.preset.name);
      if (syncTag) {
        trackInput.comment = writeSyncTag(trackInput.comment, syncTag);
      }
    }

    const track = this.ipod.addTrack(trackInput);

    // Copy file to iPod
    track.copyFile(sourcePath);

    // Extract and transfer artwork if enabled
    // Use artworkSourcePath which is the original source file (or downloaded temp for remote)
    if (artworkEnabled) {
      await this.transferArtwork(track, artworkSourcePath);
    }

    return { bytesTransferred: size, track };
  }

  /**
   * Transfer an upgrade file to the iPod, replacing the existing track's file.
   *
   * Preserves the database entry (play counts, ratings, playlist membership)
   * while swapping the audio file and updating technical metadata.
   */
  private async transferUpgradeToIpod(
    prepared: PreparedFile,
    artworkEnabled: boolean
  ): Promise<{ bytesTransferred: number; track: IpodDatabaseTrack }> {
    const { sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;
    const operation = prepared.operation as Extract<SyncOperation, { type: 'upgrade' }>;
    const { source, target } = operation;

    // Find the existing track in the database by filePath
    const tracks = this.ipod.getTracks();
    let foundTrack = tracks.find((t) => t.filePath === target.filePath);

    // Fall back to metadata matching
    if (!foundTrack) {
      foundTrack = tracks.find(
        (t) => t.title === target.title && t.artist === target.artist && t.album === target.album
      );
    }

    if (!foundTrack) {
      throw new Error(
        `Track not found in database for upgrade: ${target.artist} - ${target.title}`
      );
    }

    // Replace the audio file (preserves database entry, playlists, play counts)
    this.ipod.replaceTrackFile(foundTrack, sourcePath);

    // Update technical metadata to reflect the new file
    const updateFields: Parameters<IpodDatabaseTrack['update']>[0] = {
      filetype,
      ...(bitrate !== undefined && { bitrate }),
      ...(source.duration !== undefined && { duration: source.duration }),
      ...(source.soundcheck !== undefined && { soundcheck: source.soundcheck }),
    };

    // Update metadata fields from source that may have changed
    if (source.genre !== undefined) updateFields.genre = source.genre;
    if (source.year !== undefined) updateFields.year = source.year;
    if (source.trackNumber !== undefined) updateFields.trackNumber = source.trackNumber;
    if (source.discNumber !== undefined) updateFields.discNumber = source.discNumber;
    if (source.albumArtist !== undefined) updateFields.albumArtist = source.albumArtist;
    if (source.compilation !== undefined) updateFields.compilation = source.compilation;

    // Write sync tag for upgrade operations with a preset (transcoded)
    if (operation.preset) {
      const syncTag = this.buildSyncTagForPreset(operation.preset.name);
      if (syncTag) {
        updateFields.comment = writeSyncTag(foundTrack.comment, syncTag);
      }
    }

    foundTrack.update(updateFields);

    // Extract and transfer artwork if enabled
    if (artworkEnabled) {
      await this.transferArtwork(foundTrack, artworkSourcePath);
    }

    return { bytesTransferred: size, track: foundTrack };
  }

  /**
   * Build a SyncTagData from a preset name and the current sync tag config.
   *
   * Returns undefined if no sync tag config is set (sync tags disabled).
   */
  private buildSyncTagForPreset(presetName: string): SyncTagData | undefined {
    if (!this.syncTagConfig) {
      return undefined;
    }

    return buildAudioSyncTag(
      presetName,
      this.syncTagConfig.encodingMode,
      this.syncTagConfig.customBitrate
    );
  }

  /**
   * Clean up a prepared file if it's a temp file.
   */
  private async cleanupPreparedFile(prepared: PreparedFile): Promise<void> {
    // Clean up transcoded/downloaded temp file
    if (prepared.isTemp) {
      try {
        await rm(prepared.sourcePath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up downloaded source file (for transcode ops from remote sources)
    // This is separate from sourcePath because transcode creates a new file
    if (prepared.downloadedSourcePath) {
      await cleanupTempFile(prepared.downloadedSourcePath);
    }
  }
}

/**
 * Get the phase name for an operation type
 */
function getPhaseForOperation(operation: SyncOperation): SyncProgress['phase'] {
  switch (operation.type) {
    case 'transcode':
      return 'transcoding';
    case 'copy':
      return 'copying';
    case 'remove':
      return 'removing';
    case 'update-metadata':
      return 'updating-metadata';
    case 'upgrade':
      return 'upgrading';
    case 'video-transcode':
      return 'video-transcoding';
    case 'video-copy':
      return 'video-copying';
    case 'video-remove':
      return 'removing';
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
    } else if (progress.phase !== 'preparing' && progress.phase !== 'updating-db') {
      completed++;
    }

    bytesTransferred = progress.bytesProcessed;
  }

  // Collect warnings from the executor
  const warnings = executor.getWarnings();

  return {
    completed,
    failed,
    skipped,
    errors,
    categorizedErrors,
    warnings,
    bytesTransferred,
  };
}
