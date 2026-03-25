/**
 * IpodDeviceAdapter — wraps IpodDatabase to implement DeviceAdapter
 *
 * This is a thin wrapper that delegates to IpodDatabase. It exists so the
 * sync engine can work against the generic DeviceAdapter interface without
 * knowing about iPod-specific concerns (playlists, artwork database, etc.).
 *
 * IPodTrack already satisfies DeviceTrack, so no mapping is needed for
 * getTracks() — we return IPodTrack instances directly.
 *
 * @module
 */

import type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './adapter.js';
import type { DeviceCapabilities } from './capabilities.js';
import type { IpodDatabase } from '../ipod/database.js';
import type { IPodTrack, TrackInput, TrackFields } from '../ipod/types.js';

/**
 * Adapter that wraps IpodDatabase to implement the generic DeviceAdapter interface.
 *
 * IPodTrack naturally satisfies DeviceTrack (same property names and types),
 * so this wrapper simply delegates calls without data transformation.
 */
export class IpodDeviceAdapter implements DeviceAdapter {
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

  getTracks(): DeviceTrack[] {
    // IPodTrack satisfies DeviceTrack — return directly
    return this.ipod.getTracks() as unknown as DeviceTrack[];
  }

  addTrack(input: DeviceTrackInput): DeviceTrack {
    // DeviceTrackInput is a superset-compatible subset of TrackInput
    return this.ipod.addTrack(input as TrackInput) as unknown as DeviceTrack;
  }

  updateTrack(track: DeviceTrack, fields: DeviceTrackMetadata): DeviceTrack {
    return this.ipod.updateTrack(
      track as unknown as IPodTrack,
      fields as TrackFields
    ) as unknown as DeviceTrack;
  }

  removeTrack(track: DeviceTrack, options?: { deleteFile?: boolean }): void {
    this.ipod.removeTrack(track as unknown as IPodTrack, options);
  }

  replaceTrackFile(track: DeviceTrack, newFilePath: string): DeviceTrack {
    return this.ipod.replaceTrackFile(
      track as unknown as IPodTrack,
      newFilePath
    ) as unknown as DeviceTrack;
  }

  // Persistence

  async save(): Promise<void> {
    await this.ipod.save();
  }

  close(): void {
    this.ipod.close();
  }
}
