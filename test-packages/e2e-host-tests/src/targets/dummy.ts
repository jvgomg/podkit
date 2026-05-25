/**
 * Dummy iPod target using @podkit/gpod-testing.
 *
 * Creates a temporary iPod directory structure for testing. These are
 * automatically cleaned up after tests complete.
 */

import { createTestIpod } from '@podkit/gpod-testing';
import type { TrackInfo, VerifyResult } from '@podkit/gpod-testing';
import type { IpodTarget, IpodTargetFactory, TargetOptions } from './types';

/**
 * A dummy iPod target backed by @podkit/gpod-testing.
 */
export class DummyIpodTarget implements IpodTarget {
  readonly isRealDevice = false;

  private constructor(
    readonly path: string,
    readonly name: string,
    private readonly testIpod: Awaited<ReturnType<typeof createTestIpod>>
  ) {}

  /**
   * Create a new dummy iPod target.
   */
  static async create(options?: TargetOptions): Promise<DummyIpodTarget> {
    const name = options?.name ?? 'E2E Test iPod';
    const testIpod = await createTestIpod({ name });
    return new DummyIpodTarget(testIpod.path, name, testIpod);
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
