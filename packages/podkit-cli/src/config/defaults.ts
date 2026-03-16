/**
 * Default configuration values for podkit
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { PodkitConfig } from './types.js';
import { DEFAULT_TRANSFORMS_CONFIG } from './types.js';

/**
 * Default location for config file
 */
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config', 'podkit', 'config.toml');

/**
 * Default configuration values
 *
 * These are used when no config file exists and no CLI/env overrides are provided.
 */
export const DEFAULT_CONFIG: PodkitConfig = {
  quality: 'high',
  artwork: true,
  transforms: DEFAULT_TRANSFORMS_CONFIG,
};

/**
 * Environment variable prefix for config overrides
 */
export const ENV_PREFIX = 'PODKIT_';

/**
 * Mapping of config keys to environment variable names
 */
export const ENV_KEYS = {
  quality: `${ENV_PREFIX}QUALITY`,
  audioQuality: `${ENV_PREFIX}AUDIO_QUALITY`,
  videoQuality: `${ENV_PREFIX}VIDEO_QUALITY`,
  encoding: `${ENV_PREFIX}ENCODING`,
  customBitrate: `${ENV_PREFIX}CUSTOM_BITRATE`,
  bitrateTolerance: `${ENV_PREFIX}BITRATE_TOLERANCE`,
  forceTranscode: `${ENV_PREFIX}FORCE_TRANSCODE`,
  forceSyncTags: `${ENV_PREFIX}FORCE_SYNC_TAGS`,
  artwork: `${ENV_PREFIX}ARTWORK`,
  cleanArtists: `${ENV_PREFIX}CLEAN_ARTISTS`,
  cleanArtistsDrop: `${ENV_PREFIX}CLEAN_ARTISTS_DROP`,
  cleanArtistsFormat: `${ENV_PREFIX}CLEAN_ARTISTS_FORMAT`,
  cleanArtistsIgnore: `${ENV_PREFIX}CLEAN_ARTISTS_IGNORE`,
} as const;
