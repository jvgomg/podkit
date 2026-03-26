/**
 * Sync engine types
 *
 * Types for comparing collections, planning sync operations,
 * and executing sync plans.
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { TrackMetadata } from '../types.js';
import type { IPodTrack } from '../ipod/types.js';
import type { DeviceTrack } from '../device/adapter.js';
import type { SyncTagData } from './sync-tags.js';
import type {
  EncodingMode,
  QualityPreset,
  TranscodeConfig,
  TranscodeProgress,
  TransferMode,
} from '../transcode/types.js';
import type { DeviceCapabilities } from '../device/capabilities.js';
import type { CollectionVideo } from '../video/directory-adapter.js';
import type { VideoTranscodeSettings } from '../video/types.js';
import type { DeviceVideo } from './video-types.js';

// Re-export for use within sync module
export type { IPodTrack, DeviceTrack };

// =============================================================================
// Update Types (for transforms)
// =============================================================================

/**
 * Reasons related to track upgrades (self-healing sync)
 *
 * @see ADR-009 for full design context
 */
export type UpgradeReason =
  | 'format-upgrade'
  | 'quality-upgrade'
  | 'preset-upgrade'
  | 'preset-downgrade'
  | 'force-transcode'
  | 'transfer-mode-changed'
  | 'artwork-added'
  | 'artwork-removed'
  | 'artwork-updated'
  | 'soundcheck-update'
  | 'metadata-correction';

/**
 * Reason why a track needs metadata update
 *
 * - transform-apply: Transform is enabled and iPod has original metadata
 * - transform-remove: Transform is disabled and iPod has transformed metadata
 * - metadata-changed: Source metadata changed (for future use)
 * - force-transcode: User requested forced re-transcoding via --force-transcode
 * - sync-tag-write: Write/update sync tag in track comment field (metadata-only)
 * - format-upgrade: Source is lossless, iPod has lossy (file replacement)
 * - quality-upgrade: Same format family, significantly higher bitrate (file replacement)
 * - artwork-added: Source has artwork, iPod does not (file replacement)
 * - artwork-removed: Source no longer has artwork but iPod does (metadata-only)
 * - artwork-updated: Source artwork hash differs from iPod sync tag hash (metadata-only)
 * - soundcheck-update: Source has soundcheck value, iPod lacks or differs (metadata-only)
 * - metadata-correction: Non-matching metadata fields differ (metadata-only)
 */
export type UpdateReason =
  | 'transform-apply'
  | 'transform-remove'
  | 'metadata-changed'
  | 'force-transcode'
  | 'sync-tag-write'
  | 'force-metadata'
  | UpgradeReason;

/**
 * A single metadata field change
 */
export interface MetadataChange {
  field:
    | 'artist'
    | 'title'
    | 'album'
    | 'albumArtist'
    | 'genre'
    | 'year'
    | 'trackNumber'
    | 'discNumber'
    | 'compilation'
    | 'soundcheck'
    | 'bitrate'
    | 'fileType'
    | 'lossless'
    | 'transferMode';
  from: string;
  to: string;
}

/**
 * Transcode preset reference for sync operations.
 *
 * The `name` field holds the resolved preset: 'lossless' for ALAC,
 * or 'high' | 'medium' | 'low' for AAC. The planner resolves `max`
 * before creating the ref (it never appears as a name here).
 *
 * The optional `bitrateOverride` is used when:
 * - Incompatible lossy sources are capped at their source bitrate
 * - Custom bitrate is configured by the user
 */
export interface TranscodePresetRef {
  name: Exclude<QualityPreset, 'max'> | 'lossless';
  /** Bitrate override in kbps (replaces preset default) */
  bitrateOverride?: number;
}

// =============================================================================
// Source Categorization
// =============================================================================

/**
 * Source file category for transcoding decisions
 *
 * - lossless: Can convert to any target (FLAC, WAV, AIFF, ALAC)
 * - compatible-lossy: Already iPod-playable, copy as-is (MP3, AAC/M4A)
 * - incompatible-lossy: Must be transcoded, lossy→lossy warning (OGG, Opus)
 */
export type SourceCategory = 'lossless' | 'compatible-lossy' | 'incompatible-lossy';

// =============================================================================
// Sync Warnings
// =============================================================================

/**
 * Warning types that can occur during sync planning
 */
export type SyncWarningType = 'lossy-to-lossy' | 'space-constraint' | 'embedded-artwork-resize';

/**
 * A warning generated during sync planning
 */
export interface SyncWarning {
  type: SyncWarningType;
  /** Human-readable description of the warning */
  message: string;
  /** Tracks affected by this warning */
  tracks: CollectionTrack[];
}

/**
 * Individual sync operation
 *
 * Music add operations:
 * - add-transcode: Transcode source to target format (e.g., FLAC → AAC)
 * - add-direct-copy: Copy source file as-is (fast/portable mode)
 * - add-optimized-copy: Copy via FFmpeg passthrough for metadata normalization (optimized mode)
 *
 * Music upgrade operations:
 * - upgrade-transcode: Re-transcode an existing track (e.g., preset change)
 * - upgrade-direct-copy: Re-copy an existing track as-is
 * - upgrade-optimized-copy: Re-copy an existing track via FFmpeg passthrough
 * - upgrade-artwork: Update artwork only (no audio file replacement)
 *
 * Common operations (unchanged):
 * - remove: Remove a track from the iPod
 * - update-metadata: Update metadata fields without file transfer
 *
 * Video operations (unchanged):
 * - video-transcode, video-copy, video-remove, video-update-metadata, video-upgrade
 */
export type SyncOperation =
  // Music add operations
  | {
      type: 'add-transcode';
      source: CollectionTrack;
      preset: TranscodePresetRef;
    }
  | {
      type: 'add-direct-copy';
      source: CollectionTrack;
    }
  | {
      type: 'add-optimized-copy';
      source: CollectionTrack;
    }
  // Music upgrade operations
  | {
      type: 'upgrade-transcode';
      source: CollectionTrack;
      target: DeviceTrack;
      reason: UpgradeReason;
      preset: TranscodePresetRef;
    }
  | {
      type: 'upgrade-direct-copy';
      source: CollectionTrack;
      target: DeviceTrack;
      reason: UpgradeReason;
    }
  | {
      type: 'upgrade-optimized-copy';
      source: CollectionTrack;
      target: DeviceTrack;
      reason: UpgradeReason;
    }
  | {
      type: 'upgrade-artwork';
      source: CollectionTrack;
      target: DeviceTrack;
      reason: UpgradeReason;
    }
  // Common operations (unchanged)
  | {
      type: 'remove';
      track: DeviceTrack;
    }
  | {
      type: 'update-metadata';
      track: DeviceTrack;
      metadata: Partial<TrackMetadata>;
    }
  | {
      type: 'update-sync-tag';
      track: DeviceTrack;
      syncTag: SyncTagData;
    }
  // Video operations (unchanged)
  | {
      type: 'video-transcode';
      source: CollectionVideo;
      settings: VideoTranscodeSettings;
      transformedSeriesTitle?: string;
    }
  | {
      type: 'video-copy';
      source: CollectionVideo;
      transformedSeriesTitle?: string;
    }
  | {
      type: 'video-remove';
      video: DeviceVideo;
    }
  | {
      type: 'video-update-metadata';
      source: CollectionVideo;
      video: DeviceVideo;
      newSeriesTitle?: string;
    }
  | {
      type: 'video-upgrade';
      source: CollectionVideo;
      target: DeviceVideo;
      reason: UpgradeReason;
      settings?: VideoTranscodeSettings;
    };

/**
 * Execution plan for sync operations
 */
export interface SyncPlan {
  /** Ordered list of operations to execute */
  operations: SyncOperation[];
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Estimated total size in bytes */
  estimatedSize: number;
  /** Warnings generated during planning (e.g., lossy-to-lossy conversions) */
  warnings: SyncWarning[];
}

/**
 * Options for sync execution
 */
export interface ExecuteOptions {
  /** Perform dry run without making changes */
  dryRun?: boolean;
  /** Number of parallel transcode operations */
  parallelism?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Transfer artwork to iPod (default: true) */
  artwork?: boolean;
}

/**
 * Progress update during sync execution
 */
export interface SyncProgress {
  phase:
    | 'preparing'
    | 'transcoding'
    | 'copying'
    | 'removing'
    | 'updating-metadata'
    | 'upgrading'
    | 'video-transcoding'
    | 'video-copying'
    | 'video-updating-metadata'
    | 'video-upgrading'
    | 'updating-db'
    | 'complete';
  current: number;
  total: number;
  currentTrack?: string;
  bytesProcessed: number;
  bytesTotal: number;
}

/**
 * Executor interface for running sync plans
 */
export interface SyncExecutor {
  /**
   * Execute a sync plan
   * Yields progress updates during execution
   */
  execute(plan: SyncPlan, options: ExecuteOptions): AsyncIterable<SyncProgress>;
}

import type { TransformsConfig } from '../transforms/types.js';

/**
 * Options for diff computation
 */
export interface DiffOptions {
  /**
   * Transform configuration for dual-key matching.
   * When transforms are enabled, tracks can match on either
   * original or transformed metadata.
   */
  transforms?: TransformsConfig;

  /**
   * When true, suppress file-replacement upgrades (format-upgrade, quality-upgrade,
   * artwork-added) but still allow metadata-only updates (soundcheck-update,
   * metadata-correction).
   *
   * This is useful for space-constrained devices where file replacements
   * (e.g., replacing MP3 with FLAC) would use significantly more storage.
   *
   * @default false
   */
  skipUpgrades?: boolean;

  /**
   * When true, force re-transcoding of all lossless-source tracks regardless
   * of whether their bitrate matches the current preset. Useful after switching
   * encoding mode (VBR/CBR) or customBitrate, where bitrate comparison alone
   * may not detect all tracks that need updating.
   *
   * Compatible lossy sources (MP3, AAC) are not affected — they are always
   * copied as-is since re-encoding would degrade quality.
   *
   * @default false
   */
  forceTranscode?: boolean;

  /**
   * When true, move lossless-source tracks that are missing or have outdated
   * sync tags to `toUpdate` with reason `'sync-tag-write'`. This is a
   * metadata-only update — no file replacement occurs.
   *
   * @default false
   */
  forceSyncTags?: boolean;

  /**
   * When true, move tracks whose sync tag `transfer` field doesn't match
   * `effectiveTransferMode` to `toUpdate` with reason `'transfer-mode-changed'`.
   * Only checked when effectiveTransferMode is also provided.
   *
   * @default false
   */
  forceTransferMode?: boolean;

  /**
   * The current effective transfer mode. Used for mismatch detection when
   * `forceTransferMode` is true. Also used for mismatch counting (tips).
   */
  effectiveTransferMode?: string;

  /**
   * When true, move ALL matched tracks to `toUpdate` with reason `'force-metadata'`.
   * This rewrites metadata on every matched track without re-transcoding or
   * re-transferring files.
   *
   * @default false
   */
  forceMetadata?: boolean;

  /**
   * When true, indicates that lossless sources are transcoded to lossy format
   * (e.g., FLAC → AAC) during sync. This suppresses false `format-upgrade`
   * detections: a lossless source paired with a lossy iPod track is the
   * expected state when transcoding is active, not an upgrade opportunity.
   *
   * @default false
   */
  transcodingActive?: boolean;

  /**
   * Target bitrate (kbps) for the active quality preset.
   * When set alongside `transcodingActive`, enables detection of preset changes:
   * if an existing transcoded track's bitrate differs significantly from this
   * target, it will be flagged for re-transcoding as `preset-upgrade` or
   * `preset-downgrade`.
   *
   * Only affects lossless source tracks (lossy sources are copied as-is).
   */
  presetBitrate?: number;

  /**
   * Encoding mode for preset change detection tolerance.
   * VBR uses 30% tolerance (wider for variance), CBR uses 10% (tighter).
   *
   * @default 'vbr'
   */
  encodingMode?: EncodingMode;

  /**
   * Custom bitrate tolerance ratio (0.0-1.0) for preset change detection.
   * Overrides the default tolerance for the encoding mode.
   */
  bitrateTolerance?: number;

  /**
   * When true, indicates the current preset resolves to ALAC (max + ALAC-capable device).
   * Uses format-based detection instead of bitrate comparison for preset changes.
   */
  isAlacPreset?: boolean;

  /**
   * Resolved quality for sync tag comparison (e.g., 'high', 'lossless').
   * This is the quality after resolving 'max' to either 'lossless' or 'high'.
   * When set, enables sync tag-based preset change detection.
   */
  resolvedQuality?: string;

  /**
   * Custom bitrate override for sync tag comparison.
   * Only set when the user has explicitly configured a custom bitrate.
   */
  customBitrate?: number;
}

/**
 * Options for sync planning
 */
export interface PlanOptions {
  /** Whether to remove tracks not in collection */
  removeOrphans?: boolean;

  /**
   * Transcode configuration with quality and encoding mode
   */
  transcodeConfig?: TranscodeConfig;

  /** Maximum size in bytes (for space-constrained syncs) */
  maxSize?: number;

  /**
   * Device capabilities for making device-aware sync decisions.
   *
   * When provided, the planner uses capabilities to determine codec support,
   * artwork handling, and other device-specific behavior. Takes precedence
   * over `deviceSupportsAlac` for ALAC detection.
   */
  capabilities?: DeviceCapabilities;

  /**
   * Whether the target device supports ALAC (Apple Lossless) playback.
   *
   * When true and quality='max', lossless sources will be sent as ALAC
   * rather than transcoded to AAC. Only iPod Classic, Video 5G/5.5G,
   * and Nano 3G–5G support ALAC.
   *
   * @deprecated Use `capabilities.supportedAudioCodecs.includes('alac')` instead.
   * @default false
   */
  deviceSupportsAlac?: boolean;

  /**
   * Whether artwork transfer is enabled.
   *
   * When false, `artwork-updated` upgrade operations are filtered out
   * since they cannot be executed without artwork transfer.
   *
   * @default true
   */
  artworkEnabled?: boolean;

  /**
   * Transfer mode for file preparation.
   * Determines whether copy-format files use direct copy or FFmpeg passthrough.
   *
   * @default 'fast'
   */
  transferMode?: TransferMode;
}

// =============================================================================
// Unified Executor Types
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
 * Extended progress information for sync operations.
 *
 * Used by both music and video executors.
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
  /** Transcode progress for video-transcode operations */
  transcodeProgress?: TranscodeProgress;
  /** Number of operations completed so far (includes successful, failed, and skipped) */
  completedCount: number;
}

/**
 * Result of sync execution.
 *
 * Used by both music and video executors.
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
  /** Whether execution was aborted */
  aborted?: boolean;
}
