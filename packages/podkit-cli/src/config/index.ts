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
  EncodingMode,
  TransferMode,
  GlobalOptions,
  ConfigFileContent,
  TransformsConfig,
  VideoQualityPreset,
  VideoTransformsConfig,
  ShowLanguageConfig,
  // Multi-collection/device types (ADR-008)
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
  DefaultsConfig,
  // Raw config file types
  ConfigFileCleanArtists,
  ConfigFileShowLanguage,
  ConfigFileMusicCollection,
  ConfigFileVideoCollection,
  ConfigFileDevice,
  ConfigFileDefaults,
} from './types.js';
export type { DeviceType } from './types.js';
export {
  QUALITY_PRESETS,
  ENCODING_MODES,
  TRANSFER_MODES,
  CONTENT_TYPES,
  VIDEO_QUALITY_PRESETS,
  DEVICE_TYPES,
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  isValidTransferMode,
} from './types.js';

// Defaults
export { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, ENV_PREFIX, ENV_KEYS } from './defaults.js';

// Version detection
export { CURRENT_CONFIG_VERSION, readConfigVersion, checkConfigVersion } from './version.js';

// Loader functions
export {
  loadConfig,
  loadConfigFile,
  loadEnvConfig,
  loadCliConfig,
  mergeConfigs,
  type LoadConfigResult,
} from './loader.js';

// Migration engine
export type {
  Migration,
  MigrationContext,
  MigrationResult,
  AppliedMigration,
  PromptUtils,
  FsUtils,
  ChoiceOption,
} from './migrations/index.js';
export {
  MigrationAbortError,
  runMigrations,
  getPendingMigrations,
  registry as migrationRegistry,
} from './migrations/index.js';

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
