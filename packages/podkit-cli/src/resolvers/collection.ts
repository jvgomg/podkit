/**
 * Collection resolution module
 *
 * Handles resolving music and video collections from:
 * - CLI -c/--collection argument
 * - Positional argument [name]
 * - Default collection from config
 */

import type {
  PodkitConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
} from '../config/types.js';
import type {
  CollectionType,
  ResolvedMusicCollection,
  ResolvedVideoCollection,
  ResolutionResult,
} from './types.js';
import { resolveNamedEntity } from './core.js';

// =============================================================================
// Music Collection Resolution
// =============================================================================

/**
 * Resolve a music collection from config
 *
 * @param config - The merged config
 * @param collectionName - Optional collection name (from CLI arg or positional)
 * @returns Resolution result with collection config or error
 *
 * @example
 * ```typescript
 * const result = resolveMusicCollection(config, 'main');
 * if (result.success) {
 *   console.log(result.entity.config.path);
 * }
 * ```
 */
export function resolveMusicCollection(
  config: PodkitConfig,
  collectionName?: string
): ResolutionResult<MusicCollectionConfig> {
  return resolveNamedEntity({
    entities: config.music,
    defaultName: config.defaults?.music,
    requestedName: collectionName,
    entityType: 'music collection',
    addCommand: 'podkit collection add music <name> <path>',
  });
}

// =============================================================================
// Video Collection Resolution
// =============================================================================

/**
 * Resolve a video collection from config
 *
 * @param config - The merged config
 * @param collectionName - Optional collection name (from CLI arg or positional)
 * @returns Resolution result with collection config or error
 *
 * @example
 * ```typescript
 * const result = resolveVideoCollection(config, 'movies');
 * if (result.success) {
 *   console.log(result.entity.config.path);
 * }
 * ```
 */
export function resolveVideoCollection(
  config: PodkitConfig,
  collectionName?: string
): ResolutionResult<VideoCollectionConfig> {
  return resolveNamedEntity({
    entities: config.video,
    defaultName: config.defaults?.video,
    requestedName: collectionName,
    entityType: 'video collection',
    addCommand: 'podkit collection add video <name> <path>',
  });
}

// =============================================================================
// Unified Collection Resolution
// =============================================================================

/**
 * Find a collection by name in both namespaces
 *
 * Searches both music and video collections for the given name.
 * Useful when the collection type is not specified.
 *
 * @param config - The merged config
 * @param name - Collection name to find
 * @returns Object with music and/or video collection if found
 */
export function findCollectionByName(
  config: PodkitConfig,
  name: string
): {
  music?: ResolvedMusicCollection;
  video?: ResolvedVideoCollection;
} {
  const result: {
    music?: ResolvedMusicCollection;
    video?: ResolvedVideoCollection;
  } = {};

  if (config.music?.[name]) {
    result.music = { name, config: config.music[name] };
  }
  if (config.video?.[name]) {
    result.video = { name, config: config.video[name] };
  }

  return result;
}

/**
 * Resolve collection by type
 *
 * Generic function that dispatches to type-specific resolver.
 *
 * @param config - The merged config
 * @param type - Collection type ('music' or 'video')
 * @param collectionName - Optional collection name
 * @returns Resolution result
 */
export function resolveCollectionByType(
  config: PodkitConfig,
  type: CollectionType,
  collectionName?: string
): ResolutionResult<MusicCollectionConfig | VideoCollectionConfig> {
  if (type === 'music') {
    return resolveMusicCollection(config, collectionName);
  }
  return resolveVideoCollection(config, collectionName);
}

// =============================================================================
// Collection Info Helpers
// =============================================================================

/**
 * Collection info for display
 */
export interface CollectionInfo {
  name: string;
  type: CollectionType;
  path: string;
  isDefault: boolean;
  /** For subsonic collections */
  subsonicUrl?: string;
  subsonicUsername?: string;
}

/**
 * Get all collections from config
 *
 * @param config - The merged config
 * @param filterType - Optional type filter
 * @returns Array of collection info, sorted by default status and name
 */
export function getAllCollections(
  config: PodkitConfig,
  filterType?: CollectionType
): CollectionInfo[] {
  const collections: CollectionInfo[] = [];

  // Get music collections
  if (!filterType || filterType === 'music') {
    const musicCollections = config.music ?? {};
    for (const [name, col] of Object.entries(musicCollections)) {
      collections.push({
        name,
        type: 'music',
        path: col.path,
        isDefault: config.defaults?.music === name,
        subsonicUrl: col.type === 'subsonic' ? col.url : undefined,
        subsonicUsername: col.type === 'subsonic' ? col.username : undefined,
      });
    }
  }

  // Get video collections
  if (!filterType || filterType === 'video') {
    const videoCollections = config.video ?? {};
    for (const [name, col] of Object.entries(videoCollections)) {
      collections.push({
        name,
        type: 'video',
        path: col.path,
        isDefault: config.defaults?.video === name,
      });
    }
  }

  // Sort: defaults first, then by type, then by name
  collections.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    if (a.type < b.type) return -1;
    if (a.type > b.type) return 1;
    return a.name.localeCompare(b.name);
  });

  return collections;
}
