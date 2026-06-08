/**
 * Shared error handling for sync executors
 *
 * This module provides error categorization, retry logic, and helper functions
 * shared by both the music and video sync executors.
 *
 * ## Error Categories
 *
 * | Category   | Retry | Description                                    |
 * |------------|-------|------------------------------------------------|
 * | transcode  | Yes*  | FFmpeg/encoder failures (* 0 for video)        |
 * | copy       | Yes   | File I/O errors (ENOENT, EACCES, etc.)         |
 * | database   | No    | iPod database / libgpod errors                 |
 * | artwork    | No    | Artwork extraction/processing errors            |
 * | unknown    | No    | Uncategorized errors                            |
 *
 * ## Retry Strategy
 *
 * Music uses DEFAULT_RETRY_CONFIG (transcode=1, copy=1).
 * Video uses VIDEO_RETRY_CONFIG (transcode=0, copy=1) because video
 * transcodes are too expensive (minutes per file) to retry.
 *
 * @module
 */

import type { ErrorCategory, CategorizedError } from './types.js';
import { CategorizedSyncError } from './errors.js';

// =============================================================================
// Retry Configuration
// =============================================================================

/**
 * Retry configuration for different operation types
 */
export interface RetryConfig {
  /** Number of retries for transcode operations (default: 1 for music, 0 for video) */
  transcode?: number;
  /** Number of retries for copy operations (default: 1) */
  copy?: number;
  /** Number of retries for database operations (default: 0) */
  database?: number;
  /** Number of retries for artwork operations (default: 0) */
  artwork?: number;
  /** Number of retries for free-space exhaustion (default: 0 — hard sync exit) */
  space?: number;
  /** Number of retries for unknown errors (default: 0) */
  unknown?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
}

/**
 * Default retry configuration for music sync
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  transcode: 1,
  copy: 1,
  database: 0,
  artwork: 0,
  space: 0,
  unknown: 0,
  retryDelayMs: 1000,
};

/**
 * Retry configuration for video sync
 *
 * Video transcodes are too expensive (minutes per file) to retry.
 * Copy and database operations use the same defaults as music.
 */
export const VIDEO_RETRY_CONFIG: Required<RetryConfig> = {
  transcode: 0,
  copy: 1,
  database: 0,
  artwork: 0,
  space: 0,
  unknown: 0,
  retryDelayMs: 1000,
};

// =============================================================================
// Error Categorization
// =============================================================================

/**
 * Recover the category for a thrown sync error.
 *
 * Convention: every error thrown out of an adapter, content-type handler, or
 * sync stage MUST extend {@link CategorizedSyncError} and declare its
 * category on the class. The categorizer then reads `error.category`
 * directly — no inspecting the message body.
 *
 * Untyped errors (third-party libraries that throw `Error` directly, e.g.
 * libgpod failures or raw FFmpeg subprocess errors that aren't yet wrapped
 * by their handler) fall back to a small operation-type table: the call site
 * intentionally chose the operation type, so it's the next best signal.
 * Anything left over is `unknown`.
 *
 * See `documents/architecture/error-handling.md` for the responsibility
 * model. See `./errors.ts` for `CategorizedSyncError` and its subclasses.
 */
export function categorizeError(error: Error, operationType: string): ErrorCategory {
  if (error instanceof CategorizedSyncError) {
    return error.category;
  }
  return categoryForOperationType(operationType);
}

/**
 * Operation-type fallback for untyped errors. Each branch matches the
 * operation's nature (transcode/copy/update) rather than any keyword in the
 * error message.
 */
function categoryForOperationType(operationType: string): ErrorCategory {
  switch (operationType) {
    case 'add-transcode':
    case 'upgrade-transcode':
    case 'video-transcode':
      return 'transcode';
    case 'add-direct-copy':
    case 'add-optimized-copy':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
    case 'video-copy':
    case 'video-upgrade':
    case 'relocate':
      return 'copy';
    default:
      return 'unknown';
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the number of retries allowed for an error category
 */
export function getRetriesForCategory(
  category: ErrorCategory,
  config: Required<RetryConfig>
): number {
  switch (category) {
    case 'transcode':
      return config.transcode;
    case 'copy':
      return config.copy;
    case 'database':
      return config.database;
    case 'artwork':
      return config.artwork;
    case 'space':
      return config.space;
    case 'unknown':
      return config.unknown;
  }
}

/**
 * Create a categorized error object
 */
export function createCategorizedError(
  error: Error,
  category: ErrorCategory,
  trackName: string,
  retryAttempts: number,
  wasRetried: boolean
): CategorizedError {
  return {
    error,
    category,
    trackName,
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

/**
 * Execute a function with retry logic
 *
 * Attempts the function once, then retries up to the configured number of times
 * for the error's category. Returns either the successful result or the final error.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param operationType - The type of sync operation (for error categorization)
 * @param trackName - Display name for error reporting
 * @returns Success with result and attempts, or failure with categorized error and attempts
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
  operationType: string,
  trackName: string
): Promise<
  | { ok: true; result: T; attempts: number }
  | { ok: false; error: CategorizedError; attempts: number }
> {
  let attempts = 0;

  while (true) {
    attempts++;
    try {
      const result = await fn();
      return { ok: true, result, attempts };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const category = categorizeError(error, operationType);
      const maxRetries = getRetriesForCategory(category, config);

      if (attempts <= maxRetries) {
        // Retry after delay
        await sleep(config.retryDelayMs);
        continue;
      }

      // Out of retries — return categorized error
      return {
        ok: false,
        error: createCategorizedError(
          error,
          category,
          trackName,
          attempts - 1, // retryAttempts = number of retries (not including first try)
          attempts > 1 // wasRetried = true if we retried at least once
        ),
        attempts,
      };
    }
  }
}
