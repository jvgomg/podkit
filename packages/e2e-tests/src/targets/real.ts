/**
 * Real iPod target for testing against actual devices.
 *
 * Reads the mount path from IPOD_MOUNT environment variable. Never
 * automatically modifies or deletes user data - cleanup is a no-op.
 */

import { gpodTool } from '@podkit/gpod-testing';
import type { TrackInfo, VerifyResult } from '@podkit/gpod-testing';
import type { IpodTarget, IpodTargetFactory, TargetOptions } from './types';

/**
 * A real iPod target using an actual mounted device.
 */
export class RealIpodTarget implements IpodTarget {
  readonly isRealDevice = true;

  private constructor(
    readonly path: string,
    readonly name: string
  ) {}

  /**
   * Create a real iPod target from environment variable.
   *
   * @throws If IPOD_MOUNT is not set or path doesn't exist
   */
  static async create(options?: TargetOptions): Promise<RealIpodTarget> {
    const mountPath = process.env['IPOD_MOUNT'];
    if (!mountPath) {
      throw new Error(
        'IPOD_MOUNT environment variable is required for real iPod testing.\n' +
          'Set it to the mount point of your iPod, e.g.:\n' +
          '  IPOD_MOUNT=/Volumes/iPod bun run test:real'
      );
    }

    // Verify the path exists
    const fs = await import('node:fs/promises');
    try {
      await fs.access(mountPath);
    } catch {
      throw new Error(`iPod mount path does not exist or is not accessible: ${mountPath}`);
    }

    // Get the iPod name from the database if possible
    let name = options?.name ?? 'Real iPod';
    try {
      const info = await gpodTool.info(mountPath);
      if (info.device.modelName) {
        name = info.device.modelName;
      }
    } catch {
      // Use default name if we can't read the database
    }

    return new RealIpodTarget(mountPath, name);
  }

  async getTrackCount(): Promise<number> {
    const info = await gpodTool.info(this.path);
    return info.trackCount;
  }

  async getTracks(): Promise<TrackInfo[]> {
    return gpodTool.tracks(this.path);
  }

  async verify(): Promise<VerifyResult> {
    return gpodTool.verify(this.path);
  }

  async cleanup(): Promise<void> {
    // No-op: never auto-delete user data on real devices
  }
}

/**
 * Factory for creating real iPod targets.
 */
export class RealIpodTargetFactory implements IpodTargetFactory {
  async create(options?: TargetOptions): Promise<IpodTarget> {
    return RealIpodTarget.create(options);
  }
}
