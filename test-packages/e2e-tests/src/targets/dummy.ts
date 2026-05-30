/**
 * Dummy iPod target using @podkit/gpod-testing.
 *
 * Creates a temporary iPod directory structure for testing. These are
 * automatically cleaned up after tests complete.
 */

import { join } from 'node:path';

import { createTestIpod } from '@podkit/gpod-testing';
import type { TrackInfo, VerifyResult } from '@podkit/gpod-testing';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { IpodTarget, IpodTargetFactory, TargetOptions } from './types';
import {
  ipodCapabilitiesForModel,
  IPOD_MUSIC_SUBPATH,
  type DeviceConfigFragment,
} from './sync-target';

/** Default dummy-iPod model — iPod Video 5th gen. */
const DEFAULT_MODEL = 'MA147';

/**
 * A dummy iPod target backed by @podkit/gpod-testing.
 */
export class DummyIpodTarget implements IpodTarget {
  readonly kind = 'ipod' as const;
  readonly isRealDevice = false;
  readonly capabilities: DeviceCapabilities;

  private constructor(
    readonly path: string,
    readonly name: string,
    readonly model: string,
    private readonly testIpod: Awaited<ReturnType<typeof createTestIpod>>
  ) {
    this.capabilities = ipodCapabilitiesForModel(model);
  }

  /**
   * Create a new dummy iPod target.
   */
  static async create(options?: TargetOptions): Promise<DummyIpodTarget> {
    const name = options?.name ?? 'E2E Test iPod';
    const model = options?.model ?? DEFAULT_MODEL;
    const testIpod = await createTestIpod({ name, model });
    return new DummyIpodTarget(testIpod.path, name, model, testIpod);
  }

  /** iPods are addressed by path and auto-detected — no device config block. */
  deviceConfig(): DeviceConfigFragment | null {
    return null;
  }

  musicRoot(): string {
    return join(this.path, ...IPOD_MUSIC_SUBPATH);
  }

  async getTrackCount(): Promise<number> {
    const info = await this.testIpod.info();
    return info.trackCount;
  }

  async getTracks(): Promise<TrackInfo[]> {
    return this.testIpod.tracks();
  }

  async verify(): Promise<VerifyResult> {
    return this.testIpod.verify();
  }

  async cleanup(): Promise<void> {
    await this.testIpod.cleanup();
  }
}

/**
 * Factory for creating dummy iPod targets.
 */
export class DummyIpodTargetFactory implements IpodTargetFactory {
  async create(options?: TargetOptions): Promise<IpodTarget> {
    return DummyIpodTarget.create(options);
  }
}
