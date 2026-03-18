/**
 * Unified resolution types for CLI entity lookup
 *
 * This module provides shared types for resolving named entities (devices,
 * collections) from configuration. The pattern supports:
 * - Lookup by explicit name
 * - Fallback to configured default
 * - Clear error messages when not found
 */

import type {
  PodkitConfig,
  DeviceConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
} from '../config/types.js';

// =============================================================================
// Generic Resolution Types
// =============================================================================

/**
 * Successful resolution of a named entity
 */
export interface ResolvedEntity<T> {
  /** Entity name (key in config) */
  name: string;
  /** Entity configuration */
  config: T;
}

/**
 * Result of resolving a named entity from config
 */
export type ResolutionResult<T> =
  | { success: true; entity: ResolvedEntity<T> }
  | { success: false; error: string };

// =============================================================================
// Device Types
// =============================================================================

/**
 * Resolved device from config
 */
export type ResolvedDevice = ResolvedEntity<DeviceConfig>;

/**
 * Device identity for path resolution (UUID-based detection)
 */
export interface DeviceIdentity {
  volumeUuid?: string;
  volumeName?: string;
}

/**
 * Result of parsing CLI --device argument
 *
 * The --device flag can accept either:
 * - A path (e.g., /Volumes/IPOD) - identified by containing / or starting with .
 * - A named device (e.g., terapod) - looked up in config.devices
 */
export type CliDeviceArg =
  | { type: 'none' }
  | { type: 'path'; path: string }
  | { type: 'name'; name: string; device?: ResolvedDevice; notFound?: boolean };

// =============================================================================
// Collection Types
// =============================================================================

/**
 * Collection type discriminator
 */
export type CollectionType = 'music' | 'video';

/**
 * Resolved music collection from config
 */
export type ResolvedMusicCollection = ResolvedEntity<MusicCollectionConfig>;

/**
 * Resolved video collection from config
 */
export type ResolvedVideoCollection = ResolvedEntity<VideoCollectionConfig>;

// =============================================================================
// Shared Context Type
// =============================================================================

/**
 * Minimal config interface needed for resolution
 *
 * This allows resolvers to work with just the parts of config they need,
 * making testing easier.
 */
export interface ResolutionContext {
  config: PodkitConfig;
}
