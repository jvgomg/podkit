/**
 * Video transform pipeline
 *
 * Applies video-specific transforms (e.g., show language) to video tracks,
 * producing both original and transformed versions for dual-key matching
 * in the video differ.
 *
 * Follows the same pattern as the music transform pipeline.
 *
 * @module
 */

import type {
  VideoTransformableTrack,
  VideoTransformResult,
  VideoTransformsConfig,
} from './types.js';
import { DEFAULT_VIDEO_TRANSFORMS_CONFIG, DEFAULT_SHOW_LANGUAGE_CONFIG } from './types.js';
import { showLanguageTransform } from './video-show-language.js';
import type { ContentType } from '../video/metadata.js';

// =============================================================================
// Pipeline
// =============================================================================

/**
 * All registered video transforms in application order
 *
 * Transforms are applied in this order. If adding new video transforms,
 * consider dependencies between them.
 */
const VIDEO_TRANSFORMS = [showLanguageTransform] as const;

/**
 * Apply all enabled video transforms to a track
 *
 * Runs each transform in order, passing the result to the next.
 * Returns both the original and final transformed track.
 *
 * @param track - The video track to transform
 * @param config - Video transform configuration
 * @returns Original and transformed track, plus applied flag
 */
export function applyVideoTransforms<T extends VideoTransformableTrack>(
  track: T,
  config: VideoTransformsConfig = DEFAULT_VIDEO_TRANSFORMS_CONFIG
): VideoTransformResult<T> {
  let transformed: VideoTransformableTrack = track;
  let anyApplied = false;

  for (const transform of VIDEO_TRANSFORMS) {
    const transformConfig = config[transform.name as keyof VideoTransformsConfig];
    if (transformConfig) {
      const result = transform.apply(transformed, transformConfig);
      if (result !== transformed) {
        transformed = result;
        anyApplied = true;
      }
    }
  }

  return {
    original: track,
    transformed: transformed as T,
    applied: anyApplied,
  };
}

/**
 * Check if any video transforms are enabled
 */
export function hasEnabledVideoTransforms(config: VideoTransformsConfig): boolean {
  for (const transform of VIDEO_TRANSFORMS) {
    const transformConfig = config[transform.name as keyof VideoTransformsConfig];
    if (transformConfig && 'enabled' in transformConfig && transformConfig.enabled) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Dual-Key Matching
// =============================================================================

/**
 * Video track fields needed for match key generation
 */
interface VideoMatchable {
  contentType: ContentType;
  title: string;
  year?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

/**
 * Result of generating match keys with video transforms
 */
export interface VideoTransformMatchKeys {
  /** Key generated from original metadata */
  originalKey: string;
  /** Key generated from transformed metadata */
  transformedKey: string;
  /** True if transform was applied (keys differ) */
  transformApplied: boolean;
  /** The transformed series title (for writing to iPod) */
  transformedSeriesTitle?: string;
}

/**
 * Generate both original and transformed match keys for a video track
 *
 * When transforms are configured, a collection video may match an iPod video
 * by either its original key (iPod has original metadata) or its
 * transformed key (iPod was previously synced with transforms enabled).
 *
 * IMPORTANT: This function ALWAYS computes the transformed key, even when
 * transforms are disabled. This is necessary for dual-key matching:
 * - When transforms are enabled: we need the transformed key to know what to write
 * - When transforms are disabled: we need the transformed key to find iPod videos
 *   that were previously synced with transforms enabled (so we can revert them)
 */
export function getVideoTransformMatchKeys(
  video: VideoMatchable,
  generateKey: (video: VideoMatchable) => string,
  transforms?: VideoTransformsConfig
): VideoTransformMatchKeys {
  const originalKey = generateKey(video);

  if (!transforms) {
    return {
      originalKey,
      transformedKey: originalKey,
      transformApplied: false,
      transformedSeriesTitle: video.seriesTitle,
    };
  }

  // Force-enable transforms for key generation purposes
  // Spread defaults first to ensure format/expand are always present
  const forceEnabledConfig: VideoTransformsConfig = {
    showLanguage: {
      ...DEFAULT_SHOW_LANGUAGE_CONFIG,
      ...transforms.showLanguage,
      enabled: true,
    },
  };

  const result = applyVideoTransforms(video, forceEnabledConfig);

  const transformedKey = generateKey({
    ...video,
    seriesTitle: result.transformed.seriesTitle,
  });

  // Compute the actual display title (with real enabled/disabled state)
  const actualResult = applyVideoTransforms(video, transforms);

  return {
    originalKey,
    transformedKey,
    transformApplied: result.applied,
    transformedSeriesTitle: actualResult.transformed.seriesTitle,
  };
}

/**
 * Get a summary of enabled video transforms for display
 */
export function getEnabledVideoTransformsSummary(
  config: VideoTransformsConfig
): Array<{ name: string; description: string }> {
  const enabled: Array<{ name: string; description: string }> = [];

  if (config.showLanguage.enabled) {
    const { format, expand } = config.showLanguage;
    enabled.push({
      name: 'showLanguage',
      description: `show language markers (format: "${format}"${expand ? ', expanded' : ''})`,
    });
  }

  return enabled;
}
