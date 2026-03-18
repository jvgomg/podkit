/**
 * Configuration types for podkit CLI
 *
 * This module defines the multi-collection/device configuration schema
 * introduced in ADR-008.
 */

// Import quality preset types from core
export type {
  QualityPreset,
  EncodingMode,
  TransformsConfig,
  CleanArtistsConfig,
  VideoQualityPreset,
  ShowLanguageConfig,
  VideoTransformsConfig,
} from '@podkit/core';
export {
  QUALITY_PRESETS,
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_CLEAN_ARTISTS_CONFIG,
  VIDEO_QUALITY_PRESETS,
  DEFAULT_SHOW_LANGUAGE_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
} from '@podkit/core';

// Import type for local use
import type {
  QualityPreset,
  EncodingMode,
  TransformsConfig,
  VideoQualityPreset,
  VideoTransformsConfig,
} from '@podkit/core';

// =============================================================================
// Multi-Collection/Device Types (ADR-008)
// =============================================================================

/**
 * Music collection configuration
 *
 * Represents a named music source that can be synced to devices.
 * Supports both local directories and remote Subsonic servers.
 *
 * @example Directory collection
 * ```toml
 * [music.main]
 * path = "/Volumes/Media/music/library"
 * ```
 *
 * @example Subsonic collection
 * ```toml
 * [music.work]
 * type = "subsonic"
 * url = "https://music.work.com"
 * username = "james"
 * # Password via env: PODKIT_MUSIC_WORK_PASSWORD
 * ```
 */
export interface MusicCollectionConfig {
  /** Path to the music directory (required for directory type, optional for subsonic) */
  path: string;
  /** Collection source type. Default: 'directory' */
  type?: 'directory' | 'subsonic';
  /** Subsonic server URL (required when type='subsonic') */
  url?: string;
  /** Subsonic username (required when type='subsonic') */
  username?: string;
  /** Subsonic password (optional - can also use env var PODKIT_MUSIC_{NAME}_PASSWORD) */
  password?: string;
}

/**
 * Video collection configuration
 *
 * Represents a named video source (movies, TV shows) that can be synced to devices.
 *
 * @example
 * ```toml
 * [video.movies]
 * path = "/Volumes/Media/movies"
 * ```
 */
export interface VideoCollectionConfig {
  /** Path to the video directory */
  path: string;
}

/**
 * Device configuration
 *
 * Represents a named iPod device with its sync settings.
 * Quality, transforms, and other settings are scoped to devices, not collections,
 * because different iPods may have different storage/capability constraints.
 *
 * @example
 * ```toml
 * [devices.terapod]
 * volumeUuid = "ABC-123"
 * volumeName = "TERAPOD"
 * quality = "high"
 * audioQuality = "max"
 * videoQuality = "medium"
 * artwork = true
 *
 * [devices.terapod.cleanArtists]
 * format = "feat. {}"
 * ```
 */
export interface DeviceConfig {
  /** Volume UUID for device auto-detection (optional — required only for auto-detection) */
  volumeUuid?: string;
  /** Volume name for display and detection (optional — derived from device name if omitted) */
  volumeName?: string;
  /** Unified quality preset (sets both audio and video) */
  quality?: QualityPreset;
  /** Audio transcoding quality preset (overrides quality) */
  audioQuality?: QualityPreset;
  /** Video transcoding quality preset (overrides quality) */
  videoQuality?: VideoQualityPreset;
  /** Encoding mode for AAC transcoding (overrides global) */
  encoding?: EncodingMode;
  /** Custom bitrate override in kbps (overrides global) */
  customBitrate?: number;
  /** Bitrate tolerance ratio for preset change detection (overrides global) */
  bitrateTolerance?: number;
  /** Whether to sync artwork to this device */
  artwork?: boolean;
  /** Detect artwork changes by comparing content hashes (overrides global) */
  checkArtwork?: boolean;
  /** Skip file-replacement upgrades during sync for this device */
  skipUpgrades?: boolean;
  /** Device-specific transform settings */
  transforms?: TransformsConfig;
  /** Device-specific video transform settings */
  videoTransforms?: VideoTransformsConfig;
}

/**
 * Default collection and device configuration
 *
 * Specifies which named collection/device to use when CLI flags are omitted.
 *
 * @example
 * ```toml
 * [defaults]
 * music = "main"
 * video = "movies"
 * device = "terapod"
 * ```
 */
export interface DefaultsConfig {
  /** Name of the default music collection */
  music?: string;
  /** Name of the default video collection */
  video?: string;
  /** Name of the default device */
  device?: string;
}

/**
 * Configuration that can be set via config file, env vars, or CLI
 *
 * This interface implements the multi-collection/device schema from ADR-008.
 * Legacy flat config format is no longer supported - use the new format with
 * [music.*], [video.*], and [devices.*] sections.
 */
export interface PodkitConfig {
  // ===========================================================================
  // Global defaults (can be overridden per-device)
  // ===========================================================================

  /** Unified quality preset (sets both audio and video, can be overridden per-device) */
  quality: QualityPreset;
  /** Audio transcoding quality preset (overrides quality for audio) */
  audioQuality?: QualityPreset;
  /** Video transcoding quality preset (overrides quality for video) */
  videoQuality?: VideoQualityPreset;
  /**
   * Encoding mode for AAC transcoding.
   * VBR (variable bitrate) is the default and provides better quality per byte.
   * CBR (constant bitrate) produces predictable file sizes.
   */
  encoding?: EncodingMode;
  /**
   * Custom bitrate override in kbps (64-320).
   * Overrides the preset's target bitrate for AAC encoding.
   */
  customBitrate?: number;
  /**
   * Bitrate tolerance ratio (0.0-1.0) for preset change detection.
   * Overrides the default tolerance for the encoding mode.
   */
  bitrateTolerance?: number;
  /** Include artwork in sync (global default, can be overridden per-device) */
  artwork: boolean;
  /** Skip file-replacement upgrades during sync (global default, can be overridden per-device) */
  skipUpgrades?: boolean;
  /** Show contextual tips (default: true) */
  tips: boolean;
  /** Force re-transcoding of all lossless-source tracks (CLI/env only, not saved in config) */
  forceTranscode?: boolean;
  /** Write sync tags to all matched transcoded tracks without re-transcoding (CLI/env only) */
  forceSyncTags?: boolean;
  /** Detect artwork changes by comparing content hashes (can be overridden per-device) */
  checkArtwork?: boolean;
  /** Transform configuration (global default, can be overridden per-device) */
  transforms: TransformsConfig;
  /** Video transform configuration (global default, can be overridden per-device) */
  videoTransforms: VideoTransformsConfig;

  // ===========================================================================
  // Multi-collection/device fields (ADR-008)
  // ===========================================================================

  /** Named music collections */
  music?: Record<string, MusicCollectionConfig>;
  /** Named video collections */
  video?: Record<string, VideoCollectionConfig>;
  /** Named devices with their settings */
  devices?: Record<string, DeviceConfig>;
  /** Default collection and device names */
  defaults?: DefaultsConfig;
}

/**
 * Global CLI options (parsed from commander)
 */
export interface GlobalOptions {
  /** Verbosity level (0-3) */
  verbose: number;
  /** Suppress output */
  quiet: boolean;
  /** Output in JSON format */
  json: boolean;
  /** Disable colored output */
  color: boolean;
  /** Show contextual tips */
  tips: boolean;
  /** Custom config file path */
  config?: string;
  /** iPod device path (CLI override) */
  device?: string;
}

/**
 * Partial config for merging (all fields optional)
 */
export type PartialConfig = Partial<PodkitConfig>;

// =============================================================================
// Config File Content Types (raw TOML parsing)
// =============================================================================

/**
 * Raw cleanArtists configuration as parsed from TOML
 *
 * Can be either a boolean (simple enable/disable) or a table with options.
 * When provided as a table, enabled defaults to true unless explicitly set to false.
 */
export type ConfigFileCleanArtists =
  | boolean
  | {
      enabled?: boolean;
      drop?: boolean;
      format?: string;
      ignore?: string[];
    };

/**
 * Raw showLanguage configuration as parsed from TOML
 *
 * Can be either a boolean (simple enable/disable) or a table with options.
 * When provided as a table, enabled defaults to true unless explicitly set to false.
 */
export type ConfigFileShowLanguage =
  | boolean
  | {
      enabled?: boolean;
      format?: string;
      expand?: boolean;
    };

/**
 * Raw music collection config as parsed from TOML
 */
export interface ConfigFileMusicCollection {
  path?: string;
  type?: string;
  url?: string;
  username?: string;
  password?: string;
}

/**
 * Raw video collection config as parsed from TOML
 */
export interface ConfigFileVideoCollection {
  path?: string;
}

/**
 * Raw device config as parsed from TOML
 */
export interface ConfigFileDevice {
  volumeUuid?: string;
  volumeName?: string;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  customBitrate?: number;
  bitrateTolerance?: number;
  artwork?: boolean;
  checkArtwork?: boolean;
  skipUpgrades?: boolean;
  cleanArtists?: ConfigFileCleanArtists;
  showLanguage?: ConfigFileShowLanguage;
}

/**
 * Raw defaults config as parsed from TOML
 */
export interface ConfigFileDefaults {
  music?: string;
  video?: string;
  device?: string;
}

/**
 * Config file content as parsed from TOML
 *
 * This represents the raw TOML structure before validation.
 *
 * @example Multi-collection/device format (ADR-008)
 * ```toml
 * quality = "high"
 * audioQuality = "max"
 * videoQuality = "medium"
 * artwork = true
 * cleanArtists = true
 *
 * [music.main]
 * path = "/Volumes/Media/music/library"
 *
 * [video.movies]
 * path = "/Volumes/Media/movies"
 *
 * [devices.terapod]
 * volumeUuid = "ABC-123"
 * volumeName = "TERAPOD"
 * quality = "high"
 * artwork = true
 *
 * [devices.terapod.cleanArtists]
 * format = "feat. {}"
 *
 * [defaults]
 * music = "main"
 * device = "terapod"
 * ```
 */
export interface ConfigFileContent {
  // ===========================================================================
  // Global defaults
  // ===========================================================================

  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  customBitrate?: number;
  bitrateTolerance?: number;
  artwork?: boolean;
  checkArtwork?: boolean;
  tips?: boolean;
  skipUpgrades?: boolean;
  cleanArtists?: ConfigFileCleanArtists;
  showLanguage?: ConfigFileShowLanguage;

  /** Named music collections: [music.{name}] */
  music?: Record<string, ConfigFileMusicCollection>;
  /** Named video collections: [video.{name}] */
  video?: Record<string, ConfigFileVideoCollection>;
  /** Named devices: [devices.{name}] */
  devices?: Record<string, ConfigFileDevice>;
  /** Default selections: [defaults] */
  defaults?: ConfigFileDefaults;
}
