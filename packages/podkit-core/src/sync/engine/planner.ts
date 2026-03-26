/**
 * Generic sync planner that delegates to ContentTypeHandler
 *
 * This module provides a generic planner that works with any content type
 * (music, video, etc.) by delegating type-specific planning logic to a
 * ContentTypeHandler implementation.
 *
 * ## Algorithm
 *
 * 1. Create remove operations from diff.toRemove (if removeOrphans !== false)
 * 2. Create update operations from diff.toUpdate via handler.planUpdate()
 * 3. Create add operations from diff.toAdd via handler.planAdd()
 * 4. Order all operations by type priority
 * 5. Calculate size and time estimates using handler.estimateSize/estimateTime
 * 6. Check space constraints, generate warnings
 * 7. Return SyncPlan
 *
 * @module
 */

import type { ContentTypeHandler, HandlerPlanOptions } from './content-type.js';
import type { UnifiedSyncDiff } from './content-type.js';
import type { SyncPlan, SyncOperation, SyncWarning, DeviceTrack } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for sync planning
 */
export interface SyncPlanOptions extends HandlerPlanOptions {
  /** Whether to remove items not in collection (default: true) */
  removeOrphans?: boolean;

  /** Maximum size in bytes for space constraint warnings */
  maxSize?: number;

  /** Whether artwork transfer is enabled (default: true) */
  artworkEnabled?: boolean;
}

// =============================================================================
// Operation Ordering
// =============================================================================

/**
 * Order operations for efficient execution using a handler-provided priority function.
 *
 * The engine is content-type-agnostic — the handler defines priorities via
 * `getOperationPriority()`. The general convention is:
 * 1. Remove operations first (free up space before adding)
 * 2. Metadata updates next (instant, in-database only)
 * 3. Copy operations next (fast, not CPU intensive)
 * 4. Upgrade operations next (replace existing files)
 * 5. Transcode operations last (CPU intensive, benefits from pipeline)
 *
 * Within each priority level, original insertion order is preserved.
 *
 * @param operations - Operations to sort
 * @param getPriority - Priority function (lower = execute first)
 */
export function orderOperations(
  operations: SyncOperation[],
  getPriority: (op: SyncOperation) => number
): SyncOperation[] {
  // Stable sort by type priority (preserves original order within categories)
  return [...operations].sort((a, b) => getPriority(a) - getPriority(b));
}

// =============================================================================
// SyncPlanner
// =============================================================================

/**
 * Generic planner that delegates type-specific logic to a ContentTypeHandler.
 *
 * Implements the shared planning algorithm (remove → update → add → order → estimate)
 * while letting the handler control operation creation, size estimation, and time
 * estimation for its content type.
 *
 * @typeParam TSource - Source item type
 * @typeParam TDevice - Device item type
 */
export class SyncPlanner<TSource, TDevice> {
  constructor(private handler: ContentTypeHandler<TSource, TDevice>) {}

  /**
   * Create a sync plan from a unified diff
   *
   * @param diff - The diff from SyncDiffer
   * @param options - Planning options
   * @returns A SyncPlan with ordered operations, estimates, and warnings
   */
  plan(diff: UnifiedSyncDiff<TSource, TDevice>, options?: SyncPlanOptions): SyncPlan {
    const { removeOrphans = true, maxSize, artworkEnabled = true } = options ?? {};

    const planOptions: HandlerPlanOptions = options ?? {};
    const allOperations: SyncOperation[] = [];
    const warnings: SyncWarning[] = [];

    // Step 1: Create remove operations
    if (removeOrphans) {
      for (const device of diff.toRemove) {
        allOperations.push(this.handler.planRemove(device));
      }
    }

    // Step 2: Create update operations
    for (const update of diff.toUpdate) {
      // Sync tag writes bypass the handler — create update-sync-tag directly
      if (update.syncTag && update.reasons.includes('sync-tag-write')) {
        allOperations.push({
          type: 'update-sync-tag',
          track: update.device as DeviceTrack,
          syncTag: update.syncTag,
        });
        // If sync-tag-write was the only reason, skip the handler entirely
        const remainingReasons = update.reasons.filter((r) => r !== 'sync-tag-write');
        if (remainingReasons.length === 0) continue;
        // Otherwise, let the other reasons flow through to the handler
        const ops = this.handler.planUpdate(
          update.source,
          update.device,
          remainingReasons,
          planOptions,
          update.changes
        );
        allOperations.push(...ops);
        continue;
      }

      // Filter out artwork updates when artwork is disabled
      const reasons = artworkEnabled
        ? update.reasons
        : update.reasons.filter((r) => r !== 'artwork-updated' && r !== 'artwork-removed');

      if (reasons.length === 0) continue;

      const ops = this.handler.planUpdate(
        update.source,
        update.device,
        reasons,
        planOptions,
        update.changes
      );
      allOperations.push(...ops);
    }

    // Step 3: Create add operations
    for (const source of diff.toAdd) {
      const op = this.handler.planAdd(source, planOptions);
      allOperations.push(op);
    }

    // Step 4: Order operations (delegate priority to handler)
    const orderedOperations = orderOperations(allOperations, (op) =>
      this.handler.getOperationPriority(op)
    );

    // Step 5: Calculate estimates
    let estimatedSize = 0;
    let estimatedTime = 0;

    for (const op of orderedOperations) {
      estimatedSize += this.handler.estimateSize(op);
      estimatedTime += this.handler.estimateTime(op);
    }

    // Step 6: Content-type-specific warnings (e.g., lossy-to-lossy, embedded artwork resize)
    if (this.handler.collectPlanWarnings) {
      warnings.push(...this.handler.collectPlanWarnings(orderedOperations, planOptions));
    }

    // Step 7: Space constraint warnings
    if (maxSize !== undefined && estimatedSize > maxSize) {
      const overBy = estimatedSize - maxSize;
      const overByMB = (overBy / (1024 * 1024)).toFixed(1);
      warnings.push({
        type: 'space-constraint',
        message: `Estimated size (${(estimatedSize / (1024 * 1024)).toFixed(1)} MB) exceeds available space by ${overByMB} MB.`,
        tracks: [],
      });
    }

    return {
      operations: orderedOperations,
      estimatedTime,
      estimatedSize,
      warnings,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SyncPlanner for the given content type handler
 *
 * @param handler - ContentTypeHandler implementation
 * @returns A new SyncPlanner instance
 */
export function createSyncPlanner<TSource, TDevice>(
  handler: ContentTypeHandler<TSource, TDevice>
): SyncPlanner<TSource, TDevice> {
  return new SyncPlanner(handler);
}
