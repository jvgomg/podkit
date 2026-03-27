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
  unknown: 0,
  retryDelayMs: 1000,
};

// =============================================================================
// Error Categorization
// =============================================================================

/**
 * Categorize an error based on its message and operation type
 *
 * Priority order:
 * 1. Check error message for specific keywords (most reliable)
 * 2. Fall back to operation type as a hint
 */
export function categorizeError(error: Error, operationType: string): ErrorCategory {
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
  if (
    operationType === 'add-transcode' ||
    operationType === 'upgrade-transcode' ||
    operationType === 'video-transcode'
  ) {
    return 'transcode';
  }
  if (
    operationType === 'add-direct-copy' ||
    operationType === 'add-optimized-copy' ||
    operationType === 'video-copy'
  ) {
    return 'copy';
  }
  if (
    operationType === 'upgrade-direct-copy' ||
    operationType === 'upgrade-optimized-copy' ||
    operationType === 'upgrade-artwork' ||
    operationType === 'video-upgrade'
  ) {
    return 'copy'; // Upgrade errors are treated like copy errors for retry purposes
  }

  return 'unknown';
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
