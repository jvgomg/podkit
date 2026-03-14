/**
 * High-level test utilities for creating and managing test iPod environments.
 *
 * @example
 * ```typescript
 * import { createTestIpod, withTestIpod } from '@podkit/gpod-testing';
 *
 * // Manual lifecycle management
 * const ipod = await createTestIpod();
 * try {
 *   // Use ipod.path for testing
 * } finally {
 *   await ipod.cleanup();
 * }
 *
 * // Automatic lifecycle management
 * await withTestIpod(async (ipod) => {
 *   // Use ipod.path for testing
 * });
 * ```
 *
 * @module
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CreateTestIpodOptions,
  TestIpod,
  IpodModelNumber,
  TrackInput,
  DatabaseInfo,
  TrackInfo,
  AddTrackResult,
  VerifyResult,
} from './types';
import * as gpodTool from './gpod-tool';

/**
 * Default FirewireGuid for test iPod environments.
 * Used automatically when creating test databases for models
 * that require authentication checksums (Classic, Nano 3+).
 */
export const TEST_FIREWIRE_GUID = '0000000000000000000000000000000000DECADE';

/**
 * Create a test iPod environment.
 *
 * Creates a complete iPod directory structure with database, suitable for
 * testing libgpod operations. The iPod is created in a temp directory by
 * default, or at a specified path.
 *
 * @param options - Configuration options
 * @returns A TestIpod instance with cleanup method
 *
 * @example
 * ```typescript
 * const ipod = await createTestIpod();
 * console.log(ipod.path); // /tmp/test-ipod-abc123
 *
 * // Add test data
 * await ipod.addTrack({ title: 'Test Song', artist: 'Test Artist' });
 *
 * // Get info
 * const info = await ipod.info();
 * console.log(info.trackCount); // 1
 *
 * // Clean up when done
 * await ipod.cleanup();
 * ```
 */
export async function createTestIpod(
  options: CreateTestIpodOptions = {}
): Promise<TestIpod & TestIpodHelpers> {
  const model = options.model ?? 'MA147';
  const name = options.name ?? 'Test iPod';

  // Create temp directory if no path specified
  let ipodPath: string;
  let isTemp: boolean;

  if (options.path) {
    ipodPath = options.path;
    isTemp = false;
  } else {
    ipodPath = await mkdtemp(join(tmpdir(), 'test-ipod-'));
    isTemp = true;
  }

  // Initialize iPod structure
  await gpodTool.init(ipodPath, {
    model,
    name,
    firewireId: options.firewireId ?? TEST_FIREWIRE_GUID,
  });

  // Track cleanup state
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;

    if (isTemp) {
      await rm(ipodPath, { recursive: true, force: true });
    }
  };

  // Create the TestIpod object with helper methods
  const testIpod: TestIpod & TestIpodHelpers = {
    path: ipodPath,
    model,
    name,
    cleanup,

    // Helper methods
    info: () => gpodTool.info(ipodPath),
    tracks: () => gpodTool.tracks(ipodPath),
    addTrack: (track: TrackInput) => gpodTool.addTrack(ipodPath, track),
    verify: () => gpodTool.verify(ipodPath),
  };

  return testIpod;
}

/**
 * Additional helper methods available on TestIpod instances.
 */
interface TestIpodHelpers {
  /** Get database info */
  info(): Promise<DatabaseInfo>;

  /** List all tracks */
  tracks(): Promise<TrackInfo[]>;

  /** Add a track */
  addTrack(track: TrackInput): Promise<AddTrackResult>;

  /** Verify database integrity */
  verify(): Promise<VerifyResult>;
}

// Re-export types from types.ts for convenience
export type { DatabaseInfo, TrackInfo, AddTrackResult, VerifyResult } from './types';

/**
 * Run a test function with a temporary test iPod.
 *
 * Creates a test iPod, runs the provided function, and ensures cleanup
 * even if the function throws.
 *
 * @param fn - Test function to run with the test iPod
 * @param options - Configuration options
 *
 * @example
 * ```typescript
 * await withTestIpod(async (ipod) => {
 *   await ipod.addTrack({ title: 'Test' });
 *   const info = await ipod.info();
 *   expect(info.trackCount).toBe(1);
 * });
 * // Cleanup happens automatically
 * ```
 */
export async function withTestIpod<T>(
  fn: (ipod: TestIpod & TestIpodHelpers) => Promise<T>,
  options: CreateTestIpodOptions = {}
): Promise<T> {
  const ipod = await createTestIpod(options);
  try {
    return await fn(ipod);
  } finally {
    await ipod.cleanup();
  }
}

/**
 * Create multiple test iPods with different models.
 *
 * Useful for testing behavior across different iPod generations.
 *
 * @param models - Array of model identifiers
 * @returns Array of TestIpod instances (remember to cleanup all)
 *
 * @example
 * ```typescript
 * const ipods = await createTestIpodsForModels(['MA147', 'MB565']);
 * try {
 *   for (const ipod of ipods) {
 *     console.log(`Testing ${ipod.model}...`);
 *   }
 * } finally {
 *   await Promise.all(ipods.map(i => i.cleanup()));
 * }
 * ```
 */
export async function createTestIpodsForModels(
  models: IpodModelNumber[]
): Promise<(TestIpod & TestIpodHelpers)[]> {
  return Promise.all(models.map((model) => createTestIpod({ model, name: `Test ${model}` })));
}

/**
 * Pre-configured test iPod models for common test scenarios.
 */
export const TestModels = {
  /** iPod Video 60GB (5th gen) - Primary test target, full features */
  VIDEO_60GB: 'MA147' as IpodModelNumber,

  /** iPod Video 30GB (5th gen) - Same features, smaller capacity */
  VIDEO_30GB: 'MA002' as IpodModelNumber,

  /** iPod Video 30GB Black (5th gen) - Alternative Video model */
  VIDEO_30GB_BLACK: 'MA146' as IpodModelNumber,

  /** iPod Nano 2GB (2nd gen) - Nano-specific behavior */
  NANO_2GB: 'MA477' as IpodModelNumber,

  /** iPod Classic 120GB (6th gen) - Hash58 checksum model */
  CLASSIC_120GB: 'MB565' as IpodModelNumber,

  /** iPod Classic 160GB (7th gen) - Latest Classic model */
  CLASSIC_160GB: 'MC293' as IpodModelNumber,

  /** iPod Nano 8GB (5th gen) - Hash72 checksum model with HashInfo */
  NANO_5G: 'MC027' as IpodModelNumber,
} as const;
