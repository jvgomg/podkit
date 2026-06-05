/**
 * Shared types for the music pipeline modules.
 *
 * Lives in its own module so {@link ./pipeline.ts | MusicPipeline} and
 * {@link ./transfer.ts | MusicTransferOps} can share `PreparedFile` and the
 * operation-type unions without a circular import.
 *
 * @module
 */

import type { SyncOperation } from '../engine/types.js';

/**
 * Music file operation types — operations that involve file transfer (not remove/update-metadata).
 * Used for Extract<SyncOperation, ...> patterns in the pipeline.
 */
export type MusicFileOperationType =
  | 'add-transcode'
  | 'add-direct-copy'
  | 'add-optimized-copy'
  | 'upgrade-transcode'
  | 'upgrade-direct-copy'
  | 'upgrade-optimized-copy'
  | 'upgrade-artwork';

/**
 * Music upgrade operation types — operations that upgrade existing tracks.
 */
export type MusicUpgradeOperationType =
  | 'upgrade-transcode'
  | 'upgrade-direct-copy'
  | 'upgrade-optimized-copy'
  | 'upgrade-artwork';

/**
 * A file that has been prepared for transfer to iPod.
 *
 * For transcode operations, this contains the path to the transcoded temp file.
 * For copy operations, this contains the path to the original source file.
 */
export interface PreparedFile {
  /** The sync operation this file is for */
  operation: Extract<SyncOperation, { type: MusicFileOperationType }>;
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
