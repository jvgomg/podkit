/**
 * Configuration module for podkit CLI
 *
 * Provides configuration loading from multiple sources with priority-based merging.
 *
 * @example
 * ```typescript
 * import { loadConfig, DEFAULT_CONFIG_PATH } from './config/index.js';
 *
 * const globalOpts = program.opts();
 * const { config, configFileExists } = loadConfig(globalOpts);
 *
 * console.log(`Source: ${config.source ?? '(not set)'}`);
 * console.log(`Quality: ${config.quality}`);
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
} from './types.js';
export { DEFAULT_TRANSFORMS_CONFIG, VIDEO_QUALITY_PRESETS } from './types.js';

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
