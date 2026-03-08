/**
 * Configuration loading and merging logic
 *
 * Priority order (lowest to highest):
 * 1. Defaults (hardcoded)
 * 2. Default config file (~/.config/podkit/config.toml)
 * 3. Config file via --config path
 * 4. Environment variables (PODKIT_*)
 * 5. CLI arguments
 */

import * as fs from 'node:fs';
import { parse as parseTOML } from 'smol-toml';
import type {
  PodkitConfig,
  PartialConfig,
  QualityPreset,
  AacQualityPreset,
  ConfigFileContent,
  GlobalOptions,
  TransformsConfig,
  VideoQualityPreset,
} from './types.js';
import { QUALITY_PRESETS, AAC_QUALITY_PRESETS, DEFAULT_TRANSFORMS_CONFIG, VIDEO_QUALITY_PRESETS } from './types.js';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, ENV_KEYS } from './defaults.js';

/**
 * Check if a string is a valid quality preset
 */
function isValidQuality(value: string): value is QualityPreset {
  return QUALITY_PRESETS.includes(value as QualityPreset);
}

/**
 * Check if a string is a valid AAC quality preset (for fallback)
 */
function isValidAacQuality(value: string): value is AacQualityPreset {
  return AAC_QUALITY_PRESETS.includes(value as AacQualityPreset);
}

/**
 * Check if a string is a valid video quality preset
 */
function isValidVideoQuality(value: string): value is VideoQualityPreset {
  return VIDEO_QUALITY_PRESETS.includes(value as VideoQualityPreset);
}

/**
 * Read and parse a TOML config file
 *
 * @param configPath Path to the config file
 * @returns Parsed config or undefined if file doesn't exist
 * @throws Error if file exists but cannot be parsed
 */
export function loadConfigFile(configPath: string): PartialConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = parseTOML(content) as ConfigFileContent;

  const config: PartialConfig = {};

  if (typeof parsed.source === 'string') {
    config.source = parsed.source;
  }

  if (typeof parsed.device === 'string') {
    config.device = parsed.device;
  }

  if (typeof parsed.quality === 'string') {
    if (isValidQuality(parsed.quality)) {
      config.quality = parsed.quality;
    } else {
      throw new Error(
        `Invalid quality value "${parsed.quality}" in config. ` +
          `Valid values: ${QUALITY_PRESETS.join(', ')}`
      );
    }
  }

  if (typeof parsed.fallback === 'string') {
    if (isValidAacQuality(parsed.fallback)) {
      config.fallback = parsed.fallback;
    } else {
      throw new Error(
        `Invalid fallback value "${parsed.fallback}" in config. ` +
          `Valid values: ${AAC_QUALITY_PRESETS.join(', ')}`
      );
    }
  }

  if (typeof parsed.artwork === 'boolean') {
    config.artwork = parsed.artwork;
  }

  // Parse transforms section
  if (parsed.transforms !== undefined) {
    config.transforms = parseTransformsConfig(parsed.transforms);
  }

  // Parse video settings
  // Support both flat (videoSource, videoQuality) and nested ([video]) formats
  const videoSource = parsed.videoSource ?? parsed.video?.source;
  const videoQuality = parsed.videoQuality ?? parsed.video?.quality;

  if (typeof videoSource === 'string') {
    config.videoSource = videoSource;
  }

  if (typeof videoQuality === 'string') {
    if (isValidVideoQuality(videoQuality)) {
      config.videoQuality = videoQuality;
    } else {
      throw new Error(
        `Invalid videoQuality value "${videoQuality}" in config. ` +
          `Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`
      );
    }
  }

  return config;
}

/**
 * Parse and validate transforms config from TOML
 *
 * Merges provided values with defaults and validates types.
 */
function parseTransformsConfig(raw: ConfigFileContent['transforms']): TransformsConfig {
  const config: TransformsConfig = { ...DEFAULT_TRANSFORMS_CONFIG };

  if (raw?.ftintitle !== undefined) {
    const ftRaw = raw.ftintitle;
    config.ftintitle = {
      ...DEFAULT_TRANSFORMS_CONFIG.ftintitle,
    };

    // Validate types and set values
    if (ftRaw.enabled !== undefined) {
      if (typeof ftRaw.enabled !== 'boolean') {
        throw new Error(
          `Invalid type for "enabled" in [transforms.ftintitle]. ` +
            `Expected boolean, got ${typeof ftRaw.enabled}.`
        );
      }
      config.ftintitle.enabled = ftRaw.enabled;
    }
    if (ftRaw.drop !== undefined) {
      if (typeof ftRaw.drop !== 'boolean') {
        throw new Error(
          `Invalid type for "drop" in [transforms.ftintitle]. ` +
            `Expected boolean, got ${typeof ftRaw.drop}.`
        );
      }
      config.ftintitle.drop = ftRaw.drop;
    }
    if (ftRaw.format !== undefined) {
      if (typeof ftRaw.format !== 'string') {
        throw new Error(
          `Invalid type for "format" in [transforms.ftintitle]. ` +
            `Expected string, got ${typeof ftRaw.format}.`
        );
      }
      // Validate format contains placeholder
      if (!ftRaw.format.includes('{}')) {
        throw new Error(
          `Invalid format "${ftRaw.format}" in [transforms.ftintitle]. ` +
            'Format must contain "{}" placeholder for featured artist(s).'
        );
      }
      config.ftintitle.format = ftRaw.format;
    }
    if (ftRaw.ignore !== undefined) {
      if (!Array.isArray(ftRaw.ignore)) {
        throw new Error(
          `Invalid type for "ignore" in [transforms.ftintitle]. ` +
            `Expected array of strings, got ${typeof ftRaw.ignore}.`
        );
      }
      // Validate each element is a string
      for (const item of ftRaw.ignore) {
        if (typeof item !== 'string') {
          throw new Error(
            `Invalid item in "ignore" array in [transforms.ftintitle]. ` +
              `Expected string, got ${typeof item}.`
          );
        }
      }
      config.ftintitle.ignore = ftRaw.ignore;
    }
  }

  return config;
}

/**
 * Read configuration from environment variables
 *
 * Reads PODKIT_SOURCE, PODKIT_DEVICE, PODKIT_QUALITY, PODKIT_ARTWORK
 */
export function loadEnvConfig(): PartialConfig {
  const config: PartialConfig = {};

  const source = process.env[ENV_KEYS.source];
  if (source !== undefined) {
    config.source = source;
  }

  const device = process.env[ENV_KEYS.device];
  if (device !== undefined) {
    config.device = device;
  }

  const quality = process.env[ENV_KEYS.quality];
  if (quality !== undefined) {
    if (isValidQuality(quality)) {
      config.quality = quality;
    }
    // Silently ignore invalid quality values from env
    // (could log a warning in verbose mode)
  }

  const fallback = process.env[ENV_KEYS.fallback];
  if (fallback !== undefined) {
    if (isValidAacQuality(fallback)) {
      config.fallback = fallback;
    }
    // Silently ignore invalid fallback values from env
  }

  const artwork = process.env[ENV_KEYS.artwork];
  if (artwork !== undefined) {
    // Accept 'true', '1', 'yes' as truthy
    config.artwork = ['true', '1', 'yes'].includes(artwork.toLowerCase());
  }

  return config;
}

/**
 * Extract config values from CLI options
 *
 * Maps command-specific options to config structure
 */
export function loadCliConfig(
  globalOpts: GlobalOptions,
  commandOpts?: {
    source?: string;
    quality?: string;
    fallback?: string;
    artwork?: boolean;
  }
): PartialConfig {
  const config: PartialConfig = {};

  // Global --device option
  if (globalOpts.device !== undefined) {
    config.device = globalOpts.device;
  }

  // Command-specific options
  if (commandOpts) {
    if (commandOpts.source !== undefined) {
      config.source = commandOpts.source;
    }

    if (commandOpts.quality !== undefined) {
      if (isValidQuality(commandOpts.quality)) {
        config.quality = commandOpts.quality;
      }
    }

    if (commandOpts.fallback !== undefined) {
      if (isValidAacQuality(commandOpts.fallback)) {
        config.fallback = commandOpts.fallback;
      }
    }

    if (commandOpts.artwork !== undefined) {
      config.artwork = commandOpts.artwork;
    }
  }

  return config;
}

/**
 * Merge multiple partial configs with priority (later configs win)
 */
export function mergeConfigs(...configs: PartialConfig[]): PodkitConfig {
  const merged: PodkitConfig = {
    ...DEFAULT_CONFIG,
    transforms: { ...DEFAULT_CONFIG.transforms },
  };

  for (const config of configs) {
    if (config.source !== undefined) {
      merged.source = config.source;
    }
    if (config.device !== undefined) {
      merged.device = config.device;
    }
    if (config.quality !== undefined) {
      merged.quality = config.quality;
    }
    if (config.fallback !== undefined) {
      merged.fallback = config.fallback;
    }
    if (config.artwork !== undefined) {
      merged.artwork = config.artwork;
    }
    if (config.transforms !== undefined) {
      // Deep merge transforms config
      // NOTE: When adding new transforms, update this block to include them
      merged.transforms = {
        ftintitle: {
          ...merged.transforms.ftintitle,
          ...config.transforms.ftintitle,
        },
      };
    }
    // Video settings
    if (config.videoSource !== undefined) {
      merged.videoSource = config.videoSource;
    }
    if (config.videoQuality !== undefined) {
      merged.videoQuality = config.videoQuality;
    }
  }

  return merged;
}

/**
 * Result of loading configuration
 */
export interface LoadConfigResult {
  /** The merged configuration */
  config: PodkitConfig;
  /** Path to the config file that was loaded (if any) */
  configPath?: string;
  /** Whether the config file existed */
  configFileExists: boolean;
}

/**
 * Load configuration from all sources and merge with priority
 *
 * Priority order (lowest to highest):
 * 1. Defaults
 * 2. Default config file (~/.config/podkit/config.toml)
 * 3. Custom config file (--config path)
 * 4. Environment variables
 * 5. CLI arguments
 *
 * @param globalOpts Global CLI options
 * @param commandOpts Command-specific options (source, quality, artwork)
 * @returns Merged configuration and metadata
 */
export function loadConfig(
  globalOpts: GlobalOptions,
  commandOpts?: {
    source?: string;
    quality?: string;
    artwork?: boolean;
  }
): LoadConfigResult {
  const configsToMerge: PartialConfig[] = [];

  // Determine which config file to load
  const configPath = globalOpts.config ?? DEFAULT_CONFIG_PATH;
  const configFileExists = fs.existsSync(configPath);

  // Load config file (if it exists)
  if (configFileExists) {
    const fileConfig = loadConfigFile(configPath);
    if (fileConfig) {
      configsToMerge.push(fileConfig);
    }
  }

  // Load environment variables
  const envConfig = loadEnvConfig();
  configsToMerge.push(envConfig);

  // Load CLI options
  const cliConfig = loadCliConfig(globalOpts, commandOpts);
  configsToMerge.push(cliConfig);

  // Merge all sources
  const config = mergeConfigs(...configsToMerge);

  return {
    config,
    configPath: configFileExists ? configPath : undefined,
    configFileExists,
  };
}
