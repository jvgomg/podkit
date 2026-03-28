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
  TransferMode,
  TransformsConfig,
  CleanArtistsConfig,
  VideoQualityPreset,
  ShowLanguageConfig,
  VideoTransformsConfig,
  AudioCodec,
  AudioNormalizationMode,
  DeviceArtworkSource,
  TranscodeTargetCodec,
} from '@podkit/core';
export {
  QUALITY_PRESETS,
  ENCODING_MODES,
  TRANSFER_MODES,
  CONTENT_TYPES,
  VIDEO_QUALITY_PRESETS,
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_CLEAN_ARTISTS_CONFIG,
  DEFAULT_SHOW_LANGUAGE_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  isValidTransferMode,
  CODEC_METADATA,
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
} from '@podkit/core';

// Import type for local use
import type {
  QualityPreset,
  EncodingMode,
  TransferMode,
  TransformsConfig,
  VideoQualityPreset,
  VideoTransformsConfig,
  AudioCodec,
  AudioNormalizationMode,
  DeviceArtworkSource,
  TranscodeTargetCodec,
} from '@podkit/core';

/**
 * Codec preference configuration
 *
 * Specifies ordered lists of preferred codecs for lossy and lossless transcoding.
 * The first codec in each list that the target device supports will be used.
 *
 * String values are normalized to single-element arrays during config loading.
 *
 * @example
 * ```toml
 * [codec]
 * lossy = ["opus", "aac", "mp3"]
 * lossless = ["source", "flac", "alac"]
 * ```
 */
export interface CodecPreferenceConfig {
  /** Ordered lossy codec preference (first supported wins) */
  lossy?: TranscodeTargetCodec[];
  /** Ordered lossless codec preference ('source' = copy without transcoding) */
  lossless?: (TranscodeTargetCodec | 'source')[];
}

/** Supported device types */
export type DeviceType = 'ipod' | 'echo-mini' | 'rockbox' | 'generic';

/** Valid device type values */
export const DEVICE_TYPES = ['ipod', 'echo-mini', 'rockbox', 'generic'] as const;

/** Valid audio codec values for capability overrides */
export const AUDIO_CODECS: readonly AudioCodec[] = [
  'aac',
  'alac',
  'mp3',
  'flac',
  'ogg',
  'opus',
  'wav',
  'aiff',
] as const;

/** Valid artwork source values for capability overrides */
export const ARTWORK_SOURCES: readonly DeviceArtworkSource[] = [
  'database',
  'embedded',
  'sidecar',
] as const;

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
 * Represents a named device with its sync settings.
 * Quality, transforms, and other settings are scoped to devices, not collections,
 * because different devices may have different storage/capability constraints.
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
  /** Device type (default: 'ipod' when omitted for backward compatibility) */
  type?: DeviceType;
  /** Mount point path for mass-storage devices (alternative to volumeUuid; if both are set, volumeUuid takes precedence) */
  path?: string;
  /** Unified quality preset (sets both audio and video) */
  quality?: QualityPreset;
  /** Audio transcoding quality preset (overrides quality) */
  audioQuality?: QualityPreset;
  /** Video transcoding quality preset (overrides quality) */
  videoQuality?: VideoQualityPreset;
  /** Encoding mode for audio transcoding (overrides global) */
  encoding?: EncodingMode;
  /** Custom bitrate override in kbps (overrides global) */
  customBitrate?: number;
  /** Bitrate tolerance ratio for preset change detection (overrides global) */
  bitrateTolerance?: number;
  /** Whether to sync artwork to this device */
  artwork?: boolean;
  /** Detect artwork changes by comparing content hashes (overrides global) */
  checkArtwork?: boolean;
  /** Transfer mode for synced files (overrides global) */
  transferMode?: TransferMode;
  /** Skip file-replacement upgrades during sync for this device */
  skipUpgrades?: boolean;
  /** Device-specific codec preference */
  codec?: CodecPreferenceConfig;
  /** Device-specific transform settings */
  transforms?: TransformsConfig;
  /** Device-specific video transform settings */
  videoTransforms?: VideoTransformsConfig;

  // ===========================================================================
  // Capability overrides (merged on top of preset defaults)
  // ===========================================================================

  /** Override maximum artwork display resolution in pixels */
  artworkMaxResolution?: number;
  /** Override artwork sources the device reads from */
  artworkSources?: DeviceArtworkSource[];
  /** Override audio codecs the device can play natively */
  supportedAudioCodecs?: AudioCodec[];
  /** Override whether the device supports video playback */
  supportsVideo?: boolean;
  /** Override audio normalization mode ('soundcheck', 'replaygain', 'none') */
  audioNormalization?: AudioNormalizationMode;
  /** Override whether the device supports Album Artist browsing */
  supportsAlbumArtistBrowsing?: boolean;
  /** Override the music directory name on the device (default: "Music") */
  musicDir?: string;
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
   * Encoding mode for audio transcoding.
   * VBR (variable bitrate) is the default and provides better quality per byte.
   * CBR (constant bitrate) produces predictable file sizes.
   */
  encoding?: EncodingMode;
  /**
   * Custom bitrate override in kbps (64-320).
   * Overrides the preset's target bitrate for lossy encoding.
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
  /** Reprocess tracks synced with a different transfer mode (CLI/env only) */
  forceTransferMode?: boolean;
  /** Write sync tags to all matched transcoded tracks without re-transcoding (CLI/env only) */
  forceSyncTags?: boolean;
  /** Detect artwork changes by comparing content hashes (can be overridden per-device) */
  checkArtwork?: boolean;
  /**
   * Transfer mode for synced files.
   *
   * - `fast` (default): strips embedded artwork, optimized for iPod playback.
   * - `optimized`: strips embedded artwork from transcoded files.
   * - `portable`: preserves embedded artwork for exportable files.
   */
  transferMode?: TransferMode;
  /** Transform configuration (global default, can be overridden per-device) */
  transforms: TransformsConfig;
  /** Video transform configuration (global default, can be overridden per-device) */
  videoTransforms: VideoTransformsConfig;
  /** Codec preference configuration (global default, can be overridden per-device) */
  codec?: CodecPreferenceConfig;

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

  // ===========================================================================
  // Global device defaults (applied to mass-storage devices when not overridden per-device)
  // ===========================================================================

  /** Global device defaults from env vars (PODKIT_ARTWORK_MAX_RESOLUTION, etc.) */
  deviceDefaults?: {
    artworkMaxResolution?: number;
    artworkSources?: DeviceArtworkSource[];
    supportedAudioCodecs?: AudioCodec[];
    supportsVideo?: boolean;
    audioNormalization?: AudioNormalizationMode;
    supportsAlbumArtistBrowsing?: boolean;
    musicDir?: string;
  };
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
  /** Enable interactive output (spinners/progress); false when --no-tty is passed */
  tty: boolean;
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
 * Raw codec preference config as parsed from TOML
 *
 * Values can be a single string or an array of strings.
 * Single strings are normalized to arrays during config loading.
 */
export interface ConfigFileCodecPreference {
  lossy?: string | string[];
  lossless?: string | string[];
}

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
  type?: string;
  path?: string;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  customBitrate?: number;
  bitrateTolerance?: number;
  artwork?: boolean;
  checkArtwork?: boolean;
  transferMode?: string;
  skipUpgrades?: boolean;
  cleanArtists?: ConfigFileCleanArtists;
  showLanguage?: ConfigFileShowLanguage;
  codec?: ConfigFileCodecPreference;
  artworkMaxResolution?: number;
  artworkSources?: string[];
  supportedAudioCodecs?: string[];
  supportsVideo?: boolean;
  audioNormalization?: string;
  supportsAlbumArtistBrowsing?: boolean;
  musicDir?: string;
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
  transferMode?: string;
  tips?: boolean;
  skipUpgrades?: boolean;
  cleanArtists?: ConfigFileCleanArtists;
  showLanguage?: ConfigFileShowLanguage;
  /** Codec preference: [codec] */
  codec?: ConfigFileCodecPreference;

  /** Named music collections: [music.{name}] */
  music?: Record<string, ConfigFileMusicCollection>;
  /** Named video collections: [video.{name}] */
  video?: Record<string, ConfigFileVideoCollection>;
  /** Named devices: [devices.{name}] */
  devices?: Record<string, ConfigFileDevice>;
  /** Default selections: [defaults] */
  defaults?: ConfigFileDefaults;
}
