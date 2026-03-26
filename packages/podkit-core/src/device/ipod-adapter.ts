/**
 * IpodDeviceAdapter — wraps IpodDatabase to implement DeviceAdapter
 *
 * This is a thin wrapper that delegates to IpodDatabase. It exists so the
 * sync engine can work against the generic DeviceAdapter interface without
 * knowing about iPod-specific concerns (playlists, artwork database, etc.).
 *
 * IpodTrack extends DeviceTrack, so no mapping is needed for
 * getTracks() — we return IpodTrack instances directly.
 *
 * @module
 */

import type { DeviceAdapter, DeviceTrackInput, DeviceTrackMetadata } from './adapter.js';
import type { DeviceCapabilities } from './capabilities.js';
import type { IpodDatabase } from '../ipod/database.js';
import type { IpodTrack, TrackInput, TrackFields } from '../ipod/types.js';
import type { SyncTagData, SyncTagUpdate } from '../sync/sync-tags.js';
import { parseSyncTag, writeSyncTag } from '../sync/sync-tags.js';

/**
 * Adapter that wraps IpodDatabase to implement the generic DeviceAdapter interface.
 *
 * IpodTrack extends DeviceTrack, so this wrapper simply delegates calls
 * without data transformation.
 */
export class IpodDeviceAdapter implements DeviceAdapter<IpodTrack> {
  private readonly ipod: IpodDatabase;
  readonly capabilities: DeviceCapabilities;

  constructor(ipod: IpodDatabase, capabilities: DeviceCapabilities) {
    this.ipod = ipod;
    this.capabilities = capabilities;
  }

  get mountPoint(): string {
    return this.ipod.mountPoint;
  }

  /**
   * Get the underlying IpodDatabase instance.
   *
   * This escape hatch allows code that genuinely needs iPod-specific
   * operations (playlists, artwork database management) to access the
   * full IpodDatabase API. Prefer using DeviceAdapter methods when possible.
   *
   * @internal Transitional — usage should decrease as handlers migrate to DeviceAdapter methods.
   */
  getIpodDatabase(): IpodDatabase {
    return this.ipod;
  }

  // Track lifecycle

  getTracks(): IpodTrack[] {
    return this.ipod.getTracks();
  }

  addTrack(input: DeviceTrackInput): IpodTrack {
    // If a syncTag is provided, embed it into the comment field for iPod storage
    const { syncTag, ...rest } = input;
    const trackInput = rest as TrackInput;
    if (syncTag) {
      trackInput.comment = writeSyncTag(trackInput.comment, syncTag);
    }
    return this.ipod.addTrack(trackInput);
  }

  updateTrack(track: IpodTrack, fields: DeviceTrackMetadata): IpodTrack {
    return this.ipod.updateTrack(track, fields as TrackFields);
  }

  removeTrack(track: IpodTrack, options?: { deleteFile?: boolean }): void {
    this.ipod.removeTrack(track, options);
  }

  copyTrackFile(track: IpodTrack, sourcePath: string): IpodTrack {
    // IpodTrack.copyFile() mutates in place and returns the same instance
    return track.copyFile(sourcePath);
  }

  replaceTrackFile(track: IpodTrack, newFilePath: string): IpodTrack {
    return this.ipod.replaceTrackFile(track, newFilePath);
  }

  removeTrackArtwork(track: IpodTrack): IpodTrack {
    return track.removeArtwork();
  }

  // Sync tags

  writeSyncTag(track: IpodTrack, update: SyncTagUpdate): IpodTrack {
    const currentComment = track.comment;
    const existingTag = parseSyncTag(currentComment);
    // Merge: existing tag fields + update fields (update wins)
    const merged: SyncTagData = existingTag
      ? { ...existingTag, ...update }
      : { quality: 'copy', ...update };
    const newComment = writeSyncTag(currentComment, merged);
    return this.updateTrack(track, { comment: newComment });
  }

  clearSyncTag(track: IpodTrack): IpodTrack {
    const currentComment = track.comment;
    if (!parseSyncTag(currentComment)) {
      return track; // No sync tag to clear
    }
    // Strip the [podkit:...] block from the comment
    const cleaned =
      (currentComment ?? '').replace(/\s*\[podkit:v\d+[^\]]*\]\s*/g, '').trim() || undefined;
    return this.updateTrack(track, { comment: cleaned });
  }

  // Persistence

  async save(): Promise<void> {
    await this.ipod.save();
  }

  close(): void {
    this.ipod.close();
  }
}
