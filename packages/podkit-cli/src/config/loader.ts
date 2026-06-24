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
  ConfigFileShowLanguage,
  ConfigFileCodecPreference,
  ConfigFileMusicCollection,
  ConfigFileVideoCollection,
  ConfigFileDevice,
  ConfigFileDefaults,
  ConfigFilePresetDefinition,
  GlobalOptions,
  CleanArtistsConfig,
  ShowLanguageConfig,
  CodecPreferenceConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
  DefaultsConfig,
  AudioCodec,
  AudioNormalizationMode,
  DeviceArtworkSource,
  TranscodeTargetCodec,
} from './types.js';
import {
  QUALITY_PRESETS,
  DEFAULT_CLEAN_ARTISTS_CONFIG,
  DEFAULT_SHOW_LANGUAGE_CONFIG,
  VIDEO_QUALITY_PRESETS,
  TRANSFER_MODES,
  isValidTransferMode,
  DEVICE_TYPES,
  AUDIO_CODECS,
  ARTWORK_SOURCES,
  CODEC_METADATA,
} from './types.js';
import type { ReadinessUnsupportedReason } from '@podkit/device-types';

/** Valid `ReadinessUnsupportedReason['kind']` values (kept in sync with the union). */
const READINESS_UNSUPPORTED_KINDS: ReadinessUnsupportedReason['kind'][] = [
  'filesystem-unsupported-on-linux',
  'unsupported-device',
  'unsupported-preset',
  'ios-device',
];
import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, ENV_KEYS } from './defaults.js';
import { readConfigVersion, checkConfigVersion } from './version.js';
import { normalizeContentPaths, validateContentPaths } from '@podkit/core';
import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_IDS,
  MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS,
  definePreset,
} from '@podkit/devices-mass-storage';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';
import type { DeviceCapabilities } from '@podkit/device-types';

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
 * Validate a music path template. Required variables: {title} and {ext}.
 * Throws with a context-tagged message if invalid.
 */
function validatePathTemplate(template: string, context: string): void {
  if (template.trim() === '') {
    throw new Error(`Invalid pathTemplate in ${context}: must not be empty.`);
  }
  if (!/\{title\}/.test(template)) {
    throw new Error(`Invalid pathTemplate in ${context}: must contain {title}.`);
  }
  if (!/\{ext\}/.test(template)) {
    throw new Error(`Invalid pathTemplate in ${context}: must contain {ext}.`);
  }
}

// =============================================================================
// Shared TOML scalar/enum parse helpers
// =============================================================================
//
// These collapse the repeated "type-check the raw value → validate against an
// enum/range → throw a context-tagged error → assign" pattern that appears at
// both top-level config parsing and per-device parsing. Each helper reproduces
// the existing error strings exactly; the only behavioural knob is whether a
// wrong *type* is a hard error (per-device blocks) or a silent skip (top-level
// blocks, which historically only throw on an out-of-enum string).

/**
 * Validate a raw value against a string enum and assign it.
 *
 * Reproduces the canonical two-message shape:
 *  - type error : `Invalid type for "${field}" in ${context}. Expected string, got ${typeof}.`
 *  - value error: `Invalid ${label ?? field} value "${value}" in ${context}. Valid values: ${valid.join(', ')}`
 *
 * `context` is the full context tag as it appears in the message (e.g.
 * `config` or `[devices.foo]`). When `throwOnWrongType` is false a non-string
 * raw value is silently skipped (the top-level blocks' historical behaviour);
 * when true a non-string raw value throws the type error (per-device blocks).
 */
function parseStringEnum<T extends string>(args: {
  raw: unknown;
  field: string;
  context: string;
  valid: readonly T[];
  assign: (value: T) => void;
  label?: string;
  throwOnWrongType?: boolean;
}): void {
  const { raw, field, context, valid, assign, label, throwOnWrongType } = args;
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== 'string') {
    if (throwOnWrongType) {
      throw new Error(
        `Invalid type for "${field}" in ${context}. ` + `Expected string, got ${typeof raw}.`
      );
    }
    return;
  }
  if (!(valid as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid ${label ?? field} value "${raw}" in ${context}. ` +
        `Valid values: ${valid.join(', ')}`
    );
  }
  assign(raw as T);
}

/**
 * Validate a raw value against an integer range and assign it.
 *
 * Reproduces: `Invalid ${field} value "${value}" in ${context}. ${rangeText}`
 * The exact `rangeText` (e.g. `Must be an integer between 64 and 320.`) is
 * supplied per call so each site keeps its original wording.
 */
function parseIntegerInRange(args: {
  raw: unknown;
  field: string;
  context: string;
  min: number;
  max: number;
  rangeText: string;
  assign: (value: number) => void;
}): void {
  const { raw, field, context, min, max, rangeText, assign } = args;
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`Invalid ${field} value "${String(raw)}" in ${context}. ` + rangeText);
  }
  assign(raw);
}

/**
 * Validate a raw value against an inclusive numeric range and assign it.
 *
 * Reproduces: `Invalid ${field} value "${value}" in ${context}. ${rangeText}`
 * Unlike {@link parseIntegerInRange} this does not require an integer.
 */
function parseNumberInRange(args: {
  raw: unknown;
  field: string;
  context: string;
  min: number;
  max: number;
  rangeText: string;
  assign: (value: number) => void;
}): void {
  const { raw, field, context, min, max, rangeText, assign } = args;
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== 'number' || raw < min || raw > max) {
    throw new Error(`Invalid ${field} value "${String(raw)}" in ${context}. ` + rangeText);
  }
  assign(raw);
}

/**
 * Validate a raw value as a boolean and assign it.
 *
 * Reproduces: `Invalid type for "${field}" in ${context}. Expected boolean, got ${typeof}.`
 * When `throwOnWrongType` is false a non-boolean raw value is silently skipped
 * (the top-level blocks' `typeof === 'boolean'` guard); when true a non-boolean
 * raw value throws (per-device blocks).
 */
function parseBoolean(args: {
  raw: unknown;
  field: string;
  context: string;
  assign: (value: boolean) => void;
  throwOnWrongType?: boolean;
}): void {
  const { raw, field, context, assign, throwOnWrongType } = args;
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== 'boolean') {
    if (throwOnWrongType) {
      throw new Error(
        `Invalid type for "${field}" in ${context}. ` + `Expected boolean, got ${typeof raw}.`
      );
    }
    return;
  }
  assign(raw);
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

  // Check config version before full parsing — version check works even
  // when config structure is incompatible with current types
  const version = readConfigVersion(content);
  const versionError = checkConfigVersion(version);
  if (versionError) {
    throw new Error(versionError);
  }

  const parsed = parseTOML(content) as ConfigFileContent;

  const config: PartialConfig = {};

  parseStringEnum({
    raw: parsed.quality,
    field: 'quality',
    context: 'config',
    valid: QUALITY_PRESETS,
    assign: (v) => {
      config.quality = v;
    },
  });

  parseStringEnum({
    raw: parsed.audioQuality,
    field: 'audioQuality',
    context: 'config',
    valid: QUALITY_PRESETS,
    assign: (v) => {
      config.audioQuality = v;
    },
  });

  parseStringEnum({
    raw: parsed.videoQuality,
    field: 'videoQuality',
    context: 'config',
    valid: VIDEO_QUALITY_PRESETS,
    assign: (v) => {
      config.videoQuality = v;
    },
  });

  parseStringEnum({
    raw: parsed.encoding,
    field: 'encoding',
    context: 'config',
    valid: ['vbr', 'cbr'] as const,
    assign: (v) => {
      config.encoding = v;
    },
  });

  parseIntegerInRange({
    raw: parsed.customBitrate,
    field: 'customBitrate',
    context: 'config',
    min: 64,
    max: 320,
    rangeText: 'Must be an integer between 64 and 320.',
    assign: (v) => {
      config.customBitrate = v;
    },
  });

  parseNumberInRange({
    raw: parsed.bitrateTolerance,
    field: 'bitrateTolerance',
    context: 'config',
    min: 0.0,
    max: 1.0,
    rangeText: 'Must be a number between 0.0 and 1.0.',
    assign: (v) => {
      config.bitrateTolerance = v;
    },
  });

  parseBoolean({
    raw: parsed.artwork,
    field: 'artwork',
    context: 'config',
    assign: (v) => {
      config.artwork = v;
    },
  });

  parseBoolean({
    raw: parsed.tips,
    field: 'tips',
    context: 'config',
    assign: (v) => {
      config.tips = v;
    },
  });

  parseBoolean({
    raw: parsed.checkArtwork,
    field: 'checkArtwork',
    context: 'config',
    assign: (v) => {
      config.checkArtwork = v;
    },
  });

  parseStringEnum({
    raw: parsed.transferMode,
    field: 'transferMode',
    context: 'config',
    valid: TRANSFER_MODES,
    assign: (v) => {
      config.transferMode = v;
    },
  });

  parseBoolean({
    raw: parsed.skipUpgrades,
    field: 'skipUpgrades',
    context: 'config',
    assign: (v) => {
      config.skipUpgrades = v;
    },
  });

  parseBoolean({
    raw: parsed.allowEmptyPlaylist,
    field: 'allowEmptyPlaylist',
    context: 'config',
    assign: (v) => {
      config.allowEmptyPlaylist = v;
    },
  });

  // Parse cleanArtists (boolean or table)
  if (parsed.cleanArtists !== undefined) {
    config.transforms = {
      cleanArtists: parseCleanArtistsConfig(parsed.cleanArtists),
    };
  }

  // Parse showLanguage (boolean or table)
  if (parsed.showLanguage !== undefined) {
    config.videoTransforms = {
      showLanguage: parseShowLanguageConfig(parsed.showLanguage),
    };
  }

  // Parse codec preferences [codec]
  if (parsed.codec !== undefined) {
    const codecConfig = parseCodecPreference(parsed.codec, 'codec');
    if (codecConfig) {
      config.codec = codecConfig;
    }
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

  // Parse user-defined mass-storage presets [presets.*] BEFORE devices,
  // so per-device `type` references can resolve against the merged
  // (built-in ∪ user) registry once it's wired into device-open paths.
  const presets = parsePresets(parsed.presets);
  if (presets) {
    config.presets = presets;
  }

  // Parse devices [devices.*] — pass user presets so per-device content-path
  // validation can resolve via the merged registry.
  const devices = parseDevices(parsed.devices, presets);
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

/**
 * Parse and validate showLanguage config from TOML
 *
 * Accepts either a boolean (simple enable/disable) or a table with options.
 * When provided as a table, enabled defaults to true unless explicitly set to false.
 *
 * @param raw - The raw TOML value for showLanguage
 * @param context - Config path context for error messages (e.g., "showLanguage" or "devices.nano.showLanguage")
 */
function parseShowLanguageConfig(
  raw: ConfigFileShowLanguage,
  context: string = 'showLanguage'
): ShowLanguageConfig {
  // Boolean shorthand: showLanguage = true/false
  if (typeof raw === 'boolean') {
    return {
      ...DEFAULT_SHOW_LANGUAGE_CONFIG,
      enabled: raw,
    };
  }

  // Table form: [showLanguage] with options — enabled defaults to true
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid type for "${context}". Expected boolean or table, got ${typeof raw}.`);
  }

  const config: ShowLanguageConfig = {
    ...DEFAULT_SHOW_LANGUAGE_CONFIG,
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
          'Format must contain "{}" placeholder for language code.'
      );
    }
    config.format = raw.format;
  }
  if (raw.expand !== undefined) {
    if (typeof raw.expand !== 'boolean') {
      throw new Error(
        `Invalid type for "expand" in [${context}]. ` +
          `Expected boolean, got ${typeof raw.expand}.`
      );
    }
    config.expand = raw.expand;
  }

  return config;
}

// =============================================================================
// Codec Preference Parsing
// =============================================================================

/** All valid TranscodeTargetCodec identifiers */
const TRANSCODE_TARGET_CODECS = Object.keys(CODEC_METADATA) as TranscodeTargetCodec[];

/**
 * Parse and validate codec preference config from TOML
 *
 * Normalizes single string values to arrays and validates all codec names.
 *
 * @param raw - The raw TOML value for codec preference
 * @param context - Config path context for error messages (e.g., "codec" or "devices.nano.codec")
 */
function parseCodecPreference(
  raw: ConfigFileCodecPreference,
  context: string
): CodecPreferenceConfig | undefined {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid type for [${context}]. Expected table, got ${typeof raw}.`);
  }

  const config: CodecPreferenceConfig = {};
  let hasAny = false;

  // Parse lossy preference
  if (raw.lossy !== undefined) {
    const lossy = normalizeCodecList(raw.lossy, `${context}.lossy`, TRANSCODE_TARGET_CODECS);
    config.lossy = lossy as TranscodeTargetCodec[];
    hasAny = true;
  }

  // Parse lossless preference (allows 'source' as a special value)
  if (raw.lossless !== undefined) {
    const validValues = [...TRANSCODE_TARGET_CODECS, 'source'] as string[];
    const lossless = normalizeCodecList(raw.lossless, `${context}.lossless`, validValues);
    config.lossless = lossless as (TranscodeTargetCodec | 'source')[];
    hasAny = true;
  }

  return hasAny ? config : undefined;
}

/**
 * Normalize a codec list value: single string → array, then validate all entries.
 *
 * @param value - The raw value (string or string[])
 * @param context - Config path for error messages
 * @param validValues - Set of valid codec identifiers
 * @returns Normalized array of validated codec names
 */
function normalizeCodecList(
  value: string | string[],
  context: string,
  validValues: string[]
): string[] {
  // Normalize single string to array
  const list = typeof value === 'string' ? [value] : value;

  if (!Array.isArray(list)) {
    throw new Error(
      `Invalid type for "${context}". Expected string or array of strings, got ${typeof value}.`
    );
  }

  if (list.length === 0) {
    throw new Error(`Empty codec list for "${context}". Must contain at least one value.`);
  }

  for (const item of list) {
    if (typeof item !== 'string') {
      throw new Error(`Invalid item in "${context}". Expected string, got ${typeof item}.`);
    }
    if (!validValues.includes(item)) {
      throw new Error(
        `Invalid codec "${item}" in ${context}. Valid values: ${validValues.join(', ')}`
      );
    }
  }

  return list;
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

    // `playlist` is a subsonic-only constraint. Reject it on a directory
    // collection at parse time rather than silently ignoring it.
    if (rawCollection.playlist !== undefined && collectionType !== 'subsonic') {
      throw new Error(
        `"playlist" is only valid for subsonic collections, but [music.${name}] is a directory collection. ` +
          `Remove "playlist" or set type = "subsonic".`
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
      if (rawCollection.playlist !== undefined) {
        if (typeof rawCollection.playlist !== 'string' || rawCollection.playlist.trim() === '') {
          throw new Error(
            `Invalid "playlist" in [music.${name}]: must be a non-empty playlist name.`
          );
        }
      }
      collections[name] = {
        path: rawCollection.path ?? '', // Optional for subsonic
        type: 'subsonic',
        url: rawCollection.url,
        username: rawCollection.username,
        password: rawCollection.password, // Optional - can also use env var
        playlist: rawCollection.playlist, // Optional - subsonic-only scope
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
/**
 * Validated capability-override and content-path fields shared between
 * `parseDevices` and `parsePresets`. Each field is present iff the raw
 * source had a value for it; absence means "inherit from baseline".
 */
interface ParsedCapabilityFields {
  artworkMaxResolution?: number;
  artworkSources?: DeviceArtworkSource[];
  supportedAudioCodecs?: AudioCodec[];
  supportsVideo?: boolean;
  audioNormalization?: AudioNormalizationMode;
  supportsAlbumArtistBrowsing?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
}

/** Raw shape passed to the shared validator. Fields are `unknown` so the
 * validator can produce friendly type errors instead of TypeScript-only
 * compile errors when the source is a TOML blob. */
interface RawCapabilityFields {
  artworkMaxResolution?: unknown;
  artworkSources?: unknown;
  supportedAudioCodecs?: unknown;
  supportsVideo?: unknown;
  audioNormalization?: unknown;
  supportsAlbumArtistBrowsing?: unknown;
  musicDir?: unknown;
  moviesDir?: unknown;
  tvShowsDir?: unknown;
}

/**
 * Validate capability-override + content-path fields against the canonical
 * enum lists and numeric ranges. Throws with the `context` label (e.g.
 * `[devices.echo]` or `[presets.my-walkman]`) on the first invalid field.
 *
 * Returns a structurally-typed object that callers can spread or pick
 * fields off; absent fields are omitted (not `undefined`-valued) so
 * `Object.assign` and `...spread` produce clean targets.
 *
 * The wav/aiff console.warn fires when `emitUnsupportedCodecWarning` is
 * true and the raw `supportedAudioCodecs` list contains entries in
 * `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`. Per-device override callers
 * set this conditional on `type !== 'ipod'`; preset-definition callers
 * always set it true (presets only describe mass-storage devices).
 */
function parseCapabilityFields(
  raw: RawCapabilityFields,
  context: string,
  emitUnsupportedCodecWarning: boolean
): ParsedCapabilityFields {
  const out: ParsedCapabilityFields = {};

  if (raw.artworkMaxResolution !== undefined) {
    if (
      typeof raw.artworkMaxResolution !== 'number' ||
      !Number.isInteger(raw.artworkMaxResolution) ||
      raw.artworkMaxResolution < 1 ||
      raw.artworkMaxResolution > 10000
    ) {
      throw new Error(
        `Invalid artworkMaxResolution value "${String(raw.artworkMaxResolution)}" in ${context}. ` +
          `Must be a positive integer between 1 and 10000.`
      );
    }
    out.artworkMaxResolution = raw.artworkMaxResolution;
  }

  if (raw.artworkSources !== undefined) {
    if (!Array.isArray(raw.artworkSources)) {
      throw new Error(
        `Invalid type for "artworkSources" in ${context}. ` +
          `Expected array, got ${typeof raw.artworkSources}.`
      );
    }
    if (raw.artworkSources.length === 0) {
      throw new Error(`Empty artworkSources array in ${context}. Must contain at least one value.`);
    }
    for (const source of raw.artworkSources) {
      if (typeof source !== 'string' || !ARTWORK_SOURCES.includes(source as DeviceArtworkSource)) {
        throw new Error(
          `Invalid artwork source "${String(source)}" in ${context}. ` +
            `Valid values: ${ARTWORK_SOURCES.join(', ')}`
        );
      }
    }
    out.artworkSources = raw.artworkSources as DeviceArtworkSource[];
  }

  if (raw.supportedAudioCodecs !== undefined) {
    if (!Array.isArray(raw.supportedAudioCodecs)) {
      throw new Error(
        `Invalid type for "supportedAudioCodecs" in ${context}. ` +
          `Expected array, got ${typeof raw.supportedAudioCodecs}.`
      );
    }
    if (raw.supportedAudioCodecs.length === 0) {
      throw new Error(
        `Empty supportedAudioCodecs array in ${context}. Must contain at least one value.`
      );
    }
    for (const codec of raw.supportedAudioCodecs) {
      if (typeof codec !== 'string' || !AUDIO_CODECS.includes(codec as AudioCodec)) {
        throw new Error(
          `Invalid audio codec "${String(codec)}" in ${context}. ` +
            `Valid values: ${AUDIO_CODECS.join(', ')}`
        );
      }
    }
    out.supportedAudioCodecs = raw.supportedAudioCodecs as AudioCodec[];

    if (emitUnsupportedCodecWarning) {
      const unsupported = (raw.supportedAudioCodecs as string[]).filter((c) =>
        MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS.includes(c)
      );
      if (unsupported.length > 0) {
        console.warn(
          `Warning: ${context} declares supportedAudioCodecs [${unsupported
            .map((c) => `"${c}"`)
            .join(', ')}] that podkit cannot use as device-output on mass-storage. ` +
            `Sources in these formats will be transcoded to a managed codec (e.g. AAC/FLAC/ALAC) before transfer.`
        );
      }
    }
  }

  if (raw.supportsVideo !== undefined) {
    if (typeof raw.supportsVideo !== 'boolean') {
      throw new Error(
        `Invalid type for "supportsVideo" in ${context}. ` +
          `Expected boolean, got ${typeof raw.supportsVideo}.`
      );
    }
    out.supportsVideo = raw.supportsVideo;
  }

  if (raw.audioNormalization !== undefined) {
    const valid: AudioNormalizationMode[] = ['soundcheck', 'replaygain', 'none'];
    if (
      typeof raw.audioNormalization !== 'string' ||
      !(valid as string[]).includes(raw.audioNormalization)
    ) {
      throw new Error(
        `Invalid audioNormalization value "${String(raw.audioNormalization)}" in ${context}. ` +
          `Must be one of: ${valid.join(', ')}.`
      );
    }
    out.audioNormalization = raw.audioNormalization as AudioNormalizationMode;
  }

  if (raw.supportsAlbumArtistBrowsing !== undefined) {
    if (typeof raw.supportsAlbumArtistBrowsing !== 'boolean') {
      throw new Error(
        `Invalid type for "supportsAlbumArtistBrowsing" in ${context}. ` +
          `Expected boolean, got ${typeof raw.supportsAlbumArtistBrowsing}.`
      );
    }
    out.supportsAlbumArtistBrowsing = raw.supportsAlbumArtistBrowsing;
  }

  if (raw.musicDir !== undefined) {
    if (typeof raw.musicDir !== 'string') {
      throw new Error(`Invalid musicDir value in ${context}. Must be a string.`);
    }
    out.musicDir = raw.musicDir;
  }
  if (raw.moviesDir !== undefined) {
    if (typeof raw.moviesDir !== 'string') {
      throw new Error(`Invalid moviesDir value in ${context}. Must be a string.`);
    }
    out.moviesDir = raw.moviesDir;
  }
  if (raw.tvShowsDir !== undefined) {
    if (typeof raw.tvShowsDir !== 'string') {
      throw new Error(`Invalid tvShowsDir value in ${context}. Must be a string.`);
    }
    out.tvShowsDir = raw.tvShowsDir;
  }

  return out;
}

function parseDevices(
  rawDevices: Record<string, ConfigFileDevice> | undefined,
  userPresets?: Record<string, MassStoragePreset>
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

    const device: DeviceConfig = {};

    // Parse optional volumeUuid (required only for auto-detection)
    if (typeof rawDevice.volumeUuid === 'string') {
      device.volumeUuid = rawDevice.volumeUuid.trim();
    }

    // Parse optional volumeName (for display)
    if (typeof rawDevice.volumeName === 'string') {
      device.volumeName = rawDevice.volumeName.trim();
    }

    // Parse optional device type
    parseStringEnum({
      raw: rawDevice.type,
      field: 'type',
      label: 'device type',
      context: `[devices.${name}]`,
      valid: DEVICE_TYPES,
      throwOnWrongType: true,
      assign: (v) => {
        device.type = v;
      },
    });

    // Parse optional path (mount point for mass-storage devices)
    if (rawDevice.path !== undefined) {
      if (typeof rawDevice.path !== 'string') {
        throw new Error(
          `Invalid type for "path" in [devices.${name}]. ` +
            `Expected string, got ${typeof rawDevice.path}.`
        );
      }
      device.path = rawDevice.path.trim();
    }

    // Parse optional `unsupported` object — records the user's explicit
    // "add this device anyway" choice from `podkit device add` on a
    // generation podkit does not officially support. See TASK-317.03.
    //
    // Expected TOML shape (inline table):
    //   unsupported = { kind = "ios-device", confirmedAt = "2026-05-16T11:30:00.000Z" }
    //
    // Legacy boolean `true` (from before this richer shape existed) is silently
    // coerced to `{ kind: 'unsupported-device', confirmedAt: <epoch> }`.
    if (rawDevice.unsupported !== undefined) {
      if (typeof rawDevice.unsupported === 'boolean') {
        if (rawDevice.unsupported) {
          // Backwards-compat coercion: old `unsupported = true` → rich shape
          device.unsupported = {
            kind: 'unsupported-device',
            confirmedAt: new Date(0).toISOString(),
          };
        }
        // `unsupported = false` → leave unset (no-op)
      } else if (typeof rawDevice.unsupported === 'object' && rawDevice.unsupported !== null) {
        const raw = rawDevice.unsupported;

        // Validate `kind`
        if (!raw.kind || typeof raw.kind !== 'string') {
          throw new Error(
            `Invalid "unsupported.kind" in [devices.${name}]. ` +
              `Expected a string kind value, got ${JSON.stringify(raw.kind)}.`
          );
        }
        if (!(READINESS_UNSUPPORTED_KINDS as string[]).includes(raw.kind)) {
          throw new Error(
            `Invalid "unsupported.kind" value "${raw.kind}" in [devices.${name}]. ` +
              `Valid values: ${READINESS_UNSUPPORTED_KINDS.join(', ')}`
          );
        }

        // Validate `confirmedAt` as ISO 8601
        if (!raw.confirmedAt || typeof raw.confirmedAt !== 'string') {
          throw new Error(
            `Invalid "unsupported.confirmedAt" in [devices.${name}]. ` +
              `Expected an ISO 8601 timestamp string.`
          );
        }
        const parsed = new Date(raw.confirmedAt);
        if (isNaN(parsed.getTime()) || parsed.toISOString() !== raw.confirmedAt) {
          throw new Error(
            `Invalid "unsupported.confirmedAt" value "${raw.confirmedAt}" in [devices.${name}]. ` +
              `Must be a valid ISO 8601 timestamp (e.g. "2026-05-16T11:30:00.000Z").`
          );
        }

        device.unsupported = {
          kind: raw.kind as ReadinessUnsupportedReason['kind'],
          confirmedAt: raw.confirmedAt,
        };
      } else {
        throw new Error(
          `Invalid type for "unsupported" in [devices.${name}]. ` +
            `Expected an inline table { kind, confirmedAt }, got ${typeof rawDevice.unsupported}.`
        );
      }
    }

    // Parse optional quality
    parseStringEnum({
      raw: rawDevice.quality,
      field: 'quality',
      context: `[devices.${name}]`,
      valid: QUALITY_PRESETS,
      throwOnWrongType: true,
      assign: (v) => {
        device.quality = v;
      },
    });

    // Parse optional audioQuality
    parseStringEnum({
      raw: rawDevice.audioQuality,
      field: 'audioQuality',
      context: `[devices.${name}]`,
      valid: QUALITY_PRESETS,
      throwOnWrongType: true,
      assign: (v) => {
        device.audioQuality = v;
      },
    });

    // Parse optional videoQuality
    parseStringEnum({
      raw: rawDevice.videoQuality,
      field: 'videoQuality',
      context: `[devices.${name}]`,
      valid: VIDEO_QUALITY_PRESETS,
      throwOnWrongType: true,
      assign: (v) => {
        device.videoQuality = v;
      },
    });

    // Parse optional encoding
    parseStringEnum({
      raw: rawDevice.encoding,
      field: 'encoding',
      context: `[devices.${name}]`,
      valid: ['vbr', 'cbr'] as const,
      throwOnWrongType: true,
      assign: (v) => {
        device.encoding = v;
      },
    });

    // Parse optional customBitrate
    parseIntegerInRange({
      raw: rawDevice.customBitrate,
      field: 'customBitrate',
      context: `[devices.${name}]`,
      min: 64,
      max: 320,
      rangeText: 'Must be an integer between 64 and 320.',
      assign: (v) => {
        device.customBitrate = v;
      },
    });

    // Parse optional bitrateTolerance
    parseNumberInRange({
      raw: rawDevice.bitrateTolerance,
      field: 'bitrateTolerance',
      context: `[devices.${name}]`,
      min: 0.0,
      max: 1.0,
      rangeText: 'Must be a number between 0.0 and 1.0.',
      assign: (v) => {
        device.bitrateTolerance = v;
      },
    });

    // Parse optional artwork
    parseBoolean({
      raw: rawDevice.artwork,
      field: 'artwork',
      context: `[devices.${name}]`,
      throwOnWrongType: true,
      assign: (v) => {
        device.artwork = v;
      },
    });

    // Parse optional checkArtwork
    parseBoolean({
      raw: rawDevice.checkArtwork,
      field: 'checkArtwork',
      context: `[devices.${name}]`,
      throwOnWrongType: true,
      assign: (v) => {
        device.checkArtwork = v;
      },
    });

    // Parse optional transferMode
    parseStringEnum({
      raw: rawDevice.transferMode,
      field: 'transferMode',
      context: `[devices.${name}]`,
      valid: TRANSFER_MODES,
      throwOnWrongType: true,
      assign: (v) => {
        device.transferMode = v;
      },
    });

    // Parse optional skipUpgrades
    parseBoolean({
      raw: rawDevice.skipUpgrades,
      field: 'skipUpgrades',
      context: `[devices.${name}]`,
      throwOnWrongType: true,
      assign: (v) => {
        device.skipUpgrades = v;
      },
    });

    // Parse optional codec preferences
    if (rawDevice.codec !== undefined) {
      const codecConfig = parseCodecPreference(rawDevice.codec, `devices.${name}.codec`);
      if (codecConfig) {
        device.codec = codecConfig;
      }
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

    // Parse optional showLanguage (boolean or table)
    if (rawDevice.showLanguage !== undefined) {
      device.videoTransforms = {
        showLanguage: parseShowLanguageConfig(
          rawDevice.showLanguage,
          `devices.${name}.showLanguage`
        ),
      };
    }

    // Parse capability + content-path overrides via the shared validator.
    // iPod is exempt from the wav/aiff warning — libgpod handles those
    // codecs natively.
    const isMassStorage = device.type !== undefined && device.type !== 'ipod';
    const parsedCaps = parseCapabilityFields(rawDevice, `[devices.${name}]`, isMassStorage);
    Object.assign(device, parsedCaps);

    // Parse optional pathTemplate
    if (rawDevice.pathTemplate !== undefined) {
      if (typeof rawDevice.pathTemplate !== 'string') {
        throw new Error(`Invalid pathTemplate value in [devices.${name}]. ` + `Must be a string.`);
      }
      validatePathTemplate(rawDevice.pathTemplate, `[devices.${name}]`);
      device.pathTemplate = rawDevice.pathTemplate;
    }

    // Parse optional manufacturer + productName (display label overrides
    // — most useful with the `generic` and `rockbox` presets so a no-name
    // device can carry a friendly label like "AliExpress USB MP3 player").
    if (rawDevice.manufacturer !== undefined) {
      if (typeof rawDevice.manufacturer !== 'string') {
        throw new Error(`Invalid manufacturer value in [devices.${name}]. ` + `Must be a string.`);
      }
      device.manufacturer = rawDevice.manufacturer;
    }
    if (rawDevice.productName !== undefined) {
      if (typeof rawDevice.productName !== 'string') {
        throw new Error(`Invalid productName value in [devices.${name}]. ` + `Must be a string.`);
      }
      device.productName = rawDevice.productName;
    }

    // Validate: capability overrides and musicDir are only valid for mass-storage devices
    const isIpodDevice = !device.type || device.type === 'ipod';
    if (isIpodDevice) {
      const massStorageFields = [
        'artworkMaxResolution',
        'artworkSources',
        'supportedAudioCodecs',
        'supportsVideo',
        'audioNormalization',
        'supportsAlbumArtistBrowsing',
        'musicDir',
        'moviesDir',
        'tvShowsDir',
        'pathTemplate',
        'manufacturer',
        'productName',
      ] as const;
      const presentFields = massStorageFields.filter((f) => device[f] !== undefined);
      if (presentFields.length > 0) {
        throw new Error(
          `Mass-storage settings (${presentFields.join(', ')}) in [devices.${name}] ` +
            `are only valid for mass-storage devices (type must be set to a non-iPod device type). ` +
            `iPod capabilities and display labels are determined automatically from the device's generation and libgpod model name.`
        );
      }
    }

    // Validate content paths for mass-storage devices (check for duplicates)
    if (!isIpodDevice) {
      const hasAnyContentPath =
        device.musicDir !== undefined ||
        device.moviesDir !== undefined ||
        device.tvShowsDir !== undefined;
      if (hasAnyContentPath) {
        const presetId = device.type as string;
        const mergedRegistry: Record<string, MassStoragePreset> = {
          ...userPresets,
          ...BUILT_IN_PRESETS,
        };
        const preset = mergedRegistry[presetId] ?? BUILT_IN_PRESETS['generic'];
        const presetDefaults = preset?.contentPaths;
        const resolved = normalizeContentPaths(
          {
            musicDir: device.musicDir,
            moviesDir: device.moviesDir,
            tvShowsDir: device.tvShowsDir,
          },
          presetDefaults
        );
        try {
          validateContentPaths(resolved);
        } catch (err) {
          throw new Error(`Invalid content paths in [devices.${name}]: ${(err as Error).message}`);
        }
      }

      // Warn if video dirs are set on a device with supportsVideo: false
      if (device.supportsVideo === false) {
        if (device.moviesDir !== undefined) {
          console.warn(
            `Warning: moviesDir is set in [devices.${name}] but supportsVideo is false.`
          );
        }
        if (device.tvShowsDir !== undefined) {
          console.warn(
            `Warning: tvShowsDir is set in [devices.${name}] but supportsVideo is false.`
          );
        }
      }
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

/**
 * Parse user-defined mass-storage presets from `[presets.<id>]` blocks.
 *
 * Resolution order: built-in ids are reserved (`echo-mini`, `rockbox`,
 * `generic`) — declaring `[presets.echo-mini]` is a hard error so the
 * built-in stays authoritative. `[presets.ipod]` is also refused because
 * `ipod` is the iPod provider id, not a mass-storage preset.
 *
 * `extends` may reference a built-in preset or another user preset declared
 * earlier in this file. Cross-user `extends` is resolved via Kahn's
 * topological sort over the extends graph: each pass adds presets whose
 * `extends` is already a built-in or already resolved. A pass that adds
 * nothing while presets remain means an unresolved id or a cycle.
 *
 * Capability-field validation (codec names, artwork sources,
 * normalization mode, numeric ranges) mirrors `parseDevices` exactly. The
 * `wav/aiff in supportedAudioCodecs` warning fires at preset-definition
 * time so users see it once per preset, not once per device.
 */
function parsePresets(
  rawPresets: Record<string, ConfigFilePresetDefinition> | undefined
): Record<string, MassStoragePreset> | undefined {
  if (!rawPresets || typeof rawPresets !== 'object') {
    return undefined;
  }

  // Per-preset validation + flat → nested capabilities mapping. The
  // resulting `flat` map preserves insertion order so later topo-sort
  // errors quote a stable preset name.
  type FlatPreset = {
    id: string;
    extendsId?: string;
    manufacturer?: string;
    productName?: string;
    capabilities: Partial<DeviceCapabilities>;
    contentPaths: Partial<{ musicDir: string; moviesDir: string; tvShowsDir: string }>;
  };
  const flat = new Map<string, FlatPreset>();
  const builtInIds = new Set<string>(BUILT_IN_PRESET_IDS);

  for (const [id, raw] of Object.entries(rawPresets)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    if (id.trim() === '') {
      throw new Error(`Invalid empty preset id in [presets.""].`);
    }
    if (builtInIds.has(id)) {
      throw new Error(
        `[presets.${id}] collides with a built-in preset id. ` +
          `Built-in presets (${BUILT_IN_PRESET_IDS.join(', ')}) are authoritative; ` +
          `rename your preset (e.g. [presets.my-${id}]) and use \`extends = "${id}"\` to inherit from it.`
      );
    }
    if (id === 'ipod') {
      throw new Error(
        `[presets.ipod] is not allowed: \`ipod\` is the iPod provider id, not a mass-storage preset. ` +
          `Rename your preset (e.g. [presets.my-ipod]).`
      );
    }

    const flatEntry: FlatPreset = {
      id,
      capabilities: {},
      contentPaths: {},
    };

    if (raw.extends !== undefined) {
      if (typeof raw.extends !== 'string' || raw.extends.trim() === '') {
        throw new Error(
          `Invalid "extends" in [presets.${id}]. Expected a non-empty string preset id.`
        );
      }
      const extendsId = raw.extends.trim();
      if (extendsId === id) {
        throw new Error(
          `[presets.${id}] cannot extend itself. Drop the \`extends\` field or point it at a different preset.`
        );
      }
      flatEntry.extendsId = extendsId;
    }

    if (raw.manufacturer !== undefined) {
      if (typeof raw.manufacturer !== 'string') {
        throw new Error(
          `Invalid type for "manufacturer" in [presets.${id}]. Expected string, got ${typeof raw.manufacturer}.`
        );
      }
      flatEntry.manufacturer = raw.manufacturer;
    }
    if (raw.productName !== undefined) {
      if (typeof raw.productName !== 'string') {
        throw new Error(
          `Invalid type for "productName" in [presets.${id}]. Expected string, got ${typeof raw.productName}.`
        );
      }
      flatEntry.productName = raw.productName;
    }

    // Capability + content-path validation via the shared helper. Presets
    // are always mass-storage so the wav/aiff warning is always armed.
    const parsedCaps = parseCapabilityFields(raw, `[presets.${id}]`, true);
    const { musicDir, moviesDir, tvShowsDir, ...capabilities } = parsedCaps;
    Object.assign(flatEntry.capabilities, capabilities);
    if (musicDir !== undefined) flatEntry.contentPaths.musicDir = musicDir;
    if (moviesDir !== undefined) flatEntry.contentPaths.moviesDir = moviesDir;
    if (tvShowsDir !== undefined) flatEntry.contentPaths.tvShowsDir = tvShowsDir;

    flat.set(id, flatEntry);
  }

  if (flat.size === 0) {
    return undefined;
  }

  // Topo-sort: repeatedly resolve presets whose `extends` is satisfied
  // (built-in or already-resolved user preset). When a pass adds none and
  // some remain, report unresolved/cycle.
  const resolved: Record<string, MassStoragePreset> = {};
  const remaining = new Map(flat);

  while (remaining.size > 0) {
    let progress = false;
    for (const [id, entry] of remaining) {
      const ext = entry.extendsId;
      const canResolve =
        ext === undefined ||
        builtInIds.has(ext) ||
        Object.prototype.hasOwnProperty.call(resolved, ext);
      if (!canResolve) continue;

      try {
        resolved[id] = definePreset(
          {
            id: entry.id,
            extends: ext,
            manufacturer: entry.manufacturer,
            productName: entry.productName,
            capabilities: entry.capabilities,
            contentPaths: entry.contentPaths,
          },
          { available: resolved }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[presets.${id}] ${msg}`);
      }

      remaining.delete(id);
      progress = true;
    }
    if (!progress) {
      // Either unresolved (extends → non-existent id) or a cycle among
      // the remaining set. Name them all so the user can grep their config.
      const stuck = [...remaining.keys()].map((k) => `[presets.${k}]`).join(', ');
      const exampleId = remaining.keys().next().value as string;
      const exampleExt = remaining.get(exampleId)!.extendsId;
      if (
        exampleExt !== undefined &&
        !builtInIds.has(exampleExt) &&
        !remaining.has(exampleExt) &&
        !Object.prototype.hasOwnProperty.call(resolved, exampleExt)
      ) {
        throw new Error(
          `[presets.${exampleId}] extends unknown preset id "${exampleExt}". ` +
            `Known presets: ${[...builtInIds, ...Object.keys(resolved)].join(', ')}.`
        );
      }
      throw new Error(
        `Cycle or unresolved \`extends\` chain among presets: ${stuck}. ` +
          `Check that each preset's \`extends\` eventually reaches a built-in (${BUILT_IN_PRESET_IDS.join(', ')}).`
      );
    }
  }

  return resolved;
}

// =============================================================================
/**
 * Warn when a config reference points at a key absent from its registry.
 *
 * Reproduces the shape:
 *   Warning: ${label}="${value}" references a non-existent ${kind}.
 *   Available ${availableLabel}: ${keys join ', ' || '(none)'}
 *
 * General over (value + label + referent registry) so future callers can
 * validate per-device default references (e.g. `label =
 * "devices.terapod.defaultMusic"`, `kind = "music collection"`, `registry =
 * music`) against the same warning surface without copy-pasting a block.
 *
 * No-ops when `value` is undefined. Emits at most one warning. Does not throw —
 * a dangling default reference is advisory, not fatal.
 */
function validateRef(args: {
  value: string | undefined;
  label: string;
  kind: string;
  availableLabel: string;
  registry: Record<string, unknown> | undefined;
}): void {
  const { value, label, kind, availableLabel, registry } = args;
  if (value === undefined) {
    return;
  }
  if (!registry || !(value in registry)) {
    console.warn(
      `Warning: ${label}="${value}" references a non-existent ${kind}. ` +
        `Available ${availableLabel}: ${registry ? Object.keys(registry).join(', ') : '(none)'}`
    );
  }
}

/**
 * Validate that default references point to valid collections/devices.
 * Logs warnings (via {@link validateRef}) if defaults reference non-existent items.
 */
function validateDefaultReferences(config: PartialConfig): void {
  const { defaults, music, video, devices } = config;

  if (!defaults) {
    return;
  }

  // Validate defaults.music references a valid music collection
  validateRef({
    value: defaults.music,
    label: 'defaults.music',
    kind: 'music collection',
    availableLabel: 'collections',
    registry: music,
  });

  // Validate defaults.video references a valid video collection
  validateRef({
    value: defaults.video,
    label: 'defaults.video',
    kind: 'video collection',
    availableLabel: 'collections',
    registry: video,
  });

  // Validate defaults.device references a valid device
  validateRef({
    value: defaults.device,
    label: 'defaults.device',
    kind: 'device',
    availableLabel: 'devices',
    registry: devices,
  });
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

  const forceTransferMode = process.env[ENV_KEYS.forceTransferMode];
  if (forceTransferMode !== undefined) {
    config.forceTransferMode = parseBoolEnv(forceTransferMode);
  }

  const forceSyncTags = process.env[ENV_KEYS.forceSyncTags];
  if (forceSyncTags !== undefined) {
    config.forceSyncTags = parseBoolEnv(forceSyncTags);
  }

  const checkArtwork = process.env[ENV_KEYS.checkArtwork];
  if (checkArtwork !== undefined) {
    config.checkArtwork = parseBoolEnv(checkArtwork);
  }

  const transferMode = process.env[ENV_KEYS.transferMode];
  if (transferMode !== undefined) {
    if (isValidTransferMode(transferMode)) {
      config.transferMode = transferMode;
    }
  }

  const skipUpgrades = process.env[ENV_KEYS.skipUpgrades];
  if (skipUpgrades !== undefined) {
    config.skipUpgrades = parseBoolEnv(skipUpgrades);
  }

  const allowEmptyPlaylist = process.env[ENV_KEYS.allowEmptyPlaylist];
  if (allowEmptyPlaylist !== undefined) {
    config.allowEmptyPlaylist = parseBoolEnv(allowEmptyPlaylist);
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

  // Show language env vars
  const showLanguage = process.env[ENV_KEYS.showLanguage];
  const showLanguageFormat = process.env[ENV_KEYS.showLanguageFormat];
  const showLanguageExpand = process.env[ENV_KEYS.showLanguageExpand];

  if (
    showLanguage !== undefined ||
    showLanguageFormat !== undefined ||
    showLanguageExpand !== undefined
  ) {
    const sl: ShowLanguageConfig = { ...DEFAULT_SHOW_LANGUAGE_CONFIG };

    if (showLanguage !== undefined) {
      sl.enabled = parseBoolEnv(showLanguage);
    }
    if (showLanguageFormat !== undefined) {
      sl.format = showLanguageFormat;
    }
    if (showLanguageExpand !== undefined) {
      sl.expand = parseBoolEnv(showLanguageExpand);
    }

    config.videoTransforms = { showLanguage: sl };
  }

  // Parse device default env vars (mass-storage capability overrides)
  const deviceDefaults: NonNullable<PodkitConfig['deviceDefaults']> = {};
  let hasDeviceDefaults = false;

  const envArtworkMaxRes = process.env[ENV_KEYS.artworkMaxResolution];
  if (envArtworkMaxRes !== undefined) {
    const parsed = parseInt(envArtworkMaxRes, 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed >= 1 && parsed <= 10000) {
      deviceDefaults.artworkMaxResolution = parsed;
      hasDeviceDefaults = true;
    }
  }

  const envArtworkSources = process.env[ENV_KEYS.artworkSources];
  if (envArtworkSources !== undefined) {
    const sources = envArtworkSources
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (
      sources.length > 0 &&
      sources.every((s) => ARTWORK_SOURCES.includes(s as DeviceArtworkSource))
    ) {
      deviceDefaults.artworkSources = sources as DeviceArtworkSource[];
      hasDeviceDefaults = true;
    }
  }

  const envSupportedCodecs = process.env[ENV_KEYS.supportedAudioCodecs];
  if (envSupportedCodecs !== undefined) {
    const codecs = envSupportedCodecs
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (codecs.length > 0 && codecs.every((c) => AUDIO_CODECS.includes(c as AudioCodec))) {
      deviceDefaults.supportedAudioCodecs = codecs as AudioCodec[];
      hasDeviceDefaults = true;
    }
  }

  const envSupportsVideo = process.env[ENV_KEYS.supportsVideo];
  if (envSupportsVideo !== undefined) {
    deviceDefaults.supportsVideo = parseBoolEnv(envSupportsVideo);
    hasDeviceDefaults = true;
  }

  const envSupportsAlbumArtistBrowsing = process.env[ENV_KEYS.supportsAlbumArtistBrowsing];
  if (envSupportsAlbumArtistBrowsing !== undefined) {
    deviceDefaults.supportsAlbumArtistBrowsing = parseBoolEnv(envSupportsAlbumArtistBrowsing);
    hasDeviceDefaults = true;
  }

  const envMusicDir = process.env[ENV_KEYS.musicDir];
  if (envMusicDir !== undefined) {
    deviceDefaults.musicDir = envMusicDir;
    hasDeviceDefaults = true;
  }

  const envMoviesDir = process.env[ENV_KEYS.moviesDir];
  if (envMoviesDir !== undefined) {
    deviceDefaults.moviesDir = envMoviesDir;
    hasDeviceDefaults = true;
  }

  const envTvShowsDir = process.env[ENV_KEYS.tvShowsDir];
  if (envTvShowsDir !== undefined) {
    deviceDefaults.tvShowsDir = envTvShowsDir;
    hasDeviceDefaults = true;
  }

  const envPathTemplate = process.env[ENV_KEYS.pathTemplate];
  if (envPathTemplate !== undefined) {
    validatePathTemplate(envPathTemplate, `env ${ENV_KEYS.pathTemplate}`);
    deviceDefaults.pathTemplate = envPathTemplate;
    hasDeviceDefaults = true;
  }

  if (hasDeviceDefaults) {
    config.deviceDefaults = deviceDefaults;
  }

  // Parse collection env vars
  const envCollections = loadEnvCollections();
  if (envCollections.music) {
    config.music = envCollections.music;
  }
  if (envCollections.video) {
    config.video = envCollections.video;
  }
  if (envCollections.defaults) {
    config.defaults = envCollections.defaults;
  }

  return config;
}

// =============================================================================
// Collection Environment Variable Parsing
// =============================================================================

/** Known field suffixes for music collection env vars */
const MUSIC_COLLECTION_FIELDS = [
  'PATH',
  'TYPE',
  'URL',
  'USERNAME',
  'PASSWORD',
  'PLAYLIST',
] as const;
type MusicCollectionField = (typeof MUSIC_COLLECTION_FIELDS)[number];

/** Known field suffixes for video collection env vars */
const VIDEO_COLLECTION_FIELDS = ['PATH'] as const;

const MUSIC_ENV_PREFIX = 'PODKIT_MUSIC_';
const VIDEO_ENV_PREFIX = 'PODKIT_VIDEO_';

/**
 * Convert an env var name segment to a collection config name
 *
 * Env var segments are UPPER_SNAKE_CASE. Config names are lower-kebab-case.
 *
 * @example envNameToConfigName('MY_SERVER') // => 'my-server'
 * @example envNameToConfigName('MAIN') // => 'main'
 */
function envNameToConfigName(envSegment: string): string {
  return envSegment.toLowerCase().replace(/_/g, '-');
}

/**
 * Parse a PODKIT_MUSIC_* or PODKIT_VIDEO_* env var key
 *
 * Returns the collection name (or undefined for unnamed/default) and the field name.
 * Returns undefined if the key doesn't match a known field pattern.
 *
 * Strategy: check if the remainder after the prefix IS a known field (unnamed collection),
 * otherwise find the known field suffix and extract the collection name from the middle.
 *
 * @example parseMusicEnvKey('PODKIT_MUSIC_PATH') // => { name: undefined, field: 'PATH' }
 * @example parseMusicEnvKey('PODKIT_MUSIC_MAIN_PATH') // => { name: 'MAIN', field: 'PATH' }
 * @example parseMusicEnvKey('PODKIT_MUSIC_MY_SERVER_URL') // => { name: 'MY_SERVER', field: 'URL' }
 */
function parseCollectionEnvKey(
  key: string,
  prefix: string,
  knownFields: readonly string[]
): { name: string | undefined; field: string } | undefined {
  if (!key.startsWith(prefix)) {
    return undefined;
  }

  const remainder = key.slice(prefix.length);

  // Check if the entire remainder is a known field (unnamed collection)
  if (knownFields.includes(remainder)) {
    return { name: undefined, field: remainder };
  }

  // Find which known field suffix it ends with
  for (const field of knownFields) {
    const suffix = `_${field}`;
    if (remainder.endsWith(suffix)) {
      const namePart = remainder.slice(0, -suffix.length);
      if (namePart.length > 0) {
        return { name: namePart, field };
      }
    }
  }

  return undefined;
}

/**
 * Load music and video collections from environment variables
 *
 * Supports two patterns:
 *
 * **Unnamed (default) collections:**
 * - PODKIT_MUSIC_PATH=/music — creates a directory collection named "default"
 * - PODKIT_MUSIC_TYPE=subsonic — sets type (default: "directory")
 * - PODKIT_MUSIC_URL, PODKIT_MUSIC_USERNAME, PODKIT_MUSIC_PASSWORD — subsonic fields
 * - PODKIT_MUSIC_PLAYLIST — optional subsonic playlist-scope name
 * - PODKIT_VIDEO_PATH=/videos — creates a video collection named "default"
 *
 * **Named collections:**
 * - PODKIT_MUSIC_MAIN_PATH=/music — creates collection named "main"
 * - PODKIT_MUSIC_NAVIDROME_TYPE=subsonic — creates collection named "navidrome"
 * - PODKIT_MUSIC_NAVIDROME_URL, _USERNAME, _PASSWORD, _PLAYLIST — subsonic fields
 * - PODKIT_VIDEO_MOVIES_PATH=/movies — creates video collection named "movies"
 *
 * Collection names in env vars use UPPER_SNAKE_CASE, converted to lower-kebab-case
 * in config (e.g., MY_SERVER → my-server).
 *
 * When exactly one collection exists per type with no file-based default, it is
 * automatically set as the default.
 */
function loadEnvCollections(): {
  music?: Record<string, MusicCollectionConfig>;
  video?: Record<string, VideoCollectionConfig>;
  defaults?: DefaultsConfig;
} {
  // Collect raw field values grouped by collection name
  // undefined name = unnamed/default collection (stored under key "default")
  const musicRaw: Record<string, Partial<Record<MusicCollectionField, string>>> = {};
  const videoRaw: Record<string, Partial<Record<string, string>>> = {};

  for (const key of Object.keys(process.env)) {
    // Try music prefix
    const musicParsed = parseCollectionEnvKey(key, MUSIC_ENV_PREFIX, MUSIC_COLLECTION_FIELDS);
    if (musicParsed) {
      const configName = musicParsed.name ? envNameToConfigName(musicParsed.name) : 'default';
      if (!musicRaw[configName]) {
        musicRaw[configName] = {};
      }
      musicRaw[configName][musicParsed.field as MusicCollectionField] = process.env[key];
      continue;
    }

    // Try video prefix
    const videoParsed = parseCollectionEnvKey(key, VIDEO_ENV_PREFIX, VIDEO_COLLECTION_FIELDS);
    if (videoParsed) {
      const configName = videoParsed.name ? envNameToConfigName(videoParsed.name) : 'default';
      if (!videoRaw[configName]) {
        videoRaw[configName] = {};
      }
      videoRaw[configName][videoParsed.field] = process.env[key];
    }
  }

  // Build music collection configs
  const music: Record<string, MusicCollectionConfig> = {};
  for (const [name, fields] of Object.entries(musicRaw)) {
    const collectionType = fields.TYPE === 'subsonic' ? 'subsonic' : 'directory';

    if (collectionType === 'directory') {
      if (!fields.PATH) continue; // PATH is required for directory collections
      if (fields.PLAYLIST !== undefined) {
        throw new Error(
          `"playlist" is only valid for subsonic collections, but the "${name}" collection is a directory collection. ` +
            `Remove the PLAYLIST env var or set TYPE=subsonic.`
        );
      }
      music[name] = {
        path: fields.PATH,
        type: 'directory',
      };
    } else {
      // Subsonic collection — URL and username required, path and password optional
      if (!fields.URL || !fields.USERNAME) continue;
      music[name] = {
        path: fields.PATH ?? '',
        type: 'subsonic',
        url: fields.URL,
        username: fields.USERNAME,
        password: fields.PASSWORD,
        playlist: fields.PLAYLIST, // Optional - subsonic-only scope
      };
    }
  }

  // Build video collection configs
  const video: Record<string, VideoCollectionConfig> = {};
  for (const [name, fields] of Object.entries(videoRaw)) {
    if (!fields.PATH) continue; // PATH is required
    video[name] = {
      path: fields.PATH,
    };
  }

  const hasMusic = Object.keys(music).length > 0;
  const hasVideo = Object.keys(video).length > 0;

  if (!hasMusic && !hasVideo) {
    return {};
  }

  const result: {
    music?: Record<string, MusicCollectionConfig>;
    video?: Record<string, VideoCollectionConfig>;
    defaults?: DefaultsConfig;
  } = {};

  if (hasMusic) {
    result.music = music;
  }
  if (hasVideo) {
    result.video = video;
  }

  // Auto-default: if exactly one collection per type, set it as default
  const defaults: DefaultsConfig = {};
  const musicNames = Object.keys(music);
  const videoNames = Object.keys(video);

  if (musicNames.length === 1) {
    defaults.music = musicNames[0];
  }
  if (videoNames.length === 1) {
    defaults.video = videoNames[0];
  }

  if (defaults.music || defaults.video) {
    result.defaults = defaults;
  }

  return result;
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
    videoTransforms: { ...DEFAULT_CONFIG.videoTransforms },
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
    if (config.checkArtwork !== undefined) {
      merged.checkArtwork = config.checkArtwork;
    }
    if (config.transferMode !== undefined) {
      merged.transferMode = config.transferMode;
    }
    if (config.skipUpgrades !== undefined) {
      merged.skipUpgrades = config.skipUpgrades;
    }
    if (config.allowEmptyPlaylist !== undefined) {
      merged.allowEmptyPlaylist = config.allowEmptyPlaylist;
    }
    if (config.codec !== undefined) {
      merged.codec = config.codec;
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
    if (config.videoTransforms !== undefined) {
      // Deep merge video transforms config
      merged.videoTransforms = {
        showLanguage: {
          ...merged.videoTransforms.showLanguage,
          ...config.videoTransforms.showLanguage,
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
            // Deep merge video transforms if both exist
            videoTransforms: deviceConfig.videoTransforms
              ? {
                  showLanguage: {
                    ...existingDevice.videoTransforms?.showLanguage,
                    ...deviceConfig.videoTransforms.showLanguage,
                  },
                }
              : existingDevice.videoTransforms,
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
