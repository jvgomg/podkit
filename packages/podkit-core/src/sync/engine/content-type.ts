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
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type {
  BaseOperation,
  MetadataChange,
  SyncOperation,
  SyncPlan,
  UpdateReason,
} from './types.js';

// =============================================================================
// Collision Check Types
// =============================================================================

/** Input for collision checking — describes a track that would be added to the device */
export interface CollisionCheckInput {
  title: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  totalDiscs?: number;
  filetype?: string;
  mediaType?: number;
  tvShow?: string;
  tvEpisode?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
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
 *
 * Generic over operation type. Defaults to `SyncOperation` (all content types)
 * so existing code compiles unchanged.
 */
export interface OperationProgress<TOp extends BaseOperation = SyncOperation> {
  operation: TOp;
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
export interface ContentTypeHandler<TSource, TDevice, TOp extends BaseOperation = SyncOperation> {
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
  detectUpdates(source: TSource, device: TDevice, matchInfo?: MatchInfo): UpdateReason[];

  /**
   * Post-process a completed diff result.
   * Called after the match loop with the full diff, allowing batch-level
   * analysis that can move items between existing and toUpdate.
   *
   * Use cases: preset change detection, force-transcode sweeps,
   * sync tag writing, force-metadata rewrites.
   */
  postProcessDiff?(diff: UnifiedSyncDiff<TSource, TDevice>): void;

  // ---- Planning ----

  /** Plan an add operation for a source item */
  planAdd(source: TSource): TOp;

  /** Plan a remove operation for a device item */
  planRemove(device: TDevice): TOp;

  /** Plan update operations for a matched pair with detected reasons */
  planUpdate(
    source: TSource,
    device: TDevice,
    reasons: UpdateReason[],
    changes?: MetadataChange[],
    syncTag?: SyncTagData
  ): TOp[];

  /** Estimate the output size in bytes for an operation */
  estimateSize(op: TOp): number;

  /** Estimate the time in seconds for an operation */
  estimateTime(op: TOp): number;

  /**
   * Collect plan-level warnings after operations are created.
   * Called by SyncPlanner with all planned operations to generate
   * content-type-specific warnings (e.g., lossy-to-lossy conversion).
   */
  collectPlanWarnings?(operations: TOp[]): import('./types.js').SyncWarning[];

  // ---- Execution ----

  /** Execute a single operation, yielding progress updates */
  execute(op: TOp, ctx: ExecutionContext): AsyncGenerator<OperationProgress<TOp>>;

  /** Execute a batch of operations sequentially (optional optimization) */
  executeBatch?(operations: TOp[], ctx: ExecutionContext): AsyncGenerator<OperationProgress<TOp>>;

  // ---- Device ----

  /** Get all items of this content type from the device */
  getDeviceItems(device: DeviceAdapter): TDevice[];

  // ---- Display ----

  /** Get a human-readable display name for an operation */
  getDisplayName(op: TOp): string;

  /** Format a sync plan into a dry-run summary */
  formatDryRun(plan: SyncPlan<TOp>): DryRunSummary;

  /** Extract collision check inputs from add operations in a plan */
  getCollisionCheckInputs?(plan: SyncPlan<TOp>): CollisionCheckInput[];

  // ---- Priority ----

  /**
   * Return the execution priority for an operation (lower = execute first).
   *
   * Used by the engine's planner to order operations. Each content type
   * defines its own priority scheme (e.g., removes before copies before
   * transcodes).
   */
  getOperationPriority(op: TOp): number;
}
