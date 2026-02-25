/**
 * Sync engine types
 *
 * Types for comparing collections, planning sync operations,
 * and executing sync plans.
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { TrackMetadata } from '../types.js';
import type { IPodTrack } from '../ipod/types.js';

// Re-export IPodTrack from the ipod module
// This provides the full interface with methods like remove(), update(), etc.
export type { IPodTrack };

/**
 * A matched pair of collection track and iPod track
 */
export interface MatchedTrack {
  collection: CollectionTrack;
  ipod: IPodTrack;
}

/**
 * A track with conflicting metadata between collection and iPod
 */
export interface ConflictTrack {
  collection: CollectionTrack;
  ipod: IPodTrack;
  /** Fields that differ between collection and iPod */
  conflicts: (keyof TrackMetadata)[];
}

/**
 * Result of comparing collection to iPod
 */
export interface SyncDiff {
  /** Tracks in collection but not on iPod */
  toAdd: CollectionTrack[];
  /** Tracks on iPod but not in collection (candidates for removal) */
  toRemove: IPodTrack[];
  /** Tracks that exist in both and are in sync */
  existing: MatchedTrack[];
  /** Tracks with metadata mismatches */
  conflicts: ConflictTrack[];
}

/**
 * Transcode preset reference for sync operations
 */
export interface TranscodePresetRef {
  name: 'high' | 'medium' | 'low' | 'custom';
}

/**
 * Individual sync operation
 */
export type SyncOperation =
  | {
      type: 'transcode';
      source: CollectionTrack;
      preset: TranscodePresetRef;
    }
  | {
      type: 'copy';
      source: CollectionTrack;
    }
  | {
      type: 'remove';
      track: IPodTrack;
    }
  | {
      type: 'update-metadata';
      track: IPodTrack;
      metadata: Partial<TrackMetadata>;
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
}

/**
 * Progress update during sync execution
 */
export interface SyncProgress {
  phase: 'preparing' | 'transcoding' | 'copying' | 'removing' | 'updating-db' | 'complete';
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
  execute(
    plan: SyncPlan,
    options: ExecuteOptions
  ): AsyncIterable<SyncProgress>;
}

/**
 * Differ interface for comparing collections
 */
export interface SyncDiffer {
  /**
   * Compare collection tracks to iPod tracks
   */
  diff(
    collectionTracks: CollectionTrack[],
    ipodTracks: IPodTrack[]
  ): SyncDiff;
}

/**
 * Planner interface for creating sync plans
 */
export interface SyncPlanner {
  /**
   * Create an execution plan from a diff
   */
  plan(diff: SyncDiff, options?: PlanOptions): SyncPlan;
}

/**
 * Options for sync planning
 */
export interface PlanOptions {
  /** Whether to remove tracks not in collection */
  removeOrphans?: boolean;
  /** Transcode preset to use */
  transcodePreset?: TranscodePresetRef;
  /** Maximum size in bytes (for space-constrained syncs) */
  maxSize?: number;
}
