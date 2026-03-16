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
  EncodingMode,
  VideoQualityPreset,
  ConfigFileContent,
  ConfigFileCleanArtists,
  ConfigFileMusicCollection,
  ConfigFileVideoCollection,
  ConfigFileDevice,
  ConfigFileDefaults,
  GlobalOptions,
  CleanArtistsConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
  DefaultsConfig,
} from './types.js';
import {
  QUALITY_PRESETS,
  DEFAULT_CLEAN_ARTISTS_CONFIG,
  VIDEO_QUALITY_PRESETS,
} from './types.js';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, ENV_KEYS } from './defaults.js';

/**
 * Build a quality validation error message.
 */
function qualityError(fieldName: string, value: string, context?: string): string {
  const location = context ? ` in ${context}` : ' in config';
  return (
    `Invalid ${fieldName} value "${value}"${location}. ` +
    `Valid values: ${QUALITY_PRESETS.join(', ')}`
  );
}

/**
 * Check if a string is a valid quality preset
 */
function isValidQuality(value: string): value is QualityPreset {
  return QUALITY_PRESETS.includes(value as QualityPreset);
}

/**
 * Check if a string is a valid encoding mode
 */
function isValidEncodingMode(value: string): value is EncodingMode {
  return value === 'vbr' || value === 'cbr';
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
      throw new Error(qualityError('quality', parsed.quality));
    }
  }

  if (typeof parsed.audioQuality === 'string') {
    if (isValidQuality(parsed.audioQuality)) {
      config.audioQuality = parsed.audioQuality;
    } else {
      throw new Error(qualityError('audioQuality', parsed.audioQuality));
    }
  }

  if (typeof parsed.videoQuality === 'string') {
    if (isValidVideoQuality(parsed.videoQuality)) {
      config.videoQuality = parsed.videoQuality;
    } else {
      throw new Error(
        `Invalid videoQuality value "${parsed.videoQuality}" in config. ` +
          `Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`
      );
    }
  }

  if (typeof parsed.encoding === 'string') {
    if (isValidEncodingMode(parsed.encoding)) {
      config.encoding = parsed.encoding;
    } else {
      throw new Error(
        `Invalid encoding value "${parsed.encoding}" in config. ` +
          `Valid values: vbr, cbr`
      );
    }
  }

  if (parsed.customBitrate !== undefined) {
    if (typeof parsed.customBitrate !== 'number' || !Number.isInteger(parsed.customBitrate) || parsed.customBitrate < 64 || parsed.customBitrate > 320) {
      throw new Error(
        `Invalid customBitrate value "${parsed.customBitrate}" in config. ` +
          `Must be an integer between 64 and 320.`
      );
    }
    config.customBitrate = parsed.customBitrate;
  }

  if (parsed.bitrateTolerance !== undefined) {
    if (typeof parsed.bitrateTolerance !== 'number' || parsed.bitrateTolerance < 0.0 || parsed.bitrateTolerance > 1.0) {
      throw new Error(
        `Invalid bitrateTolerance value "${parsed.bitrateTolerance}" in config. ` +
          `Must be a number between 0.0 and 1.0.`
      );
    }
    config.bitrateTolerance = parsed.bitrateTolerance;
  }

  if (typeof parsed.artwork === 'boolean') {
    config.artwork = parsed.artwork;
  }

  if (typeof parsed.tips === 'boolean') {
    config.tips = parsed.tips;
  }

  if (typeof parsed.skipUpgrades === 'boolean') {
    config.skipUpgrades = parsed.skipUpgrades;
  }

  // Parse cleanArtists (boolean or table)
  if (parsed.cleanArtists !== undefined) {
    config.transforms = {
      cleanArtists: parseCleanArtistsConfig(parsed.cleanArtists),
    };
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
 * Parse and validate cleanArtists config from TOML
 *
 * Accepts either a boolean (simple enable/disable) or a table with options.
 * When provided as a table, enabled defaults to true unless explicitly set to false.
 *
 * @param raw - The raw TOML value for cleanArtists
 * @param context - Config path context for error messages (e.g., "cleanArtists" or "devices.nano.cleanArtists")
 */
function parseCleanArtistsConfig(
  raw: ConfigFileCleanArtists,
  context: string = 'cleanArtists'
): CleanArtistsConfig {
  // Boolean shorthand: cleanArtists = true/false
  if (typeof raw === 'boolean') {
    return {
      ...DEFAULT_CLEAN_ARTISTS_CONFIG,
      enabled: raw,
    };
  }

  // Table form: [cleanArtists] with options — enabled defaults to true
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid type for "${context}". Expected boolean or table, got ${typeof raw}.`);
  }

  const config: CleanArtistsConfig = {
    ...DEFAULT_CLEAN_ARTISTS_CONFIG,
    enabled: true, // Table form implies enabled
  };

  // Validate types and set values
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      throw new Error(
        `Invalid type for "enabled" in [${context}]. ` +
          `Expected boolean, got ${typeof raw.enabled}.`
      );
    }
    config.enabled = raw.enabled;
  }
  if (raw.drop !== undefined) {
    if (typeof raw.drop !== 'boolean') {
      throw new Error(
        `Invalid type for "drop" in [${context}]. ` + `Expected boolean, got ${typeof raw.drop}.`
      );
    }
    config.drop = raw.drop;
  }
  if (raw.format !== undefined) {
    if (typeof raw.format !== 'string') {
      throw new Error(
        `Invalid type for "format" in [${context}]. ` + `Expected string, got ${typeof raw.format}.`
      );
    }
    // Validate format contains placeholder
    if (!raw.format.includes('{}')) {
      throw new Error(
        `Invalid format "${raw.format}" in [${context}]. ` +
          'Format must contain "{}" placeholder for featured artist(s).'
      );
    }
    config.format = raw.format;
  }
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore)) {
      throw new Error(
        `Invalid type for "ignore" in [${context}]. ` +
          `Expected array of strings, got ${typeof raw.ignore}.`
      );
    }
    // Validate each element is a string
    for (const item of raw.ignore) {
      if (typeof item !== 'string') {
        throw new Error(
          `Invalid item in "ignore" array in [${context}]. ` +
            `Expected string, got ${typeof item}.`
        );
      }
    }
    config.ignore = raw.ignore;
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
 * Handles nested [devices.*.cleanArtists] sections.
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
        throw new Error(qualityError('quality', rawDevice.quality, `[devices.${name}]`));
      }
      device.quality = rawDevice.quality;
    }

    // Parse optional audioQuality
    if (rawDevice.audioQuality !== undefined) {
      if (typeof rawDevice.audioQuality !== 'string') {
        throw new Error(
          `Invalid type for "audioQuality" in [devices.${name}]. ` +
            `Expected string, got ${typeof rawDevice.audioQuality}.`
        );
      }
      if (!isValidQuality(rawDevice.audioQuality)) {
        throw new Error(qualityError('audioQuality', rawDevice.audioQuality, `[devices.${name}]`));
      }
      device.audioQuality = rawDevice.audioQuality;
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

    // Parse optional encoding
    if (rawDevice.encoding !== undefined) {
      if (typeof rawDevice.encoding !== 'string') {
        throw new Error(
          `Invalid type for "encoding" in [devices.${name}]. ` +
            `Expected string, got ${typeof rawDevice.encoding}.`
        );
      }
      if (!isValidEncodingMode(rawDevice.encoding)) {
        throw new Error(
          `Invalid encoding value "${rawDevice.encoding}" in [devices.${name}]. ` +
            `Valid values: vbr, cbr`
        );
      }
      device.encoding = rawDevice.encoding;
    }

    // Parse optional customBitrate
    if (rawDevice.customBitrate !== undefined) {
      if (typeof rawDevice.customBitrate !== 'number' || !Number.isInteger(rawDevice.customBitrate) || rawDevice.customBitrate < 64 || rawDevice.customBitrate > 320) {
        throw new Error(
          `Invalid customBitrate value "${rawDevice.customBitrate}" in [devices.${name}]. ` +
            `Must be an integer between 64 and 320.`
        );
      }
      device.customBitrate = rawDevice.customBitrate;
    }

    // Parse optional bitrateTolerance
    if (rawDevice.bitrateTolerance !== undefined) {
      if (typeof rawDevice.bitrateTolerance !== 'number' || rawDevice.bitrateTolerance < 0.0 || rawDevice.bitrateTolerance > 1.0) {
        throw new Error(
          `Invalid bitrateTolerance value "${rawDevice.bitrateTolerance}" in [devices.${name}]. ` +
            `Must be a number between 0.0 and 1.0.`
        );
      }
      device.bitrateTolerance = rawDevice.bitrateTolerance;
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

    // Parse optional skipUpgrades
    if (rawDevice.skipUpgrades !== undefined) {
      if (typeof rawDevice.skipUpgrades !== 'boolean') {
        throw new Error(
          `Invalid type for "skipUpgrades" in [devices.${name}]. ` +
            `Expected boolean, got ${typeof rawDevice.skipUpgrades}.`
        );
      }
      device.skipUpgrades = rawDevice.skipUpgrades;
    }

    // Parse optional cleanArtists (boolean or table)
    if (rawDevice.cleanArtists !== undefined) {
      device.transforms = {
        cleanArtists: parseCleanArtistsConfig(
          rawDevice.cleanArtists,
          `devices.${name}.cleanArtists`
        ),
      };
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
 * Parse a boolean-ish env var value
 */
function parseBoolEnv(value: string): boolean {
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

/**
 * Read configuration from environment variables
 *
 * Reads PODKIT_QUALITY, PODKIT_AUDIO_QUALITY, PODKIT_VIDEO_QUALITY,
 * PODKIT_ENCODING, PODKIT_CUSTOM_BITRATE, PODKIT_BITRATE_TOLERANCE,
 * PODKIT_ARTWORK, and PODKIT_CLEAN_ARTISTS_* vars.
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

  const audioQuality = process.env[ENV_KEYS.audioQuality];
  if (audioQuality !== undefined) {
    if (isValidQuality(audioQuality)) {
      config.audioQuality = audioQuality;
    }
  }

  const videoQuality = process.env[ENV_KEYS.videoQuality];
  if (videoQuality !== undefined) {
    if (isValidVideoQuality(videoQuality)) {
      config.videoQuality = videoQuality;
    }
  }

  const encoding = process.env[ENV_KEYS.encoding];
  if (encoding !== undefined) {
    if (isValidEncodingMode(encoding)) {
      config.encoding = encoding;
    }
  }

  const customBitrate = process.env[ENV_KEYS.customBitrate];
  if (customBitrate !== undefined) {
    const parsed = parseInt(customBitrate, 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed >= 64 && parsed <= 320) {
      config.customBitrate = parsed;
    }
  }

  const bitrateTolerance = process.env[ENV_KEYS.bitrateTolerance];
  if (bitrateTolerance !== undefined) {
    const parsed = parseFloat(bitrateTolerance);
    if (!isNaN(parsed) && parsed >= 0.0 && parsed <= 1.0) {
      config.bitrateTolerance = parsed;
    }
  }

  const forceTranscode = process.env[ENV_KEYS.forceTranscode];
  if (forceTranscode !== undefined) {
    config.forceTranscode = parseBoolEnv(forceTranscode);
  }

  const forceSyncTags = process.env[ENV_KEYS.forceSyncTags];
  if (forceSyncTags !== undefined) {
    config.forceSyncTags = parseBoolEnv(forceSyncTags);
  }

  const artwork = process.env[ENV_KEYS.artwork];
  if (artwork !== undefined) {
    config.artwork = parseBoolEnv(artwork);
  }

  const tips = process.env[ENV_KEYS.tips];
  if (tips !== undefined) {
    config.tips = parseBoolEnv(tips);
  }

  // Clean artists env vars
  const cleanArtists = process.env[ENV_KEYS.cleanArtists];
  const cleanArtistsDrop = process.env[ENV_KEYS.cleanArtistsDrop];
  const cleanArtistsFormat = process.env[ENV_KEYS.cleanArtistsFormat];
  const cleanArtistsIgnore = process.env[ENV_KEYS.cleanArtistsIgnore];

  if (
    cleanArtists !== undefined ||
    cleanArtistsDrop !== undefined ||
    cleanArtistsFormat !== undefined ||
    cleanArtistsIgnore !== undefined
  ) {
    const ca: CleanArtistsConfig = { ...DEFAULT_CLEAN_ARTISTS_CONFIG };

    if (cleanArtists !== undefined) {
      ca.enabled = parseBoolEnv(cleanArtists);
    }
    if (cleanArtistsDrop !== undefined) {
      ca.drop = parseBoolEnv(cleanArtistsDrop);
    }
    if (cleanArtistsFormat !== undefined) {
      ca.format = cleanArtistsFormat;
    }
    if (cleanArtistsIgnore !== undefined) {
      // Comma-separated list, trimmed
      ca.ignore = cleanArtistsIgnore
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    config.transforms = { cleanArtists: ca };
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
    audioQuality?: string;
    videoQuality?: string;
    encoding?: string;
    artwork?: boolean;
    skipUpgrades?: boolean;
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

    if (commandOpts.audioQuality !== undefined) {
      if (isValidQuality(commandOpts.audioQuality)) {
        config.audioQuality = commandOpts.audioQuality;
      }
    }

    if (commandOpts.videoQuality !== undefined) {
      if (isValidVideoQuality(commandOpts.videoQuality)) {
        config.videoQuality = commandOpts.videoQuality;
      }
    }

    if (commandOpts.encoding !== undefined) {
      if (isValidEncodingMode(commandOpts.encoding)) {
        config.encoding = commandOpts.encoding;
      }
    }

    if (commandOpts.artwork !== undefined) {
      config.artwork = commandOpts.artwork;
    }

    if (commandOpts.skipUpgrades !== undefined) {
      config.skipUpgrades = commandOpts.skipUpgrades;
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
    if (config.audioQuality !== undefined) {
      merged.audioQuality = config.audioQuality;
    }
    if (config.videoQuality !== undefined) {
      merged.videoQuality = config.videoQuality;
    }
    if (config.encoding !== undefined) {
      merged.encoding = config.encoding;
    }
    if (config.customBitrate !== undefined) {
      merged.customBitrate = config.customBitrate;
    }
    if (config.bitrateTolerance !== undefined) {
      merged.bitrateTolerance = config.bitrateTolerance;
    }
    if (config.artwork !== undefined) {
      merged.artwork = config.artwork;
    }
    if (config.tips !== undefined) {
      merged.tips = config.tips;
    }
    if (config.skipUpgrades !== undefined) {
      merged.skipUpgrades = config.skipUpgrades;
    }
    if (config.transforms !== undefined) {
      // Deep merge transforms config
      // NOTE: When adding new transforms, update this block to include them
      merged.transforms = {
        cleanArtists: {
          ...merged.transforms.cleanArtists,
          ...config.transforms.cleanArtists,
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
                  cleanArtists: {
                    ...existingDevice.transforms?.cleanArtists,
                    ...deviceConfig.transforms.cleanArtists,
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
    audioQuality?: string;
    videoQuality?: string;
    encoding?: string;
    artwork?: boolean;
    skipUpgrades?: boolean;
  }
): LoadConfigResult {
  const configsToMerge: PartialConfig[] = [];

  // Determine which config file to load
  const configPath = globalOpts.config ?? process.env.PODKIT_CONFIG ?? DEFAULT_CONFIG_PATH;
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
    configPath: configFileExists ? configPath : (globalOpts.config ?? process.env.PODKIT_CONFIG),
    configFileExists,
  };
}
