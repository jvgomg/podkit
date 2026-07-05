/**
 * Sync engine types
 *
 * Types for comparing collections, planning sync operations,
 * and executing sync plans.
 */

import type { DeviceTrack } from '../../device/adapter.js';
import type {
  EncodingMode,
  QualityPreset,
  TranscodeConfig,
  TranscodeProgress,
  TransferMode,
} from '../../transcode/types.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { MusicOperation } from '../music/types.js';
import type { VideoOperation } from '../video/types.js';

// Re-export for use within sync module
export type { DeviceTrack };

// =============================================================================
// Update Types (for transforms)
// =============================================================================

/**
 * Reasons related to track upgrades (self-healing sync)
 *
 * @see ADR-009 for full design context
 */
export type UpgradeReason =
  // Unified music quality axis (replaces format-upgrade / quality-upgrade /
  // preset-upgrade / preset-downgrade for audio). Produced by
  // `classifyQualityChange`; direction + descriptive fields ride on the
  // `QualityChange` payload attached to the diff entry, not the reason string.
  | 'quality-change'
  // Video quality axis — video keeps its own preset reasons (out of scope of
  // the music quality-change unification).
  | 'preset-upgrade'
  | 'preset-downgrade'
  | 'codec-changed'
  | 'force-transcode'
  | 'transfer-mode-changed'
  | 'artwork-added'
  | 'artwork-removed'
  | 'artwork-updated'
  | 'normalization-update'
  | 'metadata-correction'
  | 'path-mismatch';

/**
 * Reason why a track needs metadata update
 *
 * - transform-apply: Transform is enabled and iPod has original metadata
 * - transform-remove: Transform is disabled and iPod has transformed metadata
 * - metadata-changed: Source metadata changed (for future use)
 * - force-transcode: User requested forced re-transcoding via --force-transcode
 * - sync-tag-write: Write/update sync tag in track comment field (metadata-only)
 * - quality-change: Music quality move (cap-up/down, lossless-boundary) — file
 *   replacement when reEncodes
 * - artwork-added: Source has artwork, iPod does not (file replacement)
 * - artwork-removed: Source no longer has artwork but iPod does (metadata-only)
 * - artwork-updated: Source artwork hash differs from iPod sync tag hash (metadata-only)
 * - normalization-update: Source has normalization data, device lacks or differs (metadata-only)
 * - metadata-correction: Non-matching metadata fields differ (metadata-only)
 * - path-mismatch: Track's device path differs from expected path (file move)
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
    | 'normalization'
    | 'bitrate'
    | 'fileType'
    | 'lossless'
    | 'transferMode'
    | 'filePath';
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
  /** Target codec for transcoding. When omitted, defaults to AAC behavior. */
  targetCodec?: TranscodeTargetCodec;
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
// Warnings
// =============================================================================

/**
 * Compact track reference attached to warnings.
 *
 * Decoupled from CollectionTrack so warnings don't carry source-side fields
 * irrelevant to the consumer; structured (not pre-formatted) so JSON
 * consumers can format as they wish.
 */
export interface WarningTrackRef {
  artist: string;
  title: string;
  album?: string;
}

/**
 * Phase of sync at which a warning was generated.
 *
 * - `plan`: emitted during diff/plan construction (lossy-to-lossy, space,
 *   adapter-scoped degraded modes).
 * - `execute`: emitted during execution (artwork extraction failures,
 *   on-file tag-write failures, etc).
 */
export type WarningPhase = 'plan' | 'execute';

/**
 * All warning types across both phases.
 *
 * Plan-phase: 'lossy-to-lossy', 'space-constraint', 'embedded-artwork-resize',
 *   'artwork-detection-disabled'.
 * Execute-phase: 'artwork', 'metadata'.
 *
 * Additional execute-phase types (e.g. 'tag-write') are added by later
 * refactors when a sink begins emitting them.
 */
export type WarningType =
  // plan
  | 'lossy-to-lossy'
  | 'space-constraint'
  | 'embedded-artwork-resize'
  | 'artwork-detection-disabled'
  // execute
  | 'artwork'
  | 'metadata'
  | 'tag-write'
  | 'debris-cleanup-failure';

/**
 * A non-fatal warning generated during sync planning or execution.
 *
 * Warnings represent issues that don't prevent the sync from completing
 * but should be reported to the user. Hard failures throw a typed error
 * (see CategorizedSyncError) — never a warning.
 */
export interface Warning {
  /** Phase the warning was generated in. */
  phase: WarningPhase;
  /** Discriminant for the warning shape and message family. */
  type: WarningType;
  /** Human-readable description. */
  message: string;
  /** Tracks affected. Planning warnings may have many; execute-phase usually 1. */
  tracks: WarningTrackRef[];
}

/**
 * Receiver for execute-phase warnings. Adapters, transfer managers and
 * artwork managers emit through a sink rather than throwing or touching
 * stderr; the pipeline owns the sink that accumulates into the final
 * ExecuteResult.warnings array.
 *
 * Plan-phase warnings flow as return values (`getPlanWarnings()` /
 * `collectPlanWarnings()`); they don't go through a sink because the
 * caller is the planner and there's no fan-in.
 */
export interface WarningSink {
  emit(warning: Warning): void;
}

// =============================================================================
// Base Operation Interface
// =============================================================================

/**
 * Minimum interface for sync operations.
 *
 * All operation types (music, video, etc.) must have a `type` discriminant.
 * Used as the constraint for the `TOp` type parameter throughout the engine.
 */
export interface BaseOperation {
  readonly type: string;
}

/**
 * All sync operations across content types.
 *
 * This is the union of all per-handler operation types. Used as the default
 * for the `TOp` type parameter so existing code compiles unchanged.
 *
 * Music operations: add-transcode, add-direct-copy, add-optimized-copy,
 * upgrade-transcode, upgrade-direct-copy, upgrade-optimized-copy,
 * upgrade-artwork, remove, update-metadata, update-sync-tag
 *
 * Video operations: video-transcode, video-copy, video-remove,
 * video-update-metadata, video-upgrade
 */
export type SyncOperation = MusicOperation | VideoOperation;

/**
 * Device-level pre-flight work that runs before the track operations.
 *
 * Sync orchestration (one `runSyncAction` call) may iterate multiple
 * collections — typically music then video — against a single device.
 * Some work is device-scoped, not collection-scoped: in particular the
 * pre-sync debris sweep (TASK-398) walks the device's content surface
 * once and reaps `.podkit-tmp` residue + phantom manifest entries before
 * any track op runs. The result attaches to the FIRST collection's plan
 * (so the executor consumes it once) and to nothing on subsequent plans.
 *
 * Future device-level pre-flight steps (e.g. a free-space probe rewrite
 * landing as part of TASK-378) plug into this same shape rather than
 * growing a new top-level type.
 */
export interface PlanPreliminaries {
  /**
   * Debris files the executor should delete before track ops run. Always
   * safe-by-design — every entry came from a scanner that only surfaces
   * podkit-owned `.podkit-tmp` / adapter-failure residue.
   */
  debrisCleanup?: {
    paths: string[];
    /** Sum of `fs.stat().size` at scan time. Best-effort, may differ from
     *  actual freed bytes when the file vanishes between scan and unlink. */
    totalBytes: number;
  };

  /**
   * Manifest entries whose backing file is missing. Pruned from the
   * mass-storage manifest in lockstep with the debris cleanup. Always
   * safe by construction — the symmetric pass that produces them is
   * also the orphan check's prune path (`orphans-mass-storage.ts`).
   */
  phantomPrune?: {
    /** Manifest paths to drop (NFC-normalised, relative to mountPoint). */
    paths: string[];
  };
}

/**
 * Execution plan for sync operations
 *
 * Generic over operation type. Defaults to `SyncOperation` (all content types)
 * so existing code compiles unchanged.
 */
export interface SyncPlan<TOp extends BaseOperation = SyncOperation> {
  /** Ordered list of operations to execute */
  operations: TOp[];
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Estimated total size in bytes */
  estimatedSize: number;
  /** Warnings generated during planning (e.g., lossy-to-lossy conversions). Always `phase: 'plan'`. */
  warnings: Warning[];
  /**
   * Device-level pre-flight populated once per device sync. Only the FIRST
   * plan executed against the device carries this — subsequent plans see
   * `undefined`. The executor runs the pre-flight before any track ops.
   */
  preliminaries?: PlanPreliminaries;
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

import type { TransformsConfig } from '../../transforms/types.js';

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
   * artwork-added) but still allow metadata-only updates (normalization-update,
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
  | 'space' // Free-space exhaustion - no retry, hard sync exit
  | 'unknown'; // Other errors - no retry

/**
 * Per-entry structured failure carried on `CategorizedSyncError.structuredCauses`.
 *
 * Aggregate errors (`TagWriteError`, `PictureWriteError`, `SidecarWriteError`,
 * `MoveError`) and single-cause wraps (`CopyError`) populate this so the
 * categorizer can read `errno` directly off the cause — without scraping the
 * message body — and route `ENOSPC` to the `'space'` category regardless of
 * the error class's declared default.
 *
 * The `causes: readonly string[]` field on the base class is kept as the
 * `--json` envelope wire format; `structuredCauses` is the in-process
 * detail. JSON consumers reading the `causes` array see the human-readable
 * `"${path}: ${message}"` strings; the internal categorizer reads
 * `structuredCauses[i].errno`.
 */
export interface ErrorCause {
  /**
   * Where the failure happened. File path for tag/picture writes, album dir
   * for sidecar writes, `"oldPath → newPath"` for moves. Identifies the unit
   * of work that failed within an aggregate.
   */
  path: string;
  /** The underlying error's `message` field, verbatim. */
  message: string;
  /**
   * Underlying fs error code (`ENOSPC`, `EACCES`, `EROFS`, `ENOENT`, …) when
   * the wrapped error exposed a `code` property. `undefined` for synthetic or
   * non-fs errors. Drives the categorizer's `ENOSPC → 'space'` override.
   */
  errno: string | undefined;
}

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
 * Extended progress information for sync operations.
 *
 * Generic over operation type. Defaults to `SyncOperation` (all content types)
 * so existing code compiles unchanged.
 *
 * Used by both music and video executors.
 */
export interface ExecutorProgress<TOp extends BaseOperation = SyncOperation> extends SyncProgress {
  /** Current operation being executed */
  operation: TOp;
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
 * Generic over operation type. Defaults to `SyncOperation` (all content types)
 * so existing code compiles unchanged.
 *
 * Used by both music and video executors.
 */
export interface ExecuteResult<TOp extends BaseOperation = SyncOperation> {
  /** Number of operations completed successfully */
  completed: number;
  /** Number of operations that failed */
  failed: number;
  /** Number of operations skipped (dry-run) */
  skipped: number;
  /** Errors encountered during execution (legacy format) */
  errors: Array<{ operation: TOp; error: Error }>;
  /** Categorized errors with full context */
  categorizedErrors: CategorizedError[];
  /** Non-fatal warnings (e.g., artwork extraction failures). Always `phase: 'execute'`. */
  warnings: Warning[];
  /** Total bytes transferred */
  bytesTransferred: number;
  /** Whether execution was aborted */
  aborted?: boolean;
}
