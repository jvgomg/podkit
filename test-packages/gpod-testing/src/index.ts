/**
 * Test utilities for creating and managing iPod test environments.
 *
 * This package provides a TypeScript wrapper around gpod-tool for use in
 * Bun tests. It enables testing iPod-related functionality without requiring
 * a physical device.
 *
 * @example
 * ```typescript
 * import { createTestIpod, withTestIpod } from '@podkit/gpod-testing';
 *
 * describe('iPod sync', () => {
 *   it('adds tracks', async () => {
 *     await withTestIpod(async (ipod) => {
 *       await ipod.addTrack({ title: 'Test Song', artist: 'Artist' });
 *       const info = await ipod.info();
 *       expect(info.trackCount).toBe(1);
 *     });
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  IpodModelNumber,
  CreateTestIpodOptions,
  TestIpod,
  TestDeviceInfo,
  DatabaseInfo,
  TrackInput,
  TrackInfo,
  AddTrackResult,
  VerifyResult,
} from './types';

// High-level test utilities (primary API)
export {
  createTestIpod,
  withTestIpod,
  createTestIpodsForModels,
  TestModels,
  TEST_FIREWIRE_GUID,
} from './test-ipod';

// Template internals (exported for tests / introspection)
export { TEMPLATE_MODELS, templatesDir, templatePath } from './templates';

// Low-level gpod-tool wrapper (for advanced use)
export * as gpodTool from './gpod-tool';
export { GpodToolError, isGpodToolAvailable, getGpodToolVersion } from './gpod-tool';

// Preflight assertions for integration test runs.
// Wire into a package's `test:integration` script via `bun test --preload`.
export { requireFFmpeg, requireGpodTool, failMissingDep } from './preflight';
