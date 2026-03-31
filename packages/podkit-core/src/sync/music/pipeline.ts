/**
 * Music sync pipeline — three-stage execution engine (ADR-011)
 *
 * The pipeline takes a SyncPlan (from the planner) and executes each operation:
 * - transcode: Convert audio with FFmpeg, then add to device
 * - copy: Add track to device directly
 * - remove: Remove track from device database
 *
 * Three-stage pipeline architecture:
 * 1. Downloader: resolves file access (downloads for remote sources)
 * 2. Preparer: transcodes/prepares files (CPU-bound)
 * 3. Consumer: transfers to device (USB I/O)
 *
 * For remote sources, file downloads are pipelined ahead of transcoding
 * so network I/O overlaps with CPU work.
 *
 * Features:
 * - Progress reporting via async iterator
 * - Dry-run mode (simulate without writing)
 * - Error handling with continue-on-error option
 * - Abort signal support for cancellation
 *
 * This is the handler's internal execution pipeline, not a public API.
 * External consumers should use MusicHandler.executeBatch() instead.
 *
 * @module
 */

import { mkdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { AsyncQueue } from '../../utils/async-queue.js';
import { streamToTempFile, cleanupTempFile } from '../../utils/stream.js';
import { buildAudioSyncTag, buildCopySyncTag } from '../../metadata/sync-tags.js';
import { soundcheckToReplayGainDb } from '../../metadata/normalization.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import {
  categorizeError as sharedCategorizeError,
  getRetriesForCategory as sharedGetRetriesForCategory,
  createCategorizedError as sharedCreateCategorizedError,
  type RetryConfig as SharedRetryConfig,
} from '../engine/error-handling.js';

import type { CollectionTrack, CollectionAdapter } from '../../adapters/interface.js';
import type {
  FFmpegTranscoder,
  OptimizedCopyFormat,
  EncoderConfig,
} from '../../transcode/ffmpeg.js';
import { buildOptimizedCopyArgs } from '../../transcode/ffmpeg.js';
import { getCodecMetadata } from '../../transcode/codecs.js';
import { fileTypeToAudioCodec } from './planner.js';
import { getCodecPresetBitrate, getCodecVbrQuality } from '../../transcode/types.js';
import type { TranscodePresetRef } from '../engine/types.js';
import type {
  ExecuteOptions,
  SyncExecutor,
  SyncOperation,
  SyncPlan,
  SyncProgress,
  ErrorCategory as ErrorCategoryFromTypes,
  CategorizedError as CategorizedErrorFromTypes,
  ExecutionWarningType as ExecutionWarningTypeFromTypes,
  ExecutionWarning as ExecutionWarningFromTypes,
  ExecutorProgress as ExecutorProgressFromTypes,
  ExecuteResult as ExecuteResultFromTypes,
} from '../engine/types.js';
import type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from '../../device/adapter.js';
import { AlbumArtworkCache, getAlbumKey } from '../../artwork/album-cache.js';
import { resizeArtwork } from '../../artwork/resize.js';

// =============================================================================
// Extended Types — re-exported from types.ts (canonical definitions)
// =============================================================================

/** @see types.ts for canonical definition */
export type ErrorCategory = ErrorCategoryFromTypes;

/** @see types.ts for canonical definition */
export type CategorizedError = CategorizedErrorFromTypes;

/** @see types.ts for canonical definition */
export type ExecutionWarningType = ExecutionWarningTypeFromTypes;

/** @see types.ts for canonical definition */
export type ExecutionWarning = ExecutionWarningFromTypes;

/** @see types.ts for canonical definition */
export type ExecutorProgress = ExecutorProgressFromTypes;

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
export const MUSIC_RETRY_CONFIG: Required<RetryConfig> = {
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
  /**
   * Transfer mode — an optimization strategy applied after device constraints.
   *
   * Device constraints (artworkMaxResolution, supportedAudioCodecs, artworkSources)
   * are always enforced regardless of mode. Transfer mode only affects discretionary
   * decisions where the device doesn't dictate the outcome:
   *
   * - `fast` (default): minimum extra work beyond device requirements.
   * - `optimized`: optimize storage (e.g., strip embedded artwork when the device
   *   reads from a database and doesn't need it).
   * - `portable`: optimize completeness (preserve embedded artwork even when the
   *   device doesn't need it, for portability if files are copied elsewhere).
   */
  transferMode?: string;
  /**
   * Save the iPod database every N completed track operations.
   *
   * Reduces data loss if the process is killed, at the cost of triggering
   * libgpod's ithmb compaction more frequently. Set to 0 to disable.
   *
   * @default 50
   */
  saveInterval?: number;
  /**
   * Resize embedded artwork to this maximum dimension (pixels, square).
   *
   * When set, embedded artwork is resized during transcode and optimized-copy
   * instead of being stripped. Used for devices where embedded artwork is the
   * primary display source (e.g., Echo Mini).
   *
   * Takes priority over transferMode — when set, artwork is resized in all
   * modes including portable (the device cannot use full-res artwork).
   */
  artworkResize?: number;
  /**
   * Audio normalization mode for the target device.
   *
   * When `'replaygain'`, ReplayGain metadata tags are injected into transcoded
   * files via FFmpeg `-metadata` flags so mass-storage devices (e.g., Rockbox)
   * can read volume normalization data from file tags.
   *
   * When `'soundcheck'` or `'none'`, no ReplayGain tags are written — iPod uses
   * the iTunesDB soundcheck field, and `'none'` devices don't support normalization.
   */
  audioNormalization?: string;
}

/** @see types.ts for canonical definition */
export type ExecuteResult = ExecuteResultFromTypes;

/**
 * Music file operation types — operations that involve file transfer (not remove/update-metadata).
 * Used for Extract<SyncOperation, ...> patterns in the pipeline.
 */
type MusicFileOperationType =
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
type MusicUpgradeOperationType =
  | 'upgrade-transcode'
  | 'upgrade-direct-copy'
  | 'upgrade-optimized-copy'
  | 'upgrade-artwork';

/**
 * Dependencies required by the executor
 */
export interface ExecutorDependencies {
  /** Device adapter for track operations (iPod, mass-storage, etc.) */
  device: DeviceAdapter;
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

/** Default pipeline buffer size (number of prepared files to buffer between preparer and consumer) */
const PIPELINE_BUFFER_SIZE = 3;

/** Number of files to download ahead of the transcoder (for remote sources) */
const PREFETCH_BUFFER_SIZE = 2;

/**
 * A file that has been downloaded/resolved but not yet transcoded/prepared.
 *
 * Used in the three-stage pipeline to decouple downloading (network I/O)
 * from transcoding (CPU work) for remote sources.
 */
interface PrefetchedFile {
  /** The sync operation this file is for */
  operation: Extract<SyncOperation, { type: MusicFileOperationType }>;
  /** Resolved file access (local path or downloaded temp path) */
  fileAccess: ResolvedFileAccess;
}

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
 * Check if a file path has an OGG container extension (.opus, .ogg).
 *
 * Used to detect files that need post-processed artwork embedding,
 * since FFmpeg's OGG muxer cannot write image streams.
 */
function isOggExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.opus' || ext === '.ogg';
}

/**
 * Get a human-readable filetype label based on file extension.
 *
 * Used for the iPod database `filetype` field which displays the format
 * in iTunes and on the device.
 */
export function getFileTypeLabel(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3':
      return 'MPEG audio file';
    case '.m4a':
    case '.aac':
      return 'AAC audio file';
    case '.alac':
      return 'Apple Lossless audio file';
    case '.opus':
      return 'Opus audio file';
    case '.flac':
      return 'FLAC audio file';
    default:
      return 'Audio file';
  }
}

/**
 * Determine the FFmpeg format argument for an optimized-copy operation.
 *
 * Maps the track's file type and codec to the container format that FFmpeg
 * should use when stream-copying audio with artwork stripped.
 */
function getOptimizedCopyFormat(track: CollectionTrack): OptimizedCopyFormat {
  if (track.fileType === 'mp3') return 'mp3';
  if (track.codec?.toLowerCase() === 'alac' || track.fileType === 'alac') return 'alac';
  if (track.fileType === 'opus') return 'opus';
  if (track.fileType === 'flac') return 'flac';
  return 'm4a'; // m4a, aac, and other M4A-container formats
}

/**
 * Build a transcode preset argument for the transcoder.
 *
 * When the preset has a targetCodec, builds a full EncoderConfig so the
 * transcoder knows which codec to use. Otherwise falls back to passing
 * the preset name directly (legacy AAC path).
 */
function buildTranscodePreset(
  preset: TranscodePresetRef,
  encodingMode?: import('../../transcode/types.js').EncodingMode
): import('../../transcode/types.js').QualityPreset | 'lossless' | EncoderConfig {
  if (!preset.targetCodec) {
    // Legacy path: pass preset name (resolves to AAC internally)
    return preset.name;
  }

  // Lossless: ALAC uses the legacy 'lossless' string path; FLAC uses EncoderConfig
  if (preset.name === 'lossless') {
    if (preset.targetCodec === 'flac') {
      return { codec: 'flac', bitrateKbps: 0, encoding: 'vbr' };
    }
    return 'lossless';
  }

  // Build EncoderConfig for codec-aware transcoding
  const config: EncoderConfig = {
    codec: preset.targetCodec,
    bitrateKbps:
      preset.bitrateOverride ?? getCodecPresetBitrate(preset.targetCodec, preset.name) ?? 256,
    encoding: encodingMode ?? 'vbr',
    quality: getCodecVbrQuality(preset.targetCodec, preset.name),
  };
  return config;
}

/**
 * Get the output file extension for a transcode preset.
 * When the preset has a targetCodec, uses codec metadata; otherwise defaults to `.m4a` (AAC).
 */
function getTranscodeOutputExtension(preset: TranscodePresetRef): string {
  if (preset.targetCodec) {
    return getCodecMetadata(preset.targetCodec).extension;
  }
  return '.m4a';
}

/**
 * Get the filetype label for a transcode preset.
 * When the preset has a targetCodec, uses codec metadata; otherwise defaults to `'AAC audio file'`.
 */
export function getTranscodeFiletypeLabel(preset: TranscodePresetRef): string {
  if (preset.targetCodec) {
    return getCodecMetadata(preset.targetCodec).filetypeLabel;
  }
  return 'AAC audio file';
}

/**
 * Convert CollectionTrack to DeviceTrackInput for the device adapter
 */
function toDeviceTrackInput(track: CollectionTrack): DeviceTrackInput {
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
    normalization: track.normalization,
  };
}

/**
 * Get a display name for an operation (for progress reporting)
 */
export function getMusicOperationDisplayName(operation: SyncOperation): string {
  switch (operation.type) {
    case 'add-transcode':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'add-direct-copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'add-optimized-copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'remove':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'update-metadata':
    case 'update-sync-tag':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'video-transcode':
    case 'video-copy':
      return operation.source.title;
    case 'video-remove':
      return operation.video.title;
    case 'video-update-metadata':
      return operation.video.title;
    case 'video-upgrade':
      return operation.source.title;
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
 * Delegates to the shared error-handling module.
 *
 * @see error-handling.ts for the canonical implementation
 */
export function categorizeError(error: Error, operationType: SyncOperation['type']): ErrorCategory {
  return sharedCategorizeError(error, operationType);
}

/**
 * Get the number of retries allowed for an error category
 *
 * Accepts the executor's RetryConfig (with `transcodeRetries`/`copyRetries`/`databaseRetries`
 * naming) and adapts it to the shared module's interface.
 */
export function getRetriesForCategory(
  category: ErrorCategory,
  config: Required<RetryConfig>
): number {
  // Adapt executor RetryConfig naming to shared RetryConfig naming
  const sharedConfig: Required<SharedRetryConfig> = {
    transcode: config.transcodeRetries,
    copy: config.copyRetries,
    database: config.databaseRetries,
    artwork: 0,
    unknown: 0,
    retryDelayMs: config.retryDelayMs,
  };
  return sharedGetRetriesForCategory(category, sharedConfig);
}

/**
 * Create a categorized error object
 *
 * Convenience wrapper that derives category and trackName from the operation.
 */
export function createCategorizedError(
  error: Error,
  operation: SyncOperation,
  retryAttempts: number,
  wasRetried: boolean
): CategorizedError {
  const category = categorizeError(error, operation.type);
  const trackName = getMusicOperationDisplayName(operation);
  return sharedCreateCategorizedError(error, category, trackName, retryAttempts, wasRetried);
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
 * Three-stage music sync pipeline (ADR-011)
 *
 * Handles execution of sync operations including transcoding, copying,
 * removing, updating metadata, and upgrading tracks on the device.
 */
export class MusicPipeline implements SyncExecutor {
  private device: DeviceAdapter;
  private transcoder: FFmpegTranscoder;
  /** Warnings collected during execution */
  private warnings: ExecutionWarning[] = [];
  /** Sync tag config for the current execution (set during execute()) */
  private syncTagConfig?: SyncTagConfig;
  /** Transfer mode for the current execution (set during execute()) */
  private transferMode?: string;
  /** Artwork resize dimension for embedded artwork devices (set during execute()) */
  private artworkResize?: number;
  /** Audio normalization mode for the target device (set during execute()) */
  private audioNormalization?: string;
  /** Album-level artwork cache — deduplicates extraction across tracks on the same album */
  private artworkCache = new AlbumArtworkCache();
  /** Album-level cache for resized artwork — avoids redundant FFmpeg spawns for tracks on the same album */
  private resizedArtworkCache = new Map<string, Buffer>();

  constructor(deps: ExecutorDependencies) {
    this.device = deps.device;
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
   * Build ReplayGain options for transcode if the device supports it.
   *
   * Returns the ReplayGain data to inject via FFmpeg `-metadata` flags,
   * or undefined if the device doesn't read ReplayGain from file tags.
   * Prefers raw dB values from the source; falls back to back-converting
   * from the soundcheck integer (sub-0.01 dB rounding difference).
   */
  private buildReplayGainOption(
    source: CollectionTrack
  ): { trackGain: number; trackPeak?: number; albumGain?: number; albumPeak?: number } | undefined {
    if (this.audioNormalization !== 'replaygain') return undefined;
    if (!source.normalization) return undefined;

    if (source.normalization.trackGain !== undefined) {
      return {
        trackGain: source.normalization.trackGain,
        trackPeak: source.normalization.trackPeak,
        albumGain: source.normalization.albumGain,
        albumPeak: source.normalization.albumPeak,
      };
    }

    if (source.normalization.soundcheckValue !== undefined) {
      return { trackGain: soundcheckToReplayGainDb(source.normalization.soundcheckValue) };
    }

    return undefined;
  }

  /**
   * Execute a sync plan using a three-stage pipeline architecture.
   *
   * Three stages run concurrently:
   * - Downloader: resolves file access, downloading from remote sources
   * - Preparer: transcodes/prepares files (CPU-bound FFmpeg work)
   * - Consumer: transfers files to iPod (USB I/O bound)
   *
   * For remote sources (Subsonic), downloads are pipelined ahead of
   * transcoding so network I/O overlaps with CPU work. For local sources,
   * file resolution is instant and the pipeline collapses to two stages.
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
      transferMode,
      artworkResize,
      audioNormalization,
      saveInterval = 50,
    } = options;

    // Store sync tag config for use during transfer
    this.syncTagConfig = syncTagConfig;
    this.transferMode = transferMode;
    this.artworkResize = artworkResize;
    this.audioNormalization = audioNormalization;

    // Clear state from previous execution
    this.clearWarnings();
    this.artworkCache.clear();
    this.resizedArtworkCache.clear();

    // Merge retry config with defaults
    const mergedRetryConfig: Required<RetryConfig> = {
      ...MUSIC_RETRY_CONFIG,
      ...retryConfig,
    };

    const totalBytes = calculateTotalBytes(plan);

    // Create temp directory for transcoded/optimized-copy files if needed
    const transcodeDir = join(tempDir, `podkit-transcode-${randomUUID()}`);
    const needsTempDir = plan.operations.some(
      (op) =>
        op.type === 'add-transcode' ||
        op.type === 'upgrade-transcode' ||
        op.type === 'add-optimized-copy' ||
        op.type === 'upgrade-optimized-copy'
    );
    if (needsTempDir && !dryRun) {
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
        signal,
        saveInterval
      );
    } finally {
      // Cleanup temp directory
      if (needsTempDir && !dryRun) {
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
        currentTrack: getMusicOperationDisplayName(operation),
        bytesProcessed,
        bytesTotal: totalBytes,
        skipped: true,
        completedCount: index + 1,
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
        completedCount: plan.operations.length,
      };
    }
  }

  /**
   * Execute sync plan using a three-stage pipeline architecture.
   *
   * Stage 1 (Downloader): Downloads/resolves files from adapters (network I/O)
   * Stage 2 (Preparer): Transcodes/prepares files (CPU-bound FFmpeg)
   * Stage 3 (Consumer): Transfers files to iPod (USB I/O)
   *
   * For remote sources (e.g., Subsonic), the downloader fetches files ahead
   * of the preparer so network I/O overlaps with CPU work. For local sources,
   * file resolution is instant and the prefetch queue fills immediately,
   * collapsing the pipeline to two effective stages.
   *
   * Remove/update-metadata operations execute inline in the downloader.
   *
   * See ADR-011 for design rationale.
   */
  private async *executePipeline(
    plan: SyncPlan,
    totalBytes: number,
    transcodeDir: string,
    retryConfig: Required<RetryConfig>,
    continueOnError: boolean,
    artworkEnabled: boolean,
    adapter?: CollectionAdapter,
    signal?: AbortSignal,
    saveInterval = 50
  ): AsyncIterable<ExecutorProgress> {
    const total = plan.operations.length;
    const prefetchQueue = new AsyncQueue<PrefetchedFile>(PREFETCH_BUFFER_SIZE);
    const transferQueue = new AsyncQueue<PreparedFile>(PIPELINE_BUFFER_SIZE);

    // Shared state across all stages
    let bytesProcessed = 0;
    let completed = 0;
    let failed = 0;
    let inlineCompleted = 0;
    let fatalError: Error | undefined;
    let abortRequested = false;

    // Track errors for yielding
    interface FailedOperation {
      operation: SyncOperation;
      error: Error;
      attempts: number;
    }
    const pipelineFailures: FailedOperation[] = [];

    // Track completed inline operations (remove/update-metadata) for yielding
    const inlineCompletions: SyncOperation[] = [];

    // Helper to get source from file operations
    const getFileOperationSource = (
      operation: Extract<SyncOperation, { type: MusicFileOperationType }>
    ): CollectionTrack => operation.source;

    // Stage 1: Downloader — resolve file access (download for remote, instant for local)
    const downloader = async () => {
      for (const operation of plan.operations) {
        if (signal?.aborted || abortRequested) break;

        try {
          if (
            operation.type === 'add-transcode' ||
            operation.type === 'add-direct-copy' ||
            operation.type === 'add-optimized-copy' ||
            operation.type === 'upgrade-transcode' ||
            operation.type === 'upgrade-direct-copy' ||
            operation.type === 'upgrade-optimized-copy' ||
            operation.type === 'upgrade-artwork'
          ) {
            const source = getFileOperationSource(operation);
            const fileAccess = await getTrackFilePath(source, adapter);
            await prefetchQueue.push({ operation, fileAccess });
          } else if (operation.type === 'remove') {
            await this.executeRemove(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          } else if (operation.type === 'update-metadata') {
            await this.executeUpdateMetadata(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          } else if (operation.type === 'update-sync-tag') {
            await this.executeUpdateSyncTag(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          pipelineFailures.push({ operation, error: err, attempts: 0 });
          failed++;
          if (!continueOnError) {
            fatalError = err;
            abortRequested = true;
            break;
          }
        }
      }
      prefetchQueue.close();
    };

    // Stage 2: Preparer — transcode/prepare files using pre-resolved file access
    const preparer = async () => {
      for await (const prefetched of prefetchQueue) {
        if (signal?.aborted || abortRequested) {
          // Clean up prefetched file we won't process
          if (prefetched.fileAccess.isDownloaded) {
            await rm(prefetched.fileAccess.path, { force: true }).catch(() => {});
          }
          break;
        }

        const { operation, fileAccess } = prefetched;

        try {
          let result:
            | { value: PreparedFile; error?: undefined; attempts: number }
            | { value: null; error: Error; attempts: number };

          if (operation.type === 'add-transcode') {
            result = await this.prepareWithRetry(
              () => this.prepareTranscode(operation, transcodeDir, adapter, signal, fileAccess),
              operation,
              retryConfig
            );
          } else if (operation.type === 'add-direct-copy') {
            result = await this.prepareWithRetry(
              () => this.prepareCopy(operation, adapter, fileAccess),
              operation,
              retryConfig
            );
          } else if (operation.type === 'add-optimized-copy') {
            result = await this.prepareWithRetry(
              () => this.prepareOptimizedCopy(operation, transcodeDir, adapter, signal, fileAccess),
              operation,
              retryConfig
            );
          } else {
            // upgrade-transcode, upgrade-direct-copy, upgrade-optimized-copy, upgrade-artwork
            result = await this.prepareWithRetry(
              () => this.prepareUpgrade(operation, transcodeDir, adapter, signal, fileAccess),
              operation,
              retryConfig
            );
          }

          if (result.value) {
            await transferQueue.push(result.value);
          } else {
            pipelineFailures.push({
              operation,
              error: result.error,
              attempts: result.attempts,
            });
            failed++;
            // Clean up downloaded file on prepare failure
            if (fileAccess.isDownloaded) {
              await rm(fileAccess.path, { force: true }).catch(() => {});
            }
            if (!continueOnError) {
              fatalError = result.error;
              abortRequested = true;
              break;
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          pipelineFailures.push({ operation, error: err, attempts: 0 });
          failed++;
          // Clean up downloaded file on unexpected error
          if (fileAccess.isDownloaded) {
            await rm(fileAccess.path, { force: true }).catch(() => {});
          }
          if (!continueOnError) {
            fatalError = err;
            abortRequested = true;
            break;
          }
        }
      }

      // Clean up any remaining prefetched files on abort
      if (abortRequested) {
        for await (const remaining of prefetchQueue) {
          if (remaining.fileAccess.isDownloaded) {
            await rm(remaining.fileAccess.path, { force: true }).catch(() => {});
          }
        }
      }

      transferQueue.close();
    };

    // Start stages 1 and 2 in background
    const downloaderPromise = downloader();
    const preparerPromise = preparer();

    // Stage 3: Consumer — transfer files to iPod and yield progress
    for await (const prepared of transferQueue) {
      // Check for abort - but drain queue on abort (don't waste transcoded files)
      if (signal?.aborted) {
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
            currentTrack: getMusicOperationDisplayName(prepared.operation),
            bytesProcessed,
            bytesTotal: totalBytes,
            completedCount: completed + failed + inlineCompleted,
            // Include retry attempt if there were retries
            ...(totalRetries > 0 ? { retryAttempt: totalRetries } : {}),
          };

          // Checkpoint save: persist completed tracks periodically to reduce
          // data loss if the process is killed (force quit, SIGKILL, power loss)
          if (saveInterval > 0 && completed % saveInterval === 0) {
            await this.device.save();
          }
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
            currentTrack: getMusicOperationDisplayName(prepared.operation),
            bytesProcessed,
            bytesTotal: totalBytes,
            completedCount: completed + failed + inlineCompleted,
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

    // Yield progress for pipeline failures (errors from download or prepare phase)
    for (const failure of pipelineFailures) {
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
        currentTrack: getMusicOperationDisplayName(failure.operation),
        bytesProcessed,
        bytesTotal: totalBytes,
        completedCount: completed + failed + inlineCompleted,
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
        currentTrack: getMusicOperationDisplayName(operation),
        bytesProcessed,
        bytesTotal: totalBytes,
        completedCount: completed + failed + inlineCompleted,
      };
    }

    // Wait for all stages to finish
    await Promise.all([downloaderPromise, preparerPromise]);

    // If aborted, throw after draining (we finished transferring queued files)
    if (signal?.aborted) {
      throw new Error('Sync aborted');
    }

    // If a stage had a fatal error, throw it
    if (fatalError && !continueOnError) {
      throw fatalError;
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
        currentTrack: 'Saving device database',
        bytesProcessed,
        bytesTotal: totalBytes,
        completedCount: completed + failed + inlineCompleted,
      };

      await this.device.save();
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
        completedCount: completed + failed + inlineCompleted,
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
      operation.type === 'add-transcode' || operation.type === 'upgrade-transcode'
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
  ): Promise<{ bytesTransferred: number; track?: DeviceTrack }> {
    switch (operation.type) {
      case 'add-transcode':
        return this.executeTranscode(operation, transcodeDir, signal, artworkEnabled);
      case 'add-direct-copy':
      case 'add-optimized-copy':
        return this.executeCopy(operation, artworkEnabled);
      case 'remove':
        return this.executeRemove(operation);
      case 'update-metadata':
        return this.executeUpdateMetadata(operation);
      case 'update-sync-tag':
        return this.executeUpdateSyncTag(operation);
      case 'upgrade-transcode':
      case 'upgrade-direct-copy':
      case 'upgrade-optimized-copy':
      case 'upgrade-artwork':
        // Upgrade operations are handled via the pipeline (prepare + transfer)
        throw new Error('Upgrade operations should be handled via the pipeline');
      case 'video-transcode':
      case 'video-copy':
      case 'video-remove':
      case 'video-update-metadata':
      case 'video-upgrade':
        // Video operations are handled by VideoSyncExecutor, not this executor
        throw new Error(
          `Video operations (${operation.type}) should be handled by VideoSyncExecutor`
        );
    }
  }

  /**
   * Extract and transfer artwork for a track.
   *
   * Handles artwork extraction from source file and transfers it to iPod.
   * Returns the artwork hash (for sync tag writing) if artwork was transferred.
   * Errors are caught and collected as warnings, but don't fail the sync operation.
   *
   * @returns Artwork hash (8-char hex) if artwork was transferred, undefined otherwise
   */
  private async transferArtwork(
    track: DeviceTrack,
    sourceFilePath: string
  ): Promise<string | undefined> {
    try {
      const cached = await this.artworkCache.get(
        { artist: track.artist ?? '', album: track.album ?? '' },
        sourceFilePath
      );
      if (cached) {
        track.setArtworkFromData(cached.data);

        // Queue embedded artwork write for OGG files — FFmpeg can't embed
        // in OGG containers (upstream tickets #4448, #9044, open since 2015).
        // Post-process via node-taglib-sharp METADATA_BLOCK_PICTURE instead.
        // artworkResize is only set for embedded-artwork devices, so this
        // naturally skips database-artwork devices (iPod).
        if (this.artworkResize !== undefined && isOggExtension(track.filePath)) {
          const imageData = await this.getResizedArtwork(track, cached.data);
          this.device.updateTrack(track, { embeddedPictureData: imageData });
        }

        return cached.hash;
      }
      return undefined;
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
      return undefined;
    }
  }

  /**
   * Get resized artwork for OGG embedding, using album-level cache.
   *
   * Avoids redundant FFmpeg resize spawns for tracks on the same album.
   * Falls back to original data when artworkResize is 0 or unset.
   */
  private async getResizedArtwork(track: DeviceTrack, originalData: Buffer): Promise<Buffer> {
    if (!this.artworkResize || this.artworkResize <= 0) {
      return originalData;
    }

    const key = getAlbumKey({ artist: track.artist ?? '', album: track.album ?? '' });
    const cached = this.resizedArtworkCache.get(key);
    if (cached) {
      return cached;
    }

    const resized = await resizeArtwork(originalData, this.artworkResize);
    this.resizedArtworkCache.set(key, resized);
    return resized;
  }

  /**
   * Execute a transcode operation
   */
  private async executeTranscode(
    operation: Extract<SyncOperation, { type: 'add-transcode' }>,
    transcodeDir: string,
    signal?: AbortSignal,
    artworkEnabled?: boolean
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { source, preset: presetRef } = operation;

    // Generate output path in temp directory — derive extension from target codec
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputExt = getTranscodeOutputExtension(presetRef);
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}${outputExt}`);

    // Transcode the file — use EncoderConfig when targetCodec is set
    const transcodePreset = buildTranscodePreset(
      presetRef,
      this.syncTagConfig?.encodingMode as
        | import('../../transcode/types.js').EncodingMode
        | undefined
    );
    const result = await this.transcoder.transcode(source.filePath, outputPath, transcodePreset, {
      signal,
      transferMode: this.transferMode as
        | import('../../transcode/types.js').TransferMode
        | undefined,
      artworkResize: this.artworkResize,
      replayGain: this.buildReplayGainOption(source),
    });

    // Add track to device database
    const trackInput: DeviceTrackInput = {
      ...toDeviceTrackInput(source),
      bitrate: result.bitrate,
      filetype: getTranscodeFiletypeLabel(presetRef),
    };

    const track = this.device.addTrack(trackInput);

    // Copy transcoded file to device
    this.device.copyTrackFile(track, outputPath);

    // Request ReplayGain tag writes for transcoded files (M4A needs tag writer)
    if (this.audioNormalization === 'replaygain' && source.normalization !== undefined) {
      this.device.updateTrack(track, {
        writeReplayGainTags: true,
        normalization: source.normalization,
      });
    }

    // Extract and transfer artwork if enabled.
    // Skip when the source explicitly has no artwork — see transferToIpod for full explanation.
    if (artworkEnabled && source.hasArtwork !== false) {
      await this.transferArtwork(track, source.filePath);
    }

    return { bytesTransferred: result.size, track };
  }

  /**
   * Execute a copy operation
   */
  private async executeCopy(
    operation: Extract<SyncOperation, { type: 'add-direct-copy' | 'add-optimized-copy' }>,
    artworkEnabled?: boolean
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { source } = operation;

    // Add track to device database
    const trackInput: DeviceTrackInput = {
      ...toDeviceTrackInput(source),
      filetype: getFileTypeLabel(source.filePath),
    };

    const track = this.device.addTrack(trackInput);

    // Copy source file to device
    this.device.copyTrackFile(track, source.filePath);

    // Extract and transfer artwork if enabled.
    // Skip when the source explicitly has no artwork — see transferToIpod for full explanation.
    if (artworkEnabled && source.hasArtwork !== false) {
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

    // The SyncOperation stores a DeviceTrack snapshot (data-only)
    // We need to find the matching live track on the device and remove it
    const tracks = this.device.getTracks();
    const foundTrack = tracks.find(
      (t) =>
        t.title === targetTrack.title &&
        t.artist === targetTrack.artist &&
        t.album === targetTrack.album
    );

    if (!foundTrack) {
      throw new Error(`Track not found in database: ${targetTrack.artist} - ${targetTrack.title}`);
    }

    // Remove using the DeviceTrack API
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
    const tracks = this.device.getTracks();
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
    const updateFields: DeviceTrackMetadata = {};

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
    if (metadata.normalization !== undefined) {
      updateFields.normalization = metadata.normalization;
    }
    // Update the track metadata (preserves play stats automatically)
    this.device.updateTrack(foundTrack, updateFields);

    // No bytes transferred for metadata-only updates
    return { bytesTransferred: 0 };
  }

  /**
   * Execute an update-sync-tag operation
   *
   * Writes a typed sync tag to the iPod track's comment field without
   * changing any other metadata. Uses the device adapter's writeSyncTag
   * method directly.
   */
  private async executeUpdateSyncTag(
    operation: Extract<SyncOperation, { type: 'update-sync-tag' }>
  ): Promise<{ bytesTransferred: number }> {
    const { track: targetTrack, syncTag } = operation;

    // Find the matching track in the database
    const tracks = this.device.getTracks();
    let foundTrack = tracks.find((t) => t.filePath === targetTrack.filePath);

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

    foundTrack = this.device.writeSyncTag(foundTrack, syncTag);

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
    operation: Extract<SyncOperation, { type: 'add-transcode' }>,
    transcodeDir: string,
    adapter?: CollectionAdapter,
    signal?: AbortSignal,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source, preset: presetRef } = operation;

    // Use pre-resolved file access from prefetch, or resolve now (legacy/fallback)
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, adapter));
    const inputPath = fileAccess.path;

    // Generate output path in temp directory — derive extension from target codec
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputExt = getTranscodeOutputExtension(presetRef);
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}${outputExt}`);

    // Transcode the file — use EncoderConfig when targetCodec is set
    const transcodePreset = buildTranscodePreset(
      presetRef,
      this.syncTagConfig?.encodingMode as
        | import('../../transcode/types.js').EncodingMode
        | undefined
    );
    const result = await this.transcoder.transcode(inputPath, outputPath, transcodePreset, {
      signal,
      transferMode: this.transferMode as
        | import('../../transcode/types.js').TransferMode
        | undefined,
      artworkResize: this.artworkResize,
      replayGain: this.buildReplayGainOption(operation.source),
    });

    return {
      operation,
      sourcePath: outputPath,
      isTemp: true,
      size: result.size,
      bitrate: result.bitrate,
      filetype: getTranscodeFiletypeLabel(presetRef),
      // Use the resolved input path for artwork extraction
      artworkSourcePath: inputPath,
      // Track downloaded file for cleanup after transfer (for artwork extraction)
      downloadedSourcePath: fileAccess.isDownloaded ? inputPath : undefined,
    };
  }

  /**
   * Prepare a direct-copy operation by getting file info.
   *
   * Direct-copy operations don't need CPU work, so this just returns the source info.
   * For remote sources (via adapter), the file is downloaded to a temp location.
   */
  private async prepareCopy(
    operation: Extract<SyncOperation, { type: 'add-direct-copy' }>,
    adapter?: CollectionAdapter,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source } = operation;

    // Use pre-resolved file access from prefetch, or resolve now (legacy/fallback)
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, adapter));
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
   * Prepare an optimized-copy operation by running FFmpeg in stream-copy mode.
   *
   * Unlike direct-copy which returns the source path unchanged, optimized-copy
   * runs FFmpeg to strip embedded artwork while preserving audio data as-is.
   * This produces a temp file with artwork removed.
   */
  private async prepareOptimizedCopy(
    operation: Extract<SyncOperation, { type: 'add-optimized-copy' }>,
    transcodeDir: string,
    adapter?: CollectionAdapter,
    signal?: AbortSignal,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source } = operation;

    // Resolve file access
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, adapter));
    const inputPath = fileAccess.path;

    // Determine format for FFmpeg args
    const format = getOptimizedCopyFormat(source);

    // Generate output path — keep same extension as input
    const ext = extname(source.filePath);
    const baseName = basename(source.filePath, ext);
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}${ext}`);

    // Build FFmpeg args and run
    const args = buildOptimizedCopyArgs(inputPath, outputPath, format, {
      artworkResize: this.artworkResize,
      replayGain: this.buildReplayGainOption(source),
    });
    await this.runFFmpeg(args, signal);

    // Get output file size
    const outputStat = await stat(outputPath);

    return {
      operation,
      sourcePath: outputPath,
      isTemp: true,
      size: outputStat.size,
      filetype: getFileTypeLabel(source.filePath),
      // Use the original source for artwork extraction (before stripping)
      artworkSourcePath: inputPath,
      // Track downloaded file for cleanup after transfer (for remote sources)
      downloadedSourcePath: fileAccess.isDownloaded ? inputPath : undefined,
    };
  }

  /**
   * Run FFmpeg with custom arguments.
   *
   * Used for optimized-copy operations that need FFmpeg but not the full
   * transcode pipeline (no progress parsing, no re-encoding).
   */
  private async runFFmpeg(args: string[], signal?: AbortSignal): Promise<void> {
    const ffmpegPath = this.transcoder.getFFmpegPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (signal) {
        const onAbort = () => {
          proc.kill('SIGTERM');
          reject(new Error('Operation aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        proc.on('close', () => signal.removeEventListener('abort', onAbort));
      }

      proc.on('error', (err: Error) => reject(err));
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(`FFmpeg optimized-copy failed with code ${code}: ${stderr.slice(-1000)}`)
          );
          return;
        }
        resolve();
      });
    });
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
    operation: Extract<SyncOperation, { type: MusicUpgradeOperationType }>,
    transcodeDir: string,
    adapter?: CollectionAdapter,
    signal?: AbortSignal,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    if (operation.type === 'upgrade-transcode') {
      // Needs transcoding — delegate to prepareTranscode using a synthetic transcode op
      const transcodeOp: Extract<SyncOperation, { type: 'add-transcode' }> = {
        type: 'add-transcode',
        source: operation.source,
        preset: operation.preset,
      };
      const prepared = await this.prepareTranscode(
        transcodeOp,
        transcodeDir,
        adapter,
        signal,
        prefetchedAccess
      );
      return { ...prepared, operation };
    } else if (operation.type === 'upgrade-artwork') {
      // Artwork-only — delegate to prepareCopy to resolve file access for artwork extraction
      const copyOp: Extract<SyncOperation, { type: 'add-direct-copy' }> = {
        type: 'add-direct-copy',
        source: operation.source,
      };
      const prepared = await this.prepareCopy(copyOp, adapter, prefetchedAccess);
      return { ...prepared, operation };
    } else if (operation.type === 'upgrade-optimized-copy') {
      // Optimized copy upgrade — route through FFmpeg for artwork stripping
      const optimizedOp: Extract<SyncOperation, { type: 'add-optimized-copy' }> = {
        type: 'add-optimized-copy',
        source: operation.source,
      };
      const prepared = await this.prepareOptimizedCopy(
        optimizedOp,
        transcodeDir,
        adapter,
        signal,
        prefetchedAccess
      );
      return { ...prepared, operation };
    } else {
      // upgrade-direct-copy — delegate to prepareCopy
      const copyOp: Extract<SyncOperation, { type: 'add-direct-copy' }> = {
        type: 'add-direct-copy',
        source: operation.source,
      };
      const prepared = await this.prepareCopy(copyOp, adapter, prefetchedAccess);
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
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { operation, sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;

    // Upgrade operations: replace file on existing track
    if (
      operation.type === 'upgrade-transcode' ||
      operation.type === 'upgrade-direct-copy' ||
      operation.type === 'upgrade-optimized-copy' ||
      operation.type === 'upgrade-artwork'
    ) {
      return this.transferUpgradeToIpod(prepared, artworkEnabled);
    }

    const source = operation.source;

    // Add track to iPod database
    const trackInput: DeviceTrackInput = {
      ...toDeviceTrackInput(source),
      filetype,
      ...(bitrate !== undefined && { bitrate }),
    };

    // Write sync tag for transcode operations
    if (operation.type === 'add-transcode' && operation.preset) {
      const syncTag = this.buildSyncTagForPreset(
        operation.preset.name,
        operation.preset.targetCodec
      );
      if (syncTag) {
        trackInput.syncTag = syncTag;
      }
    }

    // Write sync tag for copy operations (direct-copy and optimized-copy)
    if (
      (operation.type === 'add-direct-copy' || operation.type === 'add-optimized-copy') &&
      this.syncTagConfig
    ) {
      const sourceCodec = fileTypeToAudioCodec(operation.source.fileType, operation.source.codec);
      const copySyncTag = buildCopySyncTag(this.transferMode ?? 'fast', undefined, sourceCodec);
      trackInput.syncTag = copySyncTag;
    }

    const track = this.device.addTrack(trackInput);

    // Copy file to device
    this.device.copyTrackFile(track, sourcePath);

    // Request ReplayGain tag writes for transcoded/optimized-copy files.
    // Direct-copy files already have correct tags from the source — no write needed.
    // FFmpeg handles MP3/FLAC/OGG during transcode, but M4A needs the tag writer.
    if (
      operation.type !== 'add-direct-copy' &&
      this.audioNormalization === 'replaygain' &&
      source.normalization !== undefined
    ) {
      this.device.updateTrack(track, {
        writeReplayGainTags: true,
        normalization: source.normalization,
      });
    }

    // Extract and transfer artwork if enabled.
    // Use artworkSourcePath which is the original source file (or downloaded temp for remote).
    // Skip when the source explicitly has no artwork (hasArtwork === false) — the album-level
    // artwork cache could otherwise serve a sibling track's artwork for this no-artwork track,
    // falsely setting hasArtwork=true on the iPod and triggering artwork-removed on the next sync.
    if (artworkEnabled && source.hasArtwork !== false) {
      const extractedHash = await this.transferArtwork(track, artworkSourcePath);
      // Prefer the adapter's artwork hash (source.artworkHash) over the extracted hash.
      // For Subsonic sources, getCoverArt returns processed bytes that differ from the
      // raw embedded bytes in the audio file. Using the adapter's hash ensures the sync
      // tag matches what the adapter will compute on the next scan (consistency).
      const artHash = source.artworkHash ?? extractedHash;
      // Progressive hash write: when artwork is transferred, include the hash in the sync tag.
      // For transcode operations, the sync tag already exists — append the artwork hash.
      // For copy operations, no sync tag was written above, so create a minimal one
      // containing just the artwork hash so --check-artwork can detect future changes.
      if (artHash && this.syncTagConfig) {
        if (track.syncTag) {
          this.device.writeSyncTag(track, { artworkHash: artHash });
        } else if (
          operation.type === 'add-direct-copy' ||
          operation.type === 'add-optimized-copy'
        ) {
          // Copy operation: no existing sync tag. Write a minimal tag with just the artwork hash.
          this.device.writeSyncTag(track, { quality: 'copy', artworkHash: artHash });
        }
      } else if (!artHash && track.hasArtwork) {
        // Defensive: artwork extraction returned null but track somehow has artwork — clean up
        this.device.removeTrackArtwork(track);
      }
    }

    return { bytesTransferred: size, track };
  }

  /**
   * Transfer an upgrade file to the iPod, replacing the existing track's file.
   *
   * Preserves the database entry (play counts, ratings, playlist membership)
   * while swapping the audio file and updating technical metadata.
   *
   * For `artwork-updated` upgrades, the audio file is NOT replaced — only the
   * artwork is re-extracted from the source and transferred to the iPod.
   */
  private async transferUpgradeToIpod(
    prepared: PreparedFile,
    artworkEnabled: boolean
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;
    const operation = prepared.operation as Extract<
      SyncOperation,
      { type: MusicUpgradeOperationType }
    >;
    const { source, target } = operation;

    // Find the existing track in the database by filePath
    const tracks = this.device.getTracks();
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

    // artwork-removed: remove artwork from iPod track and clear artworkHash from sync tag
    if (operation.reason === 'artwork-removed') {
      foundTrack = this.device.removeTrackArtwork(foundTrack);
      // Clear artworkHash from sync tag if present
      if (this.syncTagConfig && foundTrack.syncTag?.artworkHash) {
        foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: undefined });
      }
      return { bytesTransferred: 0, track: foundTrack };
    }

    // artwork-updated: skip audio file transfer, only re-extract and update artwork + sync tag
    if (operation.reason === 'artwork-updated') {
      if (!artworkEnabled) {
        // artwork-updated with artwork disabled is a no-op — skip silently
        return { bytesTransferred: 0, track: foundTrack };
      }
      const extractedHash = await this.transferArtwork(foundTrack, artworkSourcePath);
      // Prefer the adapter's artwork hash for sync tag consistency (see transferToIpod comment)
      const artHash = source.artworkHash ?? extractedHash;
      if (artHash && this.syncTagConfig) {
        if (foundTrack.syncTag) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: artHash });
        } else {
          // No existing sync tag (e.g., copied lossy track). Write minimal tag with artwork hash.
          foundTrack = this.device.writeSyncTag(foundTrack, {
            quality: 'copy',
            artworkHash: artHash,
          });
        }
      }
      return { bytesTransferred: 0, track: foundTrack };
    }

    // Replace the audio file (preserves database entry, playlists, play counts)
    foundTrack = this.device.replaceTrackFile(foundTrack, sourcePath);

    // Update technical metadata to reflect the new file
    const updateFields: DeviceTrackMetadata = {
      filetype,
      ...(bitrate !== undefined && { bitrate }),
      ...(source.duration !== undefined && { duration: source.duration }),
      ...(source.normalization !== undefined && { normalization: source.normalization }),
    };

    // Update metadata fields from source that may have changed
    if (source.genre !== undefined) updateFields.genre = source.genre;
    if (source.year !== undefined) updateFields.year = source.year;
    if (source.trackNumber !== undefined) updateFields.trackNumber = source.trackNumber;
    if (source.discNumber !== undefined) updateFields.discNumber = source.discNumber;
    if (source.albumArtist !== undefined) updateFields.albumArtist = source.albumArtist;
    if (source.compilation !== undefined) updateFields.compilation = source.compilation;

    // Request ReplayGain tag writes for transcoded/optimized-copy upgrades.
    // Direct-copy upgrades preserve source file tags — no write needed.
    if (
      operation.type !== 'upgrade-direct-copy' &&
      this.audioNormalization === 'replaygain' &&
      source.normalization !== undefined
    ) {
      updateFields.writeReplayGainTags = true;
      updateFields.normalization = source.normalization;
    }

    foundTrack = this.device.updateTrack(foundTrack, updateFields);

    // Write sync tag for upgrade-transcode operations (has preset)
    if (operation.type === 'upgrade-transcode') {
      const syncTag = this.buildSyncTagForPreset(
        operation.preset.name,
        operation.preset.targetCodec
      );
      if (syncTag) {
        foundTrack = this.device.writeSyncTag(foundTrack, syncTag);
      }
    }

    // Write sync tag for upgrade-direct-copy and upgrade-optimized-copy operations
    if (
      (operation.type === 'upgrade-direct-copy' || operation.type === 'upgrade-optimized-copy') &&
      this.syncTagConfig
    ) {
      const sourceCodec = fileTypeToAudioCodec(operation.source.fileType, operation.source.codec);
      const copySyncTag = buildCopySyncTag(this.transferMode ?? 'fast', undefined, sourceCodec);
      foundTrack = this.device.writeSyncTag(foundTrack, copySyncTag);
    }

    // Extract and transfer artwork if enabled.
    // Skip when the source explicitly has no artwork (hasArtwork === false) — see transferToIpod
    // for a full explanation of why this guard is necessary.
    if (artworkEnabled && source.hasArtwork !== false) {
      const extractedHash = await this.transferArtwork(foundTrack, artworkSourcePath);
      // Prefer the adapter's artwork hash for sync tag consistency (see transferToIpod comment)
      const artHash = source.artworkHash ?? extractedHash;
      if (artHash && this.syncTagConfig) {
        // Progressive hash write: include artwork hash in sync tag for future change detection
        if (foundTrack.syncTag) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: artHash });
        } else if (operation.type !== 'upgrade-transcode') {
          // Copy upgrade: no sync tag was written. Write a minimal tag with the artwork hash.
          foundTrack = this.device.writeSyncTag(foundTrack, {
            quality: 'copy',
            artworkHash: artHash,
          });
        }
      } else if (!artHash && foundTrack.hasArtwork) {
        // Artwork extraction returned null but iPod track has artwork — clean up stale artwork
        foundTrack = this.device.removeTrackArtwork(foundTrack);
        // Clear artworkHash from sync tag if present
        if (this.syncTagConfig && foundTrack.syncTag?.artworkHash) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: undefined });
        }
      }
    }

    return { bytesTransferred: size, track: foundTrack };
  }

  /**
   * Build a SyncTagData from a preset name and the current sync tag config.
   *
   * Returns undefined if no sync tag config is set (sync tags disabled).
   */
  private buildSyncTagForPreset(presetName: string, targetCodec?: string): SyncTagData | undefined {
    if (!this.syncTagConfig) {
      return undefined;
    }

    return buildAudioSyncTag(
      presetName,
      this.syncTagConfig.encodingMode,
      this.syncTagConfig.customBitrate,
      this.transferMode,
      targetCodec
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
    case 'add-transcode':
      return 'transcoding';
    case 'add-direct-copy':
    case 'add-optimized-copy':
      return 'copying';
    case 'remove':
      return 'removing';
    case 'update-metadata':
    case 'update-sync-tag':
      return 'updating-metadata';
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
      return 'upgrading';
    case 'video-transcode':
      return 'video-transcoding';
    case 'video-copy':
      return 'video-copying';
    case 'video-remove':
      return 'removing';
    case 'video-update-metadata':
      return 'video-updating-metadata';
    case 'video-upgrade':
      return 'video-upgrading';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new music sync pipeline
 */
export function createMusicPipeline(deps: ExecutorDependencies): SyncExecutor {
  return new MusicPipeline(deps);
}

/**
 * Execute a music sync plan with simplified interface
 *
 * This is a convenience function that collects all progress events
 * and returns a final result.
 */
export async function executeMusicPlan(
  plan: SyncPlan,
  deps: ExecutorDependencies,
  options: ExtendedExecuteOptions = {}
): Promise<ExecuteResult> {
  const executor = new MusicPipeline(deps);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytesTransferred = 0;
  const errors: Array<{ operation: SyncOperation; error: Error }> = [];
  const categorizedErrors: CategorizedError[] = [];

  for await (const progress of executor.execute(plan, options)) {
    if (progress.error) {
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
    }

    // Derive completed from executor's completedCount (which includes failed and skipped)
    completed = progress.completedCount - failed - skipped;
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
