/**
 * Target abstraction for E2E tests.
 *
 * This interface allows tests to run against both dummy iPods (created via
 * gpod-testing) and real iPod devices, using the same test code.
 */

import type { VerifyResult } from '@podkit/gpod-testing';
import type { SyncTarget } from './sync-target';

/**
 * An iPod target for E2E testing — a {@link SyncTarget} specialised to iPod
 * devices (adds iTunesDB-specific operations).
 *
 * Implementations exist for:
 * - Dummy iPods (via @podkit/gpod-testing)
 * - Real iPod devices (via mount point)
 */
export interface IpodTarget extends SyncTarget {
  readonly kind: 'ipod';

  /**
   * Get the number of tracks on the iPod.
   */
  getTrackCount(): Promise<number>;

  /**
   * Verify the iPod database integrity.
   */
  verify(): Promise<VerifyResult>;
}

/**
 * Factory for creating iPod targets.
 */
export interface IpodTargetFactory {
  /**
   * Create a new target.
   *
   * @param options - Optional configuration
   */
  create(options?: TargetOptions): Promise<IpodTarget>;
}

/**
 * Options for creating a target.
 */
export interface TargetOptions {
  /** Name for the iPod (used in dummy targets) */
  name?: string;
  /** iPod model number to create (dummy targets only; defaults to MA147). */
  model?: string;
}

/**
 * Target type, determined by IPOD_TARGET environment variable.
 */
export type TargetType = 'dummy' | 'real';
