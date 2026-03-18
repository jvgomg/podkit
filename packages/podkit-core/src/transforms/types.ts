/**
 * Transform system types
 *
 * Transforms modify track metadata during sync without altering source files.
 * This allows per-device customization of how tracks appear on the iPod.
 *
 * @module
 */

/**
 * Minimal track interface for transforms
 *
 * Contains only the metadata fields that transforms can read and modify.
 * This allows transforms to work with both CollectionTrack and IPodTrack.
 */
export interface TransformableTrack {
  artist: string;
  title: string;
  album: string;
  albumArtist?: string;
}

/**
 * Result of applying transforms to a track
 *
 * Contains both original and transformed versions, plus a flag indicating
 * whether any changes were made. This is used for:
 * - Dual-key matching in the differ (match on either original or transformed)
 * - Determining if an update operation is needed
 */
export interface TransformResult<T extends TransformableTrack = TransformableTrack> {
  /** The original track metadata (unchanged) */
  original: T;
  /** The transformed track metadata */
  transformed: T;
  /** True if any changes were made during transformation */
  applied: boolean;
}

/**
 * A track transform that modifies metadata
 *
 * Transforms are pure functions that take a track and config, returning
 * a new track with modified metadata. They should:
 * - Not modify the input track (return a new object)
 * - Be idempotent (applying twice has same result as once)
 * - Handle edge cases gracefully (missing fields, already-transformed data)
 *
 * @template TConfig - Configuration type for this transform
 */
export interface TrackTransform<TConfig = unknown> {
  /** Unique identifier for this transform */
  name: string;

  /** Default configuration values */
  defaultConfig: TConfig;

  /**
   * Apply the transform to a track
   *
   * @param track - The track to transform
   * @param config - Transform configuration
   * @returns The transformed track (may be same object if no changes)
   */
  apply(track: TransformableTrack, config: TConfig): TransformableTrack;
}

/**
 * Configuration for the clean artists transform
 */
export interface CleanArtistsConfig {
  /** Whether the transform is enabled */
  enabled: boolean;
  /** If true, drop featuring info entirely instead of moving to title */
  drop: boolean;
  /** Format string for featuring text in title. {} is replaced with artist(s) */
  format: string;
  /**
   * Artist names to ignore when splitting on ambiguous separators (and, &, with).
   * These artists will only be split on explicit feat/ft/featuring tokens.
   * Case-insensitive matching.
   *
   * @example ['Coheed and Cambria', 'Simon & Garfunkel', 'Florence and the Machine']
   */
  ignore: string[];
}

/**
 * Default clean artists configuration
 */
export const DEFAULT_CLEAN_ARTISTS_CONFIG: CleanArtistsConfig = {
  enabled: false,
  drop: false,
  format: 'feat. {}',
  ignore: [],
};

/**
 * Configuration for all transforms
 */
export interface TransformsConfig {
  cleanArtists: CleanArtistsConfig;
}

/**
 * Default configuration for all transforms
 */
export const DEFAULT_TRANSFORMS_CONFIG: TransformsConfig = {
  cleanArtists: DEFAULT_CLEAN_ARTISTS_CONFIG,
};

// =============================================================================
// Video Transform Types
// =============================================================================

/**
 * A video track transform that modifies metadata
 *
 * Video transforms are pure functions that take a video track and config,
 * returning a new track with modified metadata. They follow the same pattern
 * as audio TrackTransform but operate on VideoTransformableTrack.
 *
 * @template TConfig - Configuration type for this transform
 */
export interface VideoTrackTransform<TConfig = unknown> {
  /** Unique identifier for this transform */
  name: string;

  /** Default configuration values */
  defaultConfig: TConfig;

  /**
   * Apply the transform to a video track
   *
   * @param track - The video track to transform
   * @param config - Transform configuration
   * @returns The transformed track (may be same object if no changes)
   */
  apply(track: VideoTransformableTrack, config: TConfig): VideoTransformableTrack;
}

/**
 * Minimal video track interface for video transforms
 *
 * Contains only the metadata fields that video transforms can read and modify.
 */
export interface VideoTransformableTrack {
  seriesTitle?: string;
  title: string;
}

/**
 * Result of applying video transforms
 */
export interface VideoTransformResult<T extends VideoTransformableTrack = VideoTransformableTrack> {
  /** The original video track metadata (unchanged) */
  original: T;
  /** The transformed video track metadata */
  transformed: T;
  /** True if any changes were made during transformation */
  applied: boolean;
}

/**
 * Configuration for the show language transform
 *
 * Controls how language/region markers in series titles are displayed on iPod.
 * When enabled, markers like "(JPN)" are reformatted according to the format string.
 * When disabled, markers are stripped from the display title.
 */
export interface ShowLanguageConfig {
  /** Whether the transform is enabled (default: true — show language markers) */
  enabled: boolean;
  /** Format string for language marker. {} is replaced with the language code/name */
  format: string;
  /** When true, expand abbreviations to full names (JPN → Japanese) */
  expand: boolean;
}

/**
 * Default show language configuration
 *
 * Enabled by default — language markers are shown using their abbreviated form.
 */
export const DEFAULT_SHOW_LANGUAGE_CONFIG: ShowLanguageConfig = {
  enabled: true,
  format: '({})',
  expand: false,
};

/**
 * Configuration for all video transforms
 */
export interface VideoTransformsConfig {
  showLanguage: ShowLanguageConfig;
}

/**
 * Default configuration for all video transforms
 */
export const DEFAULT_VIDEO_TRANSFORMS_CONFIG: VideoTransformsConfig = {
  showLanguage: DEFAULT_SHOW_LANGUAGE_CONFIG,
};
