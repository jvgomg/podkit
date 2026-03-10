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
  fallback: `${ENV_PREFIX}FALLBACK`,
  artwork: `${ENV_PREFIX}ARTWORK`,
} as const;
