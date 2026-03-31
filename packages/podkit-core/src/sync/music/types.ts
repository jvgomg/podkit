/**
 * Music sync operation types
 *
 * Defines all operation variants specific to music content sync.
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceTrack } from '../../device/adapter.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type { TranscodePresetRef, UpgradeReason } from '../engine/types.js';
import type { TrackMetadata } from '../../types.js';

/** All music sync operation variants */
export type MusicOperation =
  | { type: 'add-transcode'; source: CollectionTrack; preset: TranscodePresetRef }
  | { type: 'add-direct-copy'; source: CollectionTrack }
  | { type: 'add-optimized-copy'; source: CollectionTrack }
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
  | { type: 'remove'; track: DeviceTrack }
  | {
      type: 'update-metadata';
      track: DeviceTrack;
      metadata: Partial<TrackMetadata>;
      source?: CollectionTrack;
    }
  | { type: 'update-sync-tag'; track: DeviceTrack; syncTag: SyncTagData }
  | {
      type: 'relocate';
      track: DeviceTrack;
      source: CollectionTrack;
      newPath: string;
      metadata?: Partial<TrackMetadata>;
    };
