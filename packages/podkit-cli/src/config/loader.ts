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
  VideoQualityPreset,
  ConfigFileContent,
  ConfigFileMusicCollection,
  ConfigFileVideoCollection,
  ConfigFileDevice,
  ConfigFileDefaults,
  GlobalOptions,
  TransformsConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
  DefaultsConfig,
} from './types.js';
import {
  QUALITY_PRESETS,
  AAC_QUALITY_PRESETS,
  DEFAULT_TRANSFORMS_CONFIG,
  VIDEO_QUALITY_PRESETS,
} from './types.js';
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

  // ==========================================================================
  // Parse multi-collection/device fields (ADR-008)
  // ==========================================================================

  // Parse music collections [music.*]
  const musicCollections = parseMusicCollections(parsed.music);
  if (musicCollections) {
    config.music = musicCollections;
  }

  // Parse video collections [video.*]
  const videoCollections = parseVideoCollections(parsed.video);
  if (videoCollections) {
    config.video = videoCollections;
  }

  // Parse devices [devices.*]
  const devices = parseDevices(parsed.devices);
  if (devices) {
    config.devices = devices;
  }

  // Parse defaults [defaults]
  const defaults = parseDefaults(parsed.defaults);
  if (defaults) {
    config.defaults = defaults;
  }

  // Validate default references
  validateDefaultReferences(config);

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

// =============================================================================
// Multi-Collection/Device Parsing (ADR-008)
// =============================================================================

/**
 * Parse music collections from TOML
 *
 * Extracts [music.*] sections into a Record<string, MusicCollectionConfig>.
 * Validates type field if present (must be 'directory' or 'subsonic').
 */
function parseMusicCollections(
  rawMusic: Record<string, ConfigFileMusicCollection> | undefined
): Record<string, MusicCollectionConfig> | undefined {
  if (!rawMusic || typeof rawMusic !== 'object') {
    return undefined;
  }

  const collections: Record<string, MusicCollectionConfig> = {};
  let hasAnyCollection = false;

  for (const [name, rawCollection] of Object.entries(rawMusic)) {
    if (typeof rawCollection !== 'object' || rawCollection === null) {
      continue;
    }

    // Validate path is present for directory type
    const collectionType = rawCollection.type ?? 'directory';

    if (collectionType !== 'directory' && collectionType !== 'subsonic') {
      throw new Error(
        `Invalid type "${collectionType}" in [music.${name}]. ` +
          `Valid values: directory, subsonic`
      );
    }

    if (collectionType === 'directory') {
      if (typeof rawCollection.path !== 'string') {
        throw new Error(
          `Missing or invalid "path" in [music.${name}]. ` + `Directory collections require a path.`
        );
      }
      collections[name] = {
        path: rawCollection.path,
        type: 'directory',
      };
    } else {
      // Subsonic collection
      if (typeof rawCollection.url !== 'string') {
        throw new Error(
          `Missing or invalid "url" in [music.${name}]. ` + `Subsonic collections require a url.`
        );
      }
      if (typeof rawCollection.username !== 'string') {
        throw new Error(
          `Missing or invalid "username" in [music.${name}]. ` +
            `Subsonic collections require a username.`
        );
      }
      collections[name] = {
        path: rawCollection.path ?? '', // Optional for subsonic
        type: 'subsonic',
        url: rawCollection.url,
        username: rawCollection.username,
        password: rawCollection.password, // Optional - can also use env var
      };
    }
    hasAnyCollection = true;
  }

  return hasAnyCollection ? collections : undefined;
}

/**
 * Parse video collections from TOML
 *
 * Extracts [video.*] sections into a Record<string, VideoCollectionConfig>.
 */
function parseVideoCollections(
  rawVideo: ConfigFileContent['video']
): Record<string, VideoCollectionConfig> | undefined {
  if (!rawVideo || typeof rawVideo !== 'object') {
    return undefined;
  }

  const collections: Record<string, VideoCollectionConfig> = {};
  let hasAnyCollection = false;

  for (const [name, rawCollection] of Object.entries(rawVideo)) {
    // Skip non-object entries
    if (typeof rawCollection !== 'object' || rawCollection === null) {
      continue;
    }

    const collection = rawCollection as ConfigFileVideoCollection;

    if (typeof collection.path !== 'string') {
      throw new Error(
        `Missing or invalid "path" in [video.${name}]. ` + `Video collections require a path.`
      );
    }

    collections[name] = {
      path: collection.path,
    };
    hasAnyCollection = true;
  }

  return hasAnyCollection ? collections : undefined;
}

/**
 * Parse devices from TOML
 *
 * Extracts [devices.*] sections into a Record<string, DeviceConfig>.
 * Handles nested [devices.*.transforms] sections.
 */
function parseDevices(
  rawDevices: Record<string, ConfigFileDevice> | undefined
): Record<string, DeviceConfig> | undefined {
  if (!rawDevices || typeof rawDevices !== 'object') {
    return undefined;
  }

  const devices: Record<string, DeviceConfig> = {};
  let hasAnyDevice = false;

  for (const [name, rawDevice] of Object.entries(rawDevices)) {
    // Skip non-object entries
    if (typeof rawDevice !== 'object' || rawDevice === null) {
      continue;
    }

    // Validate required fields
    if (typeof rawDevice.volumeUuid !== 'string') {
      throw new Error(
        `Missing or invalid "volumeUuid" in [devices.${name}]. ` +
          `Devices require a volumeUuid for auto-detection.`
      );
    }
    if (typeof rawDevice.volumeName !== 'string') {
      throw new Error(
        `Missing or invalid "volumeName" in [devices.${name}]. ` +
          `Devices require a volumeName for display.`
      );
    }

    const device: DeviceConfig = {
      volumeUuid: rawDevice.volumeUuid.trim(),
      volumeName: rawDevice.volumeName.trim(),
    };

    // Parse optional quality
    if (rawDevice.quality !== undefined) {
      if (typeof rawDevice.quality !== 'string') {
        throw new Error(
          `Invalid type for "quality" in [devices.${name}]. ` +
            `Expected string, got ${typeof rawDevice.quality}.`
        );
      }
      if (!isValidQuality(rawDevice.quality)) {
        throw new Error(
          `Invalid quality value "${rawDevice.quality}" in [devices.${name}]. ` +
            `Valid values: ${QUALITY_PRESETS.join(', ')}`
        );
      }
      device.quality = rawDevice.quality;
    }

    // Parse optional videoQuality
    if (rawDevice.videoQuality !== undefined) {
      if (typeof rawDevice.videoQuality !== 'string') {
        throw new Error(
          `Invalid type for "videoQuality" in [devices.${name}]. ` +
            `Expected string, got ${typeof rawDevice.videoQuality}.`
        );
      }
      if (!isValidVideoQuality(rawDevice.videoQuality)) {
        throw new Error(
          `Invalid videoQuality value "${rawDevice.videoQuality}" in [devices.${name}]. ` +
            `Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`
        );
      }
      device.videoQuality = rawDevice.videoQuality;
    }

    // Parse optional artwork
    if (rawDevice.artwork !== undefined) {
      if (typeof rawDevice.artwork !== 'boolean') {
        throw new Error(
          `Invalid type for "artwork" in [devices.${name}]. ` +
            `Expected boolean, got ${typeof rawDevice.artwork}.`
        );
      }
      device.artwork = rawDevice.artwork;
    }

    // Parse optional transforms
    if (rawDevice.transforms !== undefined) {
      device.transforms = parseTransformsConfig(rawDevice.transforms);
    }

    devices[name] = device;
    hasAnyDevice = true;
  }

  return hasAnyDevice ? devices : undefined;
}

/**
 * Parse defaults section from TOML
 *
 * Extracts [defaults] section into DefaultsConfig.
 */
function parseDefaults(rawDefaults: ConfigFileDefaults | undefined): DefaultsConfig | undefined {
  if (!rawDefaults || typeof rawDefaults !== 'object') {
    return undefined;
  }

  const defaults: DefaultsConfig = {};
  let hasAnyDefault = false;

  if (typeof rawDefaults.music === 'string') {
    defaults.music = rawDefaults.music;
    hasAnyDefault = true;
  }

  if (typeof rawDefaults.video === 'string') {
    defaults.video = rawDefaults.video;
    hasAnyDefault = true;
  }

  if (typeof rawDefaults.device === 'string') {
    defaults.device = rawDefaults.device;
    hasAnyDefault = true;
  }

  return hasAnyDefault ? defaults : undefined;
}

// =============================================================================
/**
 * Validate that default references point to valid collections/devices
 *
 * Logs warnings if defaults reference non-existent items.
 */
function validateDefaultReferences(config: PartialConfig): void {
  const { defaults, music, video, devices } = config;

  if (!defaults) {
    return;
  }

  // Validate defaults.music references a valid music collection
  if (defaults.music !== undefined) {
    if (!music || !(defaults.music in music)) {
      console.warn(
        `Warning: defaults.music="${defaults.music}" references a non-existent music collection. ` +
          `Available collections: ${music ? Object.keys(music).join(', ') : '(none)'}`
      );
    }
  }

  // Validate defaults.video references a valid video collection
  if (defaults.video !== undefined) {
    if (!video || !(defaults.video in video)) {
      console.warn(
        `Warning: defaults.video="${defaults.video}" references a non-existent video collection. ` +
          `Available collections: ${video ? Object.keys(video).join(', ') : '(none)'}`
      );
    }
  }

  // Validate defaults.device references a valid device
  if (defaults.device !== undefined) {
    if (!devices || !(defaults.device in devices)) {
      console.warn(
        `Warning: defaults.device="${defaults.device}" references a non-existent device. ` +
          `Available devices: ${devices ? Object.keys(devices).join(', ') : '(none)'}`
      );
    }
  }
}

/**
 * Read configuration from environment variables
 *
 * Reads PODKIT_QUALITY, PODKIT_FALLBACK, PODKIT_ARTWORK
 */
export function loadEnvConfig(): PartialConfig {
  const config: PartialConfig = {};

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
 *
 * Note: --source is still accepted as a CLI option for sync command
 * but is handled directly by the command, not stored in config.
 */
export function loadCliConfig(
  globalOpts: GlobalOptions,
  commandOpts?: {
    quality?: string;
    fallback?: string;
    artwork?: boolean;
  }
): PartialConfig {
  const config: PartialConfig = {};

  // Command-specific options
  if (commandOpts) {
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
 *
 * For map-based fields (music, video, devices), collections are merged by name
 * rather than replaced entirely. This allows layered configs to add to or
 * override specific collections without losing others.
 */
export function mergeConfigs(...configs: PartialConfig[]): PodkitConfig {
  const merged: PodkitConfig = {
    ...DEFAULT_CONFIG,
    transforms: { ...DEFAULT_CONFIG.transforms },
  };

  for (const config of configs) {
    // Global defaults
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

    // =========================================================================
    // Multi-collection/device fields (ADR-008)
    // Merge by name rather than replace entirely
    // =========================================================================

    // Merge music collections by name
    if (config.music !== undefined) {
      merged.music = {
        ...merged.music,
        ...config.music,
      };
    }

    // Merge video collections by name
    if (config.video !== undefined) {
      merged.video = {
        ...merged.video,
        ...config.video,
      };
    }

    // Merge devices by name, with deep merge for device-specific settings
    if (config.devices !== undefined) {
      if (!merged.devices) {
        merged.devices = {};
      }
      for (const [name, deviceConfig] of Object.entries(config.devices)) {
        const existingDevice = merged.devices[name];
        if (existingDevice) {
          // Deep merge device settings
          merged.devices[name] = {
            ...existingDevice,
            ...deviceConfig,
            // Deep merge transforms if both exist
            transforms: deviceConfig.transforms
              ? {
                  ftintitle: {
                    ...existingDevice.transforms?.ftintitle,
                    ...deviceConfig.transforms.ftintitle,
                  },
                }
              : existingDevice.transforms,
          };
        } else {
          merged.devices[name] = deviceConfig;
        }
      }
    }

    // Merge defaults (simple override, not deep merge)
    if (config.defaults !== undefined) {
      merged.defaults = {
        ...merged.defaults,
        ...config.defaults,
      };
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
