/**
 * Factory for creating SyncOperation objects from track classifications.
 *
 * Centralizes the mapping from routing decisions (MusicAction) to typed
 * SyncOperation variants, eliminating the add/upgrade duplication that
 * previously existed in MusicHandler.planAdd() and planUpdate().
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type { DeviceTrack, MetadataChange, UpgradeReason } from '../engine/types.js';
import type { MusicAction } from './classifier.js';
import type { MusicOperation } from './types.js';
import { changesToMetadata } from './planner.js';

/**
 * Creates SyncOperation objects from track classifications.
 *
 * Each method maps a high-level intent (add, upgrade, remove, etc.)
 * combined with a MusicAction (direct-copy, optimized-copy, transcode)
 * to the appropriate SyncOperation discriminated union variant.
 */
export class MusicOperationFactory {
  /** Create an add operation from a classification */
  createAdd(source: CollectionTrack, action: MusicAction): MusicOperation {
    switch (action.type) {
      case 'direct-copy':
        return { type: 'add-direct-copy', source };
      case 'optimized-copy':
        return { type: 'add-optimized-copy', source };
      case 'transcode':
        return { type: 'add-transcode', source, preset: action.preset };
    }
  }

  /** Create a file-replacement upgrade operation */
  createUpgrade(
    source: CollectionTrack,
    target: DeviceTrack,
    reason: UpgradeReason,
    action: MusicAction
  ): MusicOperation {
    switch (action.type) {
      case 'direct-copy':
        return { type: 'upgrade-direct-copy', source, target, reason };
      case 'optimized-copy':
        return { type: 'upgrade-optimized-copy', source, target, reason };
      case 'transcode':
        return { type: 'upgrade-transcode', source, target, reason, preset: action.preset };
    }
  }

  /** Create an artwork-only upgrade */
  createArtworkUpgrade(
    source: CollectionTrack,
    target: DeviceTrack,
    reason: UpgradeReason
  ): MusicOperation {
    return { type: 'upgrade-artwork', source, target, reason };
  }

  /** Create a remove operation */
  createRemove(device: DeviceTrack): MusicOperation {
    return { type: 'remove', track: device };
  }

  /** Create a metadata-only update */
  createMetadataUpdate(
    device: DeviceTrack,
    changes: MetadataChange[],
    source?: CollectionTrack
  ): MusicOperation {
    return {
      type: 'update-metadata',
      track: device,
      metadata: changesToMetadata(changes),
      source,
    };
  }

  /** Create a sync-tag-write operation */
  createSyncTagUpdate(device: DeviceTrack, syncTag: SyncTagData): MusicOperation {
    return { type: 'update-sync-tag', track: device, syncTag };
  }

  /** Create a relocate (file move) operation */
  createRelocate(
    device: DeviceTrack,
    source: CollectionTrack,
    newPath: string,
    changes?: MetadataChange[]
  ): MusicOperation {
    return {
      type: 'relocate',
      track: device,
      source,
      newPath,
      metadata: changes ? changesToMetadata(changes) : undefined,
    };
  }
}
