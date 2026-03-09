/**
 * Error types for iPod database operations.
 */

/**
 * Error codes for iPod operations.
 *
 * These codes categorize errors to help with error handling and recovery:
 *
 * - `NOT_FOUND` - iPod not found at the specified mount point
 * - `DATABASE_CORRUPT` - Database is corrupt or unreadable
 * - `INIT_FAILED` - Failed to initialize a new iPod database
 * - `TRACK_REMOVED` - Operating on a track that has been removed
 * - `PLAYLIST_REMOVED` - Operating on a playlist that has been removed
 * - `FILE_NOT_FOUND` - Source file not found when copying to iPod
 * - `COPY_FAILED` - Failed to copy file to iPod storage
 * - `ARTWORK_FAILED` - Failed to set or process artwork
 * - `SAVE_FAILED` - Failed to write database to iPod
 * - `DATABASE_CLOSED` - Attempted operation on a closed database
 */
export type IpodErrorCode =
  | 'NOT_FOUND'
  | 'DATABASE_CORRUPT'
  | 'INIT_FAILED'
  | 'TRACK_REMOVED'
  | 'PLAYLIST_REMOVED'
  | 'FILE_NOT_FOUND'
  | 'COPY_FAILED'
  | 'ARTWORK_FAILED'
  | 'SAVE_FAILED'
  | 'DATABASE_CLOSED';

/**
 * Error thrown by iPod database operations.
 *
 * This error class provides structured error information with a `code`
 * property that can be used for programmatic error handling.
 *
 * @example
 * ```typescript
 * import { IpodDatabase, IpodError } from '@podkit/core';
 *
 * try {
 *   const ipod = await IpodDatabase.open('/Volumes/IPOD');
 * } catch (error) {
 *   if (error instanceof IpodError) {
 *     switch (error.code) {
 *       case 'NOT_FOUND':
 *         console.error('iPod not found at path');
 *         break;
 *       case 'DATABASE_CORRUPT':
 *         console.error('iPod database is corrupt');
 *         break;
 *       default:
 *         console.error(`iPod error: ${error.message}`);
 *     }
 *   }
 * }
 * ```
 */
export class IpodError extends Error {
  /**
   * The error code identifying the type of error.
   */
  readonly code: IpodErrorCode;

  /**
   * Creates a new IpodError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic handling
   */
  constructor(message: string, code: IpodErrorCode) {
    super(message);
    this.name = 'IpodError';
    this.code = code;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IpodError);
    }
  }
}
