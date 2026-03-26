/**
 * ContentTypeHandler interface
 *
 * Defines a generic interface for content-type-specific sync operations
 * (music, video). Each handler encapsulates diffing, planning, execution,
 * and display logic for its content type.
 *
 * @module
 */

import type { DeviceAdapter } from '../../device/adapter.js';
import type { AudioCodec } from '../../device/capabilities.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type { MetadataChange, SyncOperation, SyncPlan, UpdateReason } from './types.js';

// =============================================================================
// Option Types
// =============================================================================

/**
 * Options passed to handler diff methods
 */
export interface HandlerDiffOptions<THandlerOptions = Record<string, unknown>> {
  skipUpgrades?: boolean;
  forceTranscode?: boolean;
  transcodingActive?: boolean;
  presetBitrate?: number;
  presetChanged?: boolean;
  transformsEnabled?: boolean;
  transforms?: Record<string, string>;
  forceMetadata?: boolean;
  /** Content-type-specific options, typed by the handler */
  handlerOptions?: THandlerOptions;
}

/**
 * Options passed to handler plan methods
 */
export interface HandlerPlanOptions {
  qualityPreset?: string;
  deviceSupportsAlac?: boolean;
  customBitrate?: number;
  hardwareAcceleration?: boolean;
  /**
   * Audio codecs the device can play natively without transcoding.
   *
   * When provided, the planner checks whether the source track's codec is in
   * this list. If it is, the track is copied as-is instead of being transcoded.
   * This enables devices like Echo Mini (which supports FLAC natively) to
   * receive lossless files without unnecessary transcoding.
   */
  supportedAudioCodecs?: AudioCodec[];
  /**
   * Where the device reads artwork from (first = preferred).
   * Used to determine whether embedded artwork should be stripped, resized, or preserved.
   *
   * - `'database'` → strip embedded artwork (iPod behavior)
   * - `'embedded'` → resize to artworkMaxResolution in all modes
   * - `'sidecar'` → future (TASK-204)
   *
   * @default undefined (falls back to strip behavior for backward compatibility)
   */
  primaryArtworkSource?: 'database' | 'embedded' | 'sidecar';
  /**
   * Maximum artwork display resolution in pixels (square).
   * Used as the resize target when primaryArtworkSource is 'embedded'.
   */
  artworkMaxResolution?: number;
  /**
   * Transfer mode for file preparation.
   * Used by planners to determine copy vs optimized-copy routing.
   */
  transferMode?: 'fast' | 'optimized' | 'portable';
}

/**
 * Context for executing sync operations
 */
export interface ExecutionContext {
  device: DeviceAdapter;
  signal?: AbortSignal;
  dryRun?: boolean;
  tempDir?: string;
}

// =============================================================================
// Progress and Summary Types
// =============================================================================

/**
 * Progress update for a single operation
 */
export interface OperationProgress {
  operation: SyncOperation;
  phase: 'starting' | 'in-progress' | 'complete' | 'failed';
  progress?: number;
  error?: Error;
  skipped?: boolean;
  transcodeProgress?: { percent: number; speed?: number };
}

/**
 * Summary of a sync plan for dry-run display
 */
export interface DryRunSummary {
  toAdd: number;
  toRemove: number;
  existing: number;
  toUpdate: number;
  operationCounts: Record<string, number>;
  estimatedSize: number;
  estimatedTime: number;
  warnings: string[];
  operations: Array<{ type: string; displayName: string; size?: number }>;
}

// =============================================================================
// Match and Diff Types
// =============================================================================

/**
 * Information about how a source-device pair was matched
 */
export interface MatchInfo {
  /** Whether the pair was matched via the transform key (not the primary key) */
  matchedByTransformKey: boolean;
}

/**
 * Result of a unified diff operation
 *
 * @typeParam TSource - Source item type
 * @typeParam TDevice - Device item type
 */
export interface UnifiedSyncDiff<TSource, TDevice> {
  /** Items in source but not on device */
  toAdd: TSource[];
  /** Items on device but not in source (candidates for removal) */
  toRemove: TDevice[];
  /** Items that exist in both and are in sync */
  existing: Array<{ source: TSource; device: TDevice }>;
  /** Items that need updates with reasons */
  toUpdate: Array<{
    source: TSource;
    device: TDevice;
    reasons: UpdateReason[];
    /** Detailed metadata changes (populated by handlers that support it) */
    changes?: MetadataChange[];
    /** Typed sync tag to write (replaces raw comment field changes) */
    syncTag?: SyncTagData;
  }>;
}

// =============================================================================
// ContentTypeHandler Interface
// =============================================================================

/**
 * Generic interface for content-type-specific sync operations.
 *
 * Each handler encapsulates the logic for matching, diffing, planning,
 * executing, and displaying sync operations for a specific content type
 * (e.g., music tracks, videos).
 *
 * @typeParam TSource - The source item type (e.g., CollectionTrack, CollectionVideo)
 * @typeParam TDevice - The device item type (e.g., IpodTrack, DeviceVideo)
 */
export interface ContentTypeHandler<TSource, TDevice> {
  /** Content type identifier (e.g., 'music', 'video') */
  readonly type: string;

  // ---- Diffing ----

  /** Generate a match key for a source item */
  generateMatchKey(source: TSource): string;

  /** Generate a match key for a device item */
  generateDeviceMatchKey(device: TDevice): string;

  /** Generate a match key with transforms applied (optional) */
  applyTransformKey?(source: TSource): string;

  /** Apply transform to a source item for addition (optional) */
  transformSourceForAdd?(source: TSource): TSource;

  /** Get the unique identifier for a device item */
  getDeviceItemId(device: TDevice): string;

  /** Detect reasons a matched pair needs updating */
  detectUpdates(
    source: TSource,
    device: TDevice,
    options: HandlerDiffOptions,
    matchInfo?: MatchInfo
  ): UpdateReason[];

  /**
   * Post-process a completed diff result.
   * Called after the match loop with the full diff, allowing batch-level
   * analysis that can move items between existing and toUpdate.
   *
   * Use cases: preset change detection, force-transcode sweeps,
   * sync tag writing, force-metadata rewrites.
   */
  postProcessDiff?(diff: UnifiedSyncDiff<TSource, TDevice>, options: HandlerDiffOptions): void;

  // ---- Planning ----

  /** Plan an add operation for a source item */
  planAdd(source: TSource, options: HandlerPlanOptions): SyncOperation;

  /** Plan a remove operation for a device item */
  planRemove(device: TDevice): SyncOperation;

  /** Plan update operations for a matched pair with detected reasons */
  planUpdate(
    source: TSource,
    device: TDevice,
    reasons: UpdateReason[],
    options?: HandlerPlanOptions,
    changes?: MetadataChange[]
  ): SyncOperation[];

  /** Estimate the output size in bytes for an operation */
  estimateSize(op: SyncOperation): number;

  /** Estimate the time in seconds for an operation */
  estimateTime(op: SyncOperation): number;

  /**
   * Collect plan-level warnings after operations are created.
   * Called by SyncPlanner with all planned operations to generate
   * content-type-specific warnings (e.g., lossy-to-lossy conversion).
   */
  collectPlanWarnings?(
    operations: SyncOperation[],
    options?: HandlerPlanOptions
  ): import('./types.js').SyncWarning[];

  // ---- Execution ----

  /** Execute a single operation, yielding progress updates */
  execute(op: SyncOperation, ctx: ExecutionContext): AsyncGenerator<OperationProgress>;

  /** Execute a batch of operations sequentially (optional optimization) */
  executeBatch?(
    operations: SyncOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress>;

  // ---- Device ----

  /** Get all items of this content type from the device */
  getDeviceItems(device: DeviceAdapter): TDevice[];

  // ---- Display ----

  /** Get a human-readable display name for an operation */
  getDisplayName(op: SyncOperation): string;

  /** Format a sync plan into a dry-run summary */
  formatDryRun(plan: SyncPlan): DryRunSummary;
}
