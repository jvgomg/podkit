/**
 * Shared utilities for postProcessDiff implementations.
 *
 * These extract the common array-partition pattern used by both
 * MusicHandler and VideoHandler when sweeping `existing` items
 * into `toUpdate`.
 *
 * @module
 */

import type { SyncTagData } from '../../metadata/sync-tags.js';
import type { MetadataChange, SyncOperation, SyncPlan, UpdateReason } from './types.js';
import type { DryRunSummary, UnifiedSyncDiff } from './content-type.js';

/**
 * Entry describing an item that should move from `existing` to `toUpdate`.
 */
export interface PartitionUpdateEntry {
  reasons: UpdateReason[];
  changes?: MetadataChange[];
  syncTag?: SyncTagData;
}

/**
 * Partition `diff.existing` by a predicate, moving matches to `toUpdate`.
 *
 * For each item in `diff.existing`, calls `shouldUpdate`. If it returns
 * an entry, the item is moved to `toUpdate` with those reasons/changes.
 * If it returns `null`, the item stays in `existing`.
 *
 * This centralizes the error-prone array-swap pattern (build stillExisting,
 * truncate, repopulate) that appears in multiple postProcessDiff passes.
 */
export function partitionExisting<TSource, TDevice>(
  diff: UnifiedSyncDiff<TSource, TDevice>,
  shouldUpdate: (match: { source: TSource; device: TDevice }) => PartitionUpdateEntry | null
): void {
  const stillExisting: Array<{ source: TSource; device: TDevice }> = [];

  for (const match of diff.existing) {
    const entry = shouldUpdate(match);
    if (entry) {
      diff.toUpdate.push({
        source: match.source,
        device: match.device,
        ...entry,
      });
    } else {
      stillExisting.push(match);
    }
  }

  diff.existing.length = 0;
  for (const item of stillExisting) diff.existing.push(item);
}

/**
 * Move ALL remaining `existing` items to `toUpdate` with a fixed reason.
 *
 * Used by force-metadata sweeps in both handlers. The optional `buildEntry`
 * callback lets each handler compute content-type-specific fields (changes,
 * syncTag) per item.
 */
export function sweepAllExisting<TSource, TDevice>(
  diff: UnifiedSyncDiff<TSource, TDevice>,
  reason: UpdateReason,
  buildEntry?: (match: { source: TSource; device: TDevice }) => {
    changes?: MetadataChange[];
    syncTag?: SyncTagData;
  }
): void {
  for (const match of diff.existing) {
    const extra = buildEntry?.(match);
    diff.toUpdate.push({
      source: match.source,
      device: match.device,
      reasons: [reason],
      ...extra,
    });
  }
  diff.existing.length = 0;
}

/**
 * Classify operations and format a SyncPlan into a DryRunSummary.
 *
 * Both MusicHandler and VideoHandler implement nearly identical formatDryRun
 * methods — only the operation-type-to-category mapping differs. This utility
 * extracts the shared accumulation logic.
 *
 * @param plan - The sync plan to summarize
 * @param classify - Maps an operation type string to add/remove/update (or null to skip counting)
 * @param getDisplayName - Returns a human-readable name for an operation
 * @param estimateSize - Returns estimated size in bytes for an operation
 */
export function formatDryRunFromPlan(
  plan: SyncPlan,
  classify: (type: string) => 'add' | 'remove' | 'update' | null,
  getDisplayName: (op: SyncOperation) => string,
  estimateSize: (op: SyncOperation) => number
): DryRunSummary {
  const operationCounts: Record<string, number> = {};
  const operations: Array<{ type: string; displayName: string; size?: number }> = [];
  let toAdd = 0;
  let toRemove = 0;
  let toUpdate = 0;

  for (const op of plan.operations) {
    operationCounts[op.type] = (operationCounts[op.type] ?? 0) + 1;

    const category = classify(op.type);
    if (category === 'add') toAdd++;
    else if (category === 'remove') toRemove++;
    else if (category === 'update') toUpdate++;

    operations.push({
      type: op.type,
      displayName: getDisplayName(op),
      size: estimateSize(op),
    });
  }

  return {
    toAdd,
    toRemove,
    existing: 0, // Not available from plan alone
    toUpdate,
    operationCounts,
    estimatedSize: plan.estimatedSize,
    estimatedTime: plan.estimatedTime,
    warnings: plan.warnings.map((w) => w.message),
    operations,
  };
}
