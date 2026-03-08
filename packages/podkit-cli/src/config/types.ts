/**
 * Configuration types for podkit CLI
 */

// Import quality preset types from core
export type { QualityPreset, AacQualityPreset, TransformsConfig, VideoQualityPreset } from '@podkit/core';
export { QUALITY_PRESETS, AAC_QUALITY_PRESETS, DEFAULT_TRANSFORMS_CONFIG, VIDEO_QUALITY_PRESETS } from '@podkit/core';

// Import type for local use
import type { QualityPreset, AacQualityPreset, TransformsConfig, VideoQualityPreset } from '@podkit/core';

/**
 * Configuration that can be set via config file, env vars, or CLI
 */
export interface PodkitConfig {
  /** Source directory for music collection */
  source?: string;
  /** iPod device mount point */
  device?: string;
  /** Transcoding quality preset */
  quality: QualityPreset;
  /**
   * Fallback preset for lossy sources when quality='alac'
   * Default: 'max' if quality='alac', otherwise inherits from quality
   */
  fallback?: AacQualityPreset;
  /** Include artwork in sync */
  artwork: boolean;
  /** Transform configuration */
  transforms: TransformsConfig;

  // Video settings
  /** Source directory for video collection */
  videoSource?: string;
  /** Video transcoding quality preset */
  videoQuality?: VideoQualityPreset;
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
  /** Custom config file path */
  config?: string;
  /** iPod device path (CLI override) */
  device?: string;
}

/**
 * Partial config for merging (all fields optional)
 */
export type PartialConfig = Partial<PodkitConfig>;

/**
 * Config file content as parsed from TOML
 *
 * This represents the raw TOML structure before validation.
 * Example config:
 * ```toml
 * source = "/path/to/music"
 * device = "/Volumes/iPod"
 * quality = "high"
 *
 * [transforms.ftintitle]
 * enabled = true
 * drop = false
 * format = "feat. {}"
 *
 * [video]
 * source = "/path/to/videos"
 * quality = "high"
 * ```
 */
export interface ConfigFileContent {
  source?: string;
  device?: string;
  quality?: string;
  fallback?: string;
  artwork?: boolean;
  transforms?: {
    ftintitle?: {
      enabled?: boolean;
      drop?: boolean;
      format?: string;
      ignore?: string[];
    };
  };
  // Video settings
  videoSource?: string;
  videoQuality?: string;
  // Alternative nested structure
  video?: {
    source?: string;
    quality?: string;
  };
}
