/**
 * Configuration module for podkit CLI
 *
 * Provides configuration loading from multiple sources with priority-based merging.
 * Uses the multi-collection/device schema defined in ADR-008.
 *
 * @example
 * ```typescript
 * import { loadConfig, DEFAULT_CONFIG_PATH } from './config/index.js';
 *
 * const globalOpts = program.opts();
 * const { config, configFileExists } = loadConfig(globalOpts);
 *
 * console.log(`Quality: ${config.quality}`);
 * console.log(`Default device: ${config.defaults?.device}`);
 * ```
 */

// Types
export type {
  PodkitConfig,
  PartialConfig,
  QualityPreset,
  GlobalOptions,
  ConfigFileContent,
  TransformsConfig,
  VideoQualityPreset,
  // Multi-collection/device types (ADR-008)
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
  DefaultsConfig,
  // Raw config file types
  ConfigFileCleanArtists,
  ConfigFileMusicCollection,
  ConfigFileVideoCollection,
  ConfigFileDevice,
  ConfigFileDefaults,
} from './types.js';
export { QUALITY_PRESETS, DEFAULT_TRANSFORMS_CONFIG, VIDEO_QUALITY_PRESETS } from './types.js';

// Defaults
export { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, ENV_PREFIX, ENV_KEYS } from './defaults.js';

// Loader functions
export {
  loadConfig,
  loadConfigFile,
  loadEnvConfig,
  loadCliConfig,
  mergeConfigs,
  type LoadConfigResult,
} from './loader.js';

// Writer functions
export {
  // Device management functions
  addDevice,
  updateDevice,
  removeDevice,
  setDefaultDevice,
  // Collection management functions
  addMusicCollection,
  addVideoCollection,
  removeCollection,
  setDefaultCollection,
  type CollectionType,
  type UpdateConfigOptions,
  type UpdateConfigResult,
} from './writer.js';
