/**
 * Resolvers module - unified entity resolution for CLI
 *
 * This module provides clean, consistent resolution patterns for:
 * - Devices (iPods from config.devices)
 * - Collections (music/video from config.music/config.video)
 *
 * All resolvers follow the same pattern:
 * 1. If explicit name given, look it up (error if not found)
 * 2. Otherwise, use configured default
 * 3. Clear error messages with available options
 *
 * @example Device resolution
 * ```typescript
 * import { parseCliDeviceArg, resolveEffectiveDevice, resolveDevicePath } from './resolvers';
 *
 * // Parse --device flag (could be path or name)
 * const cliArg = parseCliDeviceArg(globalOpts.device, config);
 *
 * // Resolve to device config (combining CLI and positional arg)
 * const result = resolveEffectiveDevice(cliArg, positionalName, config);
 * if (!result.success) {
 *   console.error(result.error);
 *   return;
 * }
 *
 * // Resolve to physical path
 * const pathResult = await resolveDevicePath({
 *   cliPath: result.cliPath,
 *   deviceIdentity: getDeviceIdentity(result.device),
 *   manager,
 * });
 * ```
 *
 * @example Collection resolution
 * ```typescript
 * import { resolveMusicCollection } from './resolvers';
 *
 * const result = resolveMusicCollection(config, collectionName);
 * if (!result.success) {
 *   console.error(result.error);
 *   return;
 * }
 * console.log(result.entity.config.path);
 * ```
 */

// Types
export type {
  ResolvedEntity,
  ResolutionResult,
  ResolvedDevice,
  DeviceIdentity,
  CliDeviceArg,
  CollectionType,
  ResolvedMusicCollection,
  ResolvedVideoCollection,
  ResolutionContext,
} from './types.js';

// Core utilities
export { resolveNamedEntity, formatNotFoundError, getAvailableNames, isPathLike } from './core.js';

// Device resolution
export {
  resolveDevice,
  getDeviceIdentity,
  parseCliDeviceArg,
  resolveEffectiveDevice,
  resolveDevicePath,
  autoDetectDevice,
  formatDevicePathError,
  formatDeviceLookupMessage,
  type DevicePathResult,
  type DevicePathOptions,
  type MatchedDevice,
} from './device.js';

// Collection resolution
export {
  resolveMusicCollection,
  resolveVideoCollection,
  findCollectionByName,
  resolveCollectionByType,
  getAllCollections,
  type CollectionInfo,
} from './collection.js';

// Effective (multi-type, provenance-carrying) collection resolution
export {
  resolveEffectiveCollections,
  type CollectionSource,
  type EffectiveCollection,
  type ResolveCollectionsInput,
} from './effective-collections.js';

// Content path resolution (mass-storage)
export { resolveDeviceContentPaths } from './content-paths.js';
