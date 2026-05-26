/**
 * Target abstraction for E2E tests.
 *
 * This interface allows tests to run against both dummy iPods (created via
 * gpod-testing) and real iPod devices, using the same test code.
 */

import type { TrackInfo, VerifyResult } from '@podkit/gpod-testing';

/**
 * An iPod target for E2E testing.
 *
 * Implementations exist for:
 * - Dummy iPods (via @podkit/gpod-testing)
 * - Real iPod devices (via mount point)
 */
export interface IpodTarget {
  /** Absolute path to the iPod mount point */
  readonly path: string;

  /** Display name for logging/debugging */
  readonly name: string;

  /** Whether this is a real device (affects cleanup behavior) */
  readonly isRealDevice: boolean;

  /**
   * Get the number of tracks on the iPod.
   */
  getTrackCount(): Promise<number>;

  /**
   * Get all tracks on the iPod.
   */
  getTracks(): Promise<TrackInfo[]>;

  /**
   * Verify the iPod database integrity.
   */
  verify(): Promise<VerifyResult>;

  /**
   * Clean up the target.
   *
   * For dummy iPods: deletes the temp directory
   * For real iPods: no-op (never auto-delete user data)
   */
  cleanup(): Promise<void>;
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
}

/**
 * Target type, determined by IPOD_TARGET environment variable.
 */
export type TargetType = 'dummy' | 'real';
