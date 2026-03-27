/**
 * Generic diff engine that delegates to ContentTypeHandler
 *
 * This module provides a generic diff algorithm that works with any content
 * type (music, video, etc.) by delegating type-specific logic to a
 * ContentTypeHandler implementation.
 *
 * ## Algorithm
 *
 * 1. Build device index from handler-generated match keys
 * 2. Deduplicate sources by match key (first occurrence wins)
 * 3. Match sources to device items with optional transform key fallback
 * 4. Detect updates via handler.detectUpdates()
 * 5. Collect unmatched device items as orphans (toRemove)
 *
 * @module
 */

import type { ContentTypeHandler, MatchInfo } from './content-type.js';
import type { BaseOperation, SyncOperation } from './types.js';
import type { UpdateReason } from './types.js';

import type { UnifiedSyncDiff } from './content-type.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for sync diff computation
 */
export interface SyncDiffOptions {
  /** When true, try transform keys as fallback during matching */
  transformsEnabled?: boolean;
}

// =============================================================================
// SyncDiffer
// =============================================================================

/**
 * Generic differ that delegates type-specific logic to a ContentTypeHandler.
 *
 * Implements the shared diff algorithm (index → match → categorize) while
 * letting the handler control match key generation, transform keys, and
 * update detection.
 *
 * @typeParam TSource - Source item type
 * @typeParam TDevice - Device item type
 */
export class SyncDiffer<TSource, TDevice, TOp extends BaseOperation = SyncOperation> {
  constructor(private handler: ContentTypeHandler<TSource, TDevice, TOp>) {}

  /**
   * Compute the diff between source items and device items
   *
   * @param sourceItems - Items from the collection source
   * @param deviceItems - Items currently on the device
   * @param options - Diff options (passed through to handler.detectUpdates)
   * @returns The computed diff
   */
  diff(
    sourceItems: TSource[],
    deviceItems: TDevice[],
    options?: SyncDiffOptions
  ): UnifiedSyncDiff<TSource, TDevice> {
    const handler = this.handler;
    const diffOptions = options ?? {};

    // Step 1: Build device index for O(1) lookup
    const deviceIndex = new Map<string, TDevice>();
    for (const device of deviceItems) {
      const key = handler.generateDeviceMatchKey(device);
      // First occurrence wins (handles duplicates)
      if (!deviceIndex.has(key)) {
        deviceIndex.set(key, device);
      }
    }

    // Track which device items have been matched (by their unique ID)
    const matchedDeviceIds = new Set<string>();

    // Track seen source match keys to deduplicate
    const seenSourceKeys = new Set<string>();

    // Output arrays
    const toAdd: TSource[] = [];
    const existing: Array<{ source: TSource; device: TDevice }> = [];
    const toUpdate: Array<{ source: TSource; device: TDevice; reasons: UpdateReason[] }> = [];

    // Step 2-3: Process each source item
    for (const source of sourceItems) {
      const matchKey = handler.generateMatchKey(source);

      // Deduplicate sources: skip if we've already seen this match key
      if (seenSourceKeys.has(matchKey)) {
        continue;
      }
      seenSourceKeys.add(matchKey);

      // Try primary key match
      let deviceMatch = deviceIndex.get(matchKey);
      let matchedByTransformKey = false;

      // Step 3c: If no match and handler has applyTransformKey, try fallback
      if (!deviceMatch && handler.applyTransformKey) {
        const transformKey = handler.applyTransformKey(source);
        if (transformKey !== matchKey) {
          deviceMatch = deviceIndex.get(transformKey);
          if (deviceMatch) {
            matchedByTransformKey = true;
          }
        }
      }

      if (deviceMatch) {
        const deviceId = handler.getDeviceItemId(deviceMatch);

        // Skip if this device item was already matched (handles duplicate device items)
        if (matchedDeviceIds.has(deviceId)) {
          continue;
        }
        matchedDeviceIds.add(deviceId);

        // Step 3e-g: Detect updates
        const matchInfo: MatchInfo = { matchedByTransformKey };
        const reasons = handler.detectUpdates(source, deviceMatch, matchInfo);

        if (reasons.length > 0) {
          toUpdate.push({ source, device: deviceMatch, reasons });
        } else {
          existing.push({ source, device: deviceMatch });
        }
      } else {
        // Step 3d: No match → toAdd
        // Apply transforms if available and transforms are enabled
        if (diffOptions.transformsEnabled && handler.transformSourceForAdd) {
          toAdd.push(handler.transformSourceForAdd(source));
        } else {
          toAdd.push(source);
        }
      }
    }

    // Step 4: Collect orphans — device items not matched by any source
    const toRemove: TDevice[] = [];
    for (const device of deviceItems) {
      const deviceId = handler.getDeviceItemId(device);
      if (!matchedDeviceIds.has(deviceId)) {
        toRemove.push(device);
      }
    }

    const diff: UnifiedSyncDiff<TSource, TDevice> = {
      toAdd,
      toRemove,
      existing,
      toUpdate,
    };

    // Post-process: allow handler to perform batch-level analysis
    if (handler.postProcessDiff) {
      handler.postProcessDiff(diff);
    }

    return diff;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SyncDiffer for the given content type handler
 *
 * @param handler - ContentTypeHandler implementation
 * @returns A new SyncDiffer instance
 */
export function createSyncDiffer<TSource, TDevice, TOp extends BaseOperation = SyncOperation>(
  handler: ContentTypeHandler<TSource, TDevice, TOp>
): SyncDiffer<TSource, TDevice, TOp> {
  return new SyncDiffer(handler);
}
