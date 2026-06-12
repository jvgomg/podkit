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

import { mkdir, stat, rename } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { PODKIT_TEMP_SUFFIX } from '../../utils/atomic-fs.js';
import { getOwnIdentity, writeOwnership, type PidFileEntry } from '../../lib/pid-file.js';
import { devPause } from '../../dev/hooks.js';

import { AsyncQueue } from '../../utils/async-queue.js';
import { streamToTempFile, cleanupTempFile } from '../../utils/stream.js';
import { soundcheckToReplayGainDb } from '../../metadata/normalization.js';
import {
  categorizeError as sharedCategorizeError,
  getRetriesForCategory as sharedGetRetriesForCategory,
  createCategorizedError as sharedCreateCategorizedError,
  type RetryConfig as SharedRetryConfig,
} from '../engine/error-handling.js';

import type { CollectionTrack, CollectionAdapter } from '../../adapters/interface.js';
import type { AudioFileType } from '../../types.js';
import type {
  FFmpegTranscoder,
  OptimizedCopyFormat,
  EncoderConfig,
} from '../../transcode/ffmpeg.js';
import { buildOptimizedCopyArgs } from '../../transcode/ffmpeg.js';
import { getCodecMetadata } from '../../transcode/codecs.js';
import { getCodecPresetBitrate, getCodecVbrQuality } from '../../transcode/types.js';
import type { TransferMode } from '../../transcode/types.js';
import type { TranscodePresetRef } from '../engine/types.js';
import { runPreliminariesPreFlight, assertSpaceAfterSweep } from '../engine/pre-sync-sweep.js';
import type {
  ExecuteOptions,
  SyncExecutor,
  SyncOperation,
  SyncPlan,
  SyncProgress,
  ErrorCategory as ErrorCategoryFromTypes,
  CategorizedError as CategorizedErrorFromTypes,
  Warning as WarningFromTypes,
  WarningSink,
  ExecutorProgress as ExecutorProgressFromTypes,
  ExecuteResult as ExecuteResultFromTypes,
} from '../engine/types.js';
import type { DeviceAdapter, DeviceTrackMetadata } from '../../device/adapter.js';
import { isOggExtension } from '../../audio/containers.js';
import { MusicArtworkManager } from './artwork.js';
import { MusicTransferOps } from './transfer.js';
import type { ExecutionContext } from './execution-context.js';
import type { SyncTagConfig } from './pipeline-options.js';
export type { SyncTagConfig } from './pipeline-options.js';

// =============================================================================
// Container format helpers — re-exported from audio/containers.ts
// =============================================================================

/** @see audio/containers.ts for definition */
export { isOggExtension } from '../../audio/containers.js';

// =============================================================================
// Extended Types — re-exported from types.ts (canonical definitions)
// =============================================================================

/** @see types.ts for canonical definition */
export type ErrorCategory = ErrorCategoryFromTypes;

/** @see types.ts for canonical definition */
export type CategorizedError = CategorizedErrorFromTypes;

/** @see types.ts for canonical definition */
export type Warning = WarningFromTypes;

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
  transferMode?: TransferMode;
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
   * Resize sidecar artwork (peer `cover.jpg`) to this maximum dimension
   * (pixels, square).
   *
   * When set, bytes destined for `adapter.setTrackArtwork()` on sidecar-sink
   * tracks are downscaled to this dimension via the album-level resize cache
   * so siblings on one album share a single FFmpeg/sharp spawn. Used for
   * sidecar-primary devices (rockbox). Distinct from `artworkResize` to keep
   * the FFmpeg embed path inert — on sidecar-primary devices the file body
   * should stay art-free.
   */
  sidecarResize?: number;
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

import type {
  MusicFileOperationType,
  MusicUpgradeOperationType,
  PreparedFile,
} from './pipeline-types.js';
export type { PreparedFile } from './pipeline-types.js';

/**
 * Dependencies required by the executor
 */
export interface ExecutorDependencies {
  /** Device adapter for track operations (iPod, mass-storage, etc.) */
  device: DeviceAdapter;
  /** FFmpeg transcoder for audio conversion */
  transcoder: FFmpegTranscoder;
}

/** Default pipeline buffer size (number of prepared files to buffer between preparer and consumer) */
const PIPELINE_BUFFER_SIZE = 3;

/** Number of files to download ahead of the transcoder (for remote sources) */
const PREFETCH_BUFFER_SIZE = 2;

/**
 * Cached process identity for `.owner` writes on transcode scratch dirs.
 *
 * One `getOwnIdentity()` call per process is enough — the tuple never
 * changes for the lifetime of this Node process. The walker uses the
 * same `{pid, startTimeMs}` shape to detect live owners and skip them.
 */
const OWN_IDENTITY: PidFileEntry = getOwnIdentity();

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
 * Map a known file extension to its `AudioFileType` discriminant, or `null`
 * for unrecognised extensions.
 *
 * Kept extension-driven (not codec-driven) because the call sites only have
 * `source.filePath` in scope and ALAC tracks legitimately diverge from this
 * mapping: ALAC lives in a `.m4a` container but has `fileType = 'alac'`. The
 * extension `.m4a` therefore resolves to `m4a` (AAC display label) here, and
 * the codec-aware paths handle ALAC disambiguation elsewhere
 * (see `getOptimizedCopyFormat`).
 */
function extensionToAudioFileType(ext: string): AudioFileType | null {
  switch (ext) {
    case '.mp3':
      return 'mp3';
    case '.m4a':
      return 'm4a';
    case '.aac':
      return 'aac';
    case '.alac':
      return 'alac';
    case '.opus':
      return 'opus';
    case '.flac':
      return 'flac';
    case '.ogg':
      return 'ogg';
    case '.wav':
      return 'wav';
    case '.aiff':
    case '.aif':
      return 'aiff';
    default:
      return null;
  }
}

/**
 * Get the human-readable filetype label for an `AudioFileType` discriminant.
 *
 * Exhaustive over `AudioFileType` via `assertNever`: adding a new member to
 * `AudioFileType` is a compile error here, forcing an explicit decision
 * instead of silently producing a `'Audio file'` fallback (which the
 * mass-storage adapter then turns into a `.Audio file` filename on the
 * device — see `KNOWN_DEBRIS_EXTENSIONS` in `device/mass-storage-utils.ts`).
 */
export function getFileTypeLabelForFileType(fileType: AudioFileType): string {
  switch (fileType) {
    case 'mp3':
      return 'MPEG audio file';
    case 'm4a':
    case 'aac':
      return 'AAC audio file';
    case 'alac':
      // Match CODEC_METADATA.alac.filetypeLabel so the mass-storage adapter's
      // resolveFileExtension round-trips this label back to .m4a (ALAC's real
      // container) instead of landing a `.Apple Lossless audio file` filename.
      return 'ALAC audio file';
    case 'opus':
      return 'Opus audio file';
    case 'flac':
      return 'FLAC audio file';
    case 'ogg':
      return 'Ogg Vorbis audio file';
    case 'wav':
      return 'WAV audio file';
    case 'aiff':
      return 'AIFF audio file';
    default:
      return assertNever(fileType, `unhandled AudioFileType for filetype label: ${fileType}`);
  }
}

/**
 * Get a human-readable filetype label based on file extension.
 *
 * Used for the iPod database `filetype` field which displays the format
 * in iTunes and on the device.
 *
 * Unrecognised extensions return the generic `'Audio file'` fallback. This
 * is preserved for defence-in-depth: source files reach this helper from
 * adapter-supplied `CollectionTrack.filePath` strings, and an upstream bug
 * that delivered a non-audio path (or a typed-but-not-yet-mapped extension)
 * shouldn't crash the sync. The compile-time exhaustiveness check lives in
 * `getFileTypeLabelForFileType` instead.
 */
export function getFileTypeLabel(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const fileType = extensionToAudioFileType(ext);
  if (fileType === null) return 'Audio file';
  return getFileTypeLabelForFileType(fileType);
}

/**
 * Map a track's source `fileType` to the FFmpeg container format used for
 * optimized-copy. Exhaustive over `AudioFileType`: adding a new file type
 * forces an explicit decision here (the compiler points at the never branch).
 *
 * ALAC files are stored in the same .m4a container as AAC; the codec is the
 * disambiguator, so it overrides the fileType-based mapping when present.
 */
function getOptimizedCopyFormat(track: CollectionTrack): OptimizedCopyFormat {
  if (track.codec?.toLowerCase() === 'alac') return 'alac';
  switch (track.fileType) {
    case 'mp3':
      return 'mp3';
    case 'alac':
      return 'alac';
    case 'opus':
      return 'opus';
    case 'ogg':
      return 'vorbis';
    case 'flac':
      return 'flac';
    case 'm4a':
    case 'aac':
      return 'm4a';
    case 'wav':
    case 'aiff':
      // WAV/AIFF aren't valid optimized-copy outputs on any device today —
      // mass-storage filters them and iPod transcodes lossless to ALAC/AAC.
      // Surface the misuse early instead of corrupting the file with the
      // wrong container.
      throw new Error(
        `optimized-copy unsupported for ${track.fileType} sources (would need a separate container handler)`
      );
    default:
      return assertNever(
        track.fileType,
        `unhandled fileType for optimized-copy: ${track.fileType}`
      );
  }
}

function assertNever(_value: never, message: string): never {
  throw new Error(message);
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
    case 'relocate':
      return `${operation.source.artist} - ${operation.source.title}`;
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
    space: 0,
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
 * Thrown when {@link MusicPipeline.execute} is invoked while another
 * `execute()` is in-flight on the same instance.
 *
 * Historical context: the pipeline used to store per-execute state on `this`,
 * so overlapping calls would silently clobber each other. After the
 * ExecutionContext refactor (TASK-382) all per-execute state lives in a
 * parameter, and the pipeline is structurally safe for concurrent execution.
 *
 * This guard is now a **defensive net** rather than a correctness requirement
 * — it still rejects overlapping calls to surface misuse early (and because
 * the album / resized-artwork caches are still per-instance and would be
 * cleared by the second `execute()` mid-flight). Sequential reuse on the
 * same instance is fully supported.
 */
export class PipelineBusyError extends Error {
  constructor() {
    super(
      'MusicPipeline.execute() invoked while another execute() is in-flight on the same instance. ' +
        'Although per-call state is now passed via an ExecutionContext parameter (so concurrent ' +
        'execute() would not corrupt that state), the album-artwork and resized-artwork caches ' +
        'are still per-instance and would be cleared mid-flight by the second call. Allocate one ' +
        'MusicPipeline per concurrent sync, or sequence calls (`await pipeline.execute(...); ' +
        'pipeline.execute(...);`).'
    );
    this.name = 'PipelineBusyError';
  }
}

/**
 * Three-stage music sync pipeline (ADR-011)
 *
 * Handles execution of sync operations including transcoding, copying,
 * removing, updating metadata, and upgrading tracks on the device.
 *
 * ## Concurrency contract
 *
 * Per-execute state (adapter, transferMode, artworkResize, ...) lives in an
 * {@link ExecutionContext} object built at the top of `execute()` and threaded
 * through every private method. Concurrent `execute()` calls on the same
 * instance cannot corrupt each other's option state.
 *
 * However, the album-artwork cache and resized-artwork cache are still
 * per-instance — `execute()` clears them at entry. Two overlapping calls
 * would have the second `execute()` wipe the first's caches mid-flight,
 * causing redundant extraction work. The {@link PipelineBusyError} guard
 * keeps rejecting overlapping calls for that reason.
 *
 * Sequential reuse on the same instance (`await execute(); execute();`) is
 * fully supported — the second call gets a fresh context and fresh caches.
 *
 * @see doc-041 §3.6 + §5.7 for the rough-edge documentation.
 */
export class MusicPipeline implements SyncExecutor {
  private device: DeviceAdapter;
  private transcoder: FFmpegTranscoder;
  /** Warnings collected during execution */
  private warnings: Warning[] = [];
  /** Sink passed to sub-managers; appends to {@link warnings}. */
  private readonly warningSink: WarningSink = {
    emit: (w) => this.addWarning(w),
  };
  /**
   * True while an `execute()` iterator is in-flight. Used by the defensive
   * guard in `execute()` to throw a {@link PipelineBusyError} on overlap,
   * since the per-instance artwork caches would be cleared by the second
   * `execute()` mid-flight.
   */
  private executing = false;
  /**
   * Artwork manager — owns the per-album extraction cache, the per-album
   * resized-artwork cache, and the per-album sibling candidate map.
   *
   * Constructed once per pipeline instance. Caches are cleared at every
   * `execute()` entry via {@link MusicArtworkManager.clearCaches}.
   *
   * Public on the instance (`pipeline.artwork`) so tests can spy on
   * `transferArtwork` without resorting to `as any` gymnastics. The
   * `readonly` qualifier signals that the manager itself is not swappable
   * after construction — callers wanting to mock the surface should override
   * the methods on the live instance.
   */
  readonly artwork: MusicArtworkManager;
  /**
   * Transfer operations — owns the `transferToIpod` / `transferUpgradeToIpod`
   * dispatchers extracted by TASK-383. Constructed with the device adapter
   * and the artwork manager so all device writes (track add, file copy,
   * artwork transfer, sync-tag write) flow through one place.
   *
   * Public on the instance for the same reason `artwork` is — tests that
   * want to observe transfer-stage behaviour can spy directly without
   * `as any` gymnastics.
   */
  readonly transfer: MusicTransferOps;

  constructor(deps: ExecutorDependencies) {
    this.device = deps.device;
    this.transcoder = deps.transcoder;
    this.artwork = new MusicArtworkManager(this.device, this.warningSink);
    this.transfer = new MusicTransferOps(this.device, this.artwork);
  }

  /**
   * Get warnings collected during the most recent execution
   */
  getWarnings(): Warning[] {
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
  private addWarning(warning: Warning): void {
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
    source: CollectionTrack,
    ctx: ExecutionContext
  ): { trackGain: number; trackPeak?: number; albumGain?: number; albumPeak?: number } | undefined {
    if (ctx.audioNormalization !== 'replaygain') return undefined;
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
    // Defensive guard: the per-instance album-artwork and resized-artwork
    // caches would be cleared by a second `execute()` mid-flight. Throw
    // early with an actionable message instead. The flag is flipped to true
    // only AFTER any code that could throw — it's the first thing inside
    // the try/finally below — so a setup failure can't strand the instance
    // in a permanently-busy state.
    if (this.executing) {
      throw new PipelineBusyError();
    }

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
      sidecarResize,
      audioNormalization,
      saveInterval = 50,
    } = options;

    // Build the per-execute context. All option-derived state lives here
    // (rather than on `this`) so concurrent execute() calls cannot corrupt
    // each other's state via shared instance fields.
    const ctx: ExecutionContext = {
      adapter,
      transferMode,
      artworkResize,
      sidecarResize,
      audioNormalization,
      syncTagConfig,
      artworkEnabled: artwork,
    };

    // Clear per-instance cache state from previous execution.
    // These caches are NOT per-execute state — they're instance-scoped
    // performance caches that get reset at the start of each run.
    this.clearWarnings();
    this.artwork.clearCaches();

    // Pre-compute per-album sibling candidates so the artwork cache can
    // resolve "album art" deterministically regardless of which track is
    // processed first. See `MusicArtworkManager.buildAlbumCandidates` for
    // the gating rule (directory adapter only).
    this.artwork.buildAlbumCandidates(plan, ctx);

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
    try {
      // Flip the busy flag now — paired with `this.executing = false` in the
      // finally below. Setting it INSIDE try guarantees the finally runs.
      this.executing = true;

      // Wire the adapter into the warning sink for the duration of this run,
      // so execute-phase warnings (e.g. iPod portable tag-write failures) land
      // in the pipeline's accumulator instead of being dropped on the floor.
      // Optional method — adapters that never emit warnings can omit it.
      this.device.setWarningSink?.(this.warningSink);

      // Pre-sync sweep pre-flight (TASK-398). When plan.preliminaries is set
      // (only the FIRST collection's plan against a given device carries
      // it), clean up debris before track ops run. No-op in dry-run; the
      // presenter renders the preliminaries from the plan directly.
      // The adapter is threaded through so the helper can auto-prune
      // phantom manifest entries on mass-storage devices.
      if (plan.preliminaries) {
        const preflight = await runPreliminariesPreFlight(plan.preliminaries, {
          dryRun,
          warningSink: this.warningSink,
          signal,
          adapter: this.device,
        });
        if (!dryRun && preflight.debrisDeleted > 0) {
          // Single log line per task spec §4.
          // Use the device adapter's stdout-equivalent if available, else
          // skip — the warnings accumulator already records failures.
          // (The orchestrator will surface the summary line via the
          // presenter's renderPreamble in the same render pass.)
        }
        if (!dryRun && this.device) {
          assertSpaceAfterSweep({
            mountPoint: this.device.mountPoint,
            bytesNeeded: plan.estimatedSize,
            preflight,
          });
        }
      }

      if (needsTempDir && !dryRun) {
        await mkdir(transcodeDir, { recursive: true });
        // Stamp ownership BEFORE the first transcode op. The walker
        // reads `.owner` to tell a live transcode session apart from
        // SIGKILLed prior debris. A crash between mkdir and the write
        // below leaves the dir without an `.owner` file, which the
        // walker treats as orphaned and reaps — the worst-case is a
        // just-created empty dir gets reaped, harmless.
        await writeOwnership(join(transcodeDir, '.owner'), OWN_IDENTITY);
      }

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
        signal,
        saveInterval,
        ctx
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
      // Release the concurrent-execute guard. Reset in finally so an
      // exception (including PipelineBusyError itself, though it short-
      // circuits before the flag flips) or early `break` from the iterator
      // consumer cannot leave the instance permanently busy.
      this.executing = false;
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
    signal: AbortSignal | undefined,
    saveInterval: number,
    ctx: ExecutionContext
  ): AsyncIterable<ExecutorProgress> {
    const total = plan.operations.length;
    const prefetchQueue = new AsyncQueue<PrefetchedFile>(PREFETCH_BUFFER_SIZE);
    const transferQueue = new AsyncQueue<PreparedFile>(PIPELINE_BUFFER_SIZE);
    const { adapter } = ctx;

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
            await this.executeUpdateMetadata(operation, ctx);
            inlineCompletions.push(operation);
            inlineCompleted++;
          } else if (operation.type === 'update-sync-tag') {
            await this.executeUpdateSyncTag(operation);
            inlineCompletions.push(operation);
            inlineCompleted++;
          } else if (operation.type === 'relocate') {
            await this.executeRelocate(operation, ctx);
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
              () => this.prepareTranscode(operation, transcodeDir, ctx, signal, fileAccess),
              operation,
              retryConfig
            );
          } else if (operation.type === 'add-direct-copy') {
            result = await this.prepareWithRetry(
              () => this.prepareCopy(operation, ctx, fileAccess),
              operation,
              retryConfig
            );
          } else if (operation.type === 'add-optimized-copy') {
            result = await this.prepareWithRetry(
              () => this.prepareOptimizedCopy(operation, transcodeDir, ctx, signal, fileAccess),
              operation,
              retryConfig
            );
          } else {
            // upgrade-transcode, upgrade-direct-copy, upgrade-optimized-copy, upgrade-artwork
            result = await this.prepareWithRetry(
              () => this.prepareUpgrade(operation, transcodeDir, ctx, signal, fileAccess),
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
        const result = await this.transferWithRetry(prepared, retryConfig, ctx);

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

    // The engine SyncExecutor owns the final `device.save()` now — see
    // engine/executor.ts and ADR-019. The previous pipeline-internal save
    // (plus the 'updating-db' yield that paired with it) lived here and
    // was redundant once music started running through the engine path
    // via MusicHandler.executeBatch.

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
    retryConfig: Required<RetryConfig>,
    ctx: ExecutionContext
  ): Promise<
    | { value: { bytesTransferred: number }; error?: undefined; attempts?: number }
    | { value: null; error: Error; attempts: number }
  > {
    let lastError: Error | undefined;
    let attempt = 0;

    while (true) {
      try {
        const result = await this.transfer.transferToIpod(prepared, ctx);
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
   * Execute a remove operation.
   *
   * **Live inline-completion path** — called directly by {@link executePipeline}'s
   * downloader stage for non-file operations (`remove`, `update-metadata`,
   * `update-sync-tag`, `relocate`). These four methods complete synchronously
   * inside the downloader and do not enter the prepare/transfer pipeline stages.
   *
   * Note: the former `executeOperation`, `executeTranscode`, and `executeCopy`
   * helper methods were deleted as dead code; these four are their still-active
   * siblings and serve a different role (in-place database mutations, not
   * file transfers).
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
   * Execute an update-metadata operation.
   *
   * Live inline-completion path — see {@link executeRemove} for the role of
   * these four methods in {@link executePipeline}.
   *
   * Updates device track metadata without transferring any files.
   * Used for transform changes (e.g., clean artists enable/disable) where
   * only artist/title fields need updating.
   *
   * Preserves play statistics (play count, rating, skip count).
   */
  private async executeUpdateMetadata(
    operation: Extract<SyncOperation, { type: 'update-metadata' }>,
    ctx: ExecutionContext
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
    if (metadata.bitrate !== undefined) {
      // Bitrate is carried on metadata-only updates by the `--force-sync-tags`
      // baseline backfill in `handler.postProcessBitrateBaseline`. Pre-existing
      // tracks added before bitrate was persisted (or by a third-party tool)
      // can pick up `source.bitrate` here so the next sync's `detectUpgrades`
      // has both sides of the comparison to work with.
      updateFields.bitrate = metadata.bitrate;
    }
    // Tell the adapter which transfer mode is in effect so device-specific
    // tag-write policies (iPod portable, etc.) can fire.
    if (ctx.transferMode) {
      updateFields.transferMode = ctx.transferMode;
    }
    // Update the track metadata (preserves play stats automatically)
    this.device.updateTrack(foundTrack, updateFields);

    // No bytes transferred for metadata-only updates
    return { bytesTransferred: 0 };
  }

  /**
   * Execute an update-sync-tag operation.
   *
   * Live inline-completion path — see {@link executeRemove} for the role of
   * these four methods in {@link executePipeline}.
   *
   * Writes a typed sync tag to the device track's comment field without
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

  /**
   * Execute a relocate operation.
   *
   * Live inline-completion path — see {@link executeRemove} for the role of
   * these four methods in {@link executePipeline}.
   *
   * Moves a track file to its expected path on a mass-storage device.
   * Uses fs.rename (same-filesystem, no data copy). Also applies any
   * metadata updates if the operation carries them.
   */
  private async executeRelocate(
    operation: Extract<SyncOperation, { type: 'relocate' }>,
    ctx: ExecutionContext
  ): Promise<{ bytesTransferred: number }> {
    const { track: targetTrack, newPath, metadata } = operation;

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
      throw new Error(
        `Track not found for relocation: ${targetTrack.artist} - ${targetTrack.title}`
      );
    }

    // Relocate the file (adapter handles fs.rename and tracking updates)
    let trackAfterRelocate = foundTrack;
    if (typeof (this.device as any).relocateTrack === 'function') {
      trackAfterRelocate = (this.device as any).relocateTrack(foundTrack, newPath);
    }

    // Apply metadata updates if any
    if (metadata && Object.keys(metadata).length > 0) {
      const withMode: DeviceTrackMetadata = ctx.transferMode
        ? { ...metadata, transferMode: ctx.transferMode }
        : { ...metadata };
      this.device.updateTrack(trackAfterRelocate, withMode);
    }

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
    ctx: ExecutionContext,
    signal?: AbortSignal,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source, preset: presetRef } = operation;

    // Use pre-resolved file access from prefetch, or resolve now (legacy/fallback)
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, ctx.adapter));
    const inputPath = fileAccess.path;

    // Generate output path in temp directory — derive extension from target codec.
    // FFmpeg writes to <outputPath>.podkit-tmp first; we rename on success so a
    // crashed/killed transcode never surfaces a partial file under outputPath.
    const baseName = basename(source.filePath, extname(source.filePath));
    const outputExt = getTranscodeOutputExtension(presetRef);
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}${outputExt}`);
    const tmpOutputPath = outputPath + PODKIT_TEMP_SUFFIX;

    // Transcode the file — use EncoderConfig when targetCodec is set
    const transcodePreset = buildTranscodePreset(
      presetRef,
      ctx.syncTagConfig?.encodingMode as import('../../transcode/types.js').EncodingMode | undefined
    );
    const result = await this.transcoder.transcode(inputPath, tmpOutputPath, transcodePreset, {
      signal,
      transferMode: ctx.transferMode as import('../../transcode/types.js').TransferMode | undefined,
      artworkResize: ctx.artworkResize,
      replayGain: this.buildReplayGainOption(operation.source, ctx),
    });
    // Test seam: in a debug build invoked with
    // `PODKIT_DEV_PAUSE_KEY=pre-rename-transcode`, this blocks forever
    // after the transcoded `.podkit-tmp` lands but before the move-out
    // rename, so e2e tests can SIGKILL the sync and assert the next
    // sync's sweep reaps the orphaned `podkit-transcode-<uuid>/`
    // scratch dir. Production builds tree-shake the entire branch —
    // neither the call nor the key string survives the bundle. See
    // `documents/architecture/dev-builds.md`.
    if (typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__) {
      await devPause('pre-rename-transcode');
    }
    await rename(tmpOutputPath, outputPath);

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
    ctx: ExecutionContext,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source } = operation;

    // Use pre-resolved file access from prefetch, or resolve now (legacy/fallback)
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, ctx.adapter));
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
    ctx: ExecutionContext,
    signal?: AbortSignal,
    prefetchedAccess?: ResolvedFileAccess
  ): Promise<PreparedFile> {
    const { source } = operation;

    // Resolve file access
    const fileAccess = prefetchedAccess ?? (await getTrackFilePath(source, ctx.adapter));
    const inputPath = fileAccess.path;

    // Determine format for FFmpeg args
    const format = getOptimizedCopyFormat(source);

    // Generate output path — keep same extension as input. FFmpeg writes to
    // <outputPath>.podkit-tmp first; we rename on success.
    const ext = extname(source.filePath);
    const baseName = basename(source.filePath, ext);
    const outputPath = join(transcodeDir, `${baseName}-${randomUUID()}${ext}`);
    const tmpOutputPath = outputPath + PODKIT_TEMP_SUFFIX;

    // Build FFmpeg args and run
    const args = buildOptimizedCopyArgs(inputPath, tmpOutputPath, format, {
      artworkResize: ctx.artworkResize,
      replayGain: this.buildReplayGainOption(source, ctx),
    });
    await this.runFFmpeg(args, signal);
    // Same `pre-rename-transcode` seam as prepareTranscode above —
    // covers the optimized-copy path so e2e tests don't need to pick
    // between lossless-vs-compatible-lossy source formats to trigger
    // the pause. Tree-shakes in production (see prepareTranscode for
    // the rationale).
    if (typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__) {
      await devPause('pre-rename-transcode');
    }
    await rename(tmpOutputPath, outputPath);

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

      // Detach the abort listener on every exit path (close, error, kill), not
      // just successful close — otherwise an FFmpeg that errors before exit
      // leaves the listener attached to the (often longer-lived) AbortSignal.
      const cleanup = signal ? () => signal.removeEventListener('abort', onAbort) : () => {};
      const onAbort = signal
        ? () => {
            proc.kill('SIGTERM');
            cleanup();
            reject(new Error('Operation aborted'));
          }
        : () => {};
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      proc.on('error', (err: Error) => {
        cleanup();
        reject(err);
      });
      proc.on('close', (code) => {
        cleanup();
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
    ctx: ExecutionContext,
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
        ctx,
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
      const prepared = await this.prepareCopy(copyOp, ctx, prefetchedAccess);
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
        ctx,
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
      const prepared = await this.prepareCopy(copyOp, ctx, prefetchedAccess);
      return { ...prepared, operation };
    }
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
    case 'relocate':
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

  // `executeMusicPlan` is the library-level convenience that bypasses the
  // engine SyncExecutor; preserve the historic "fully persisted" contract
  // by saving here. Inside the CLI path, save is owned by the engine
  // (ADR-019) so the pipeline itself does not save.
  if (!options.dryRun && (completed > 0 || failed > 0)) {
    await deps.device.save();
  }

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
