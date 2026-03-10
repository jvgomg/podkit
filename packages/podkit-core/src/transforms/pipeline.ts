/**
 * Transform pipeline
 *
 * Applies transforms to tracks in order, producing both original
 * and transformed versions for use in diffing and sync operations.
 *
 * @module
 */

import type { TransformableTrack, TransformResult, TransformsConfig } from './types.js';
import { DEFAULT_TRANSFORMS_CONFIG } from './types.js';
import { ftintitleTransform } from './ftintitle/index.js';

/**
 * All registered transforms in application order
 *
 * Transforms are applied in this order. If adding new transforms,
 * consider dependencies between them (e.g., ftintitle should run
 * before any transform that depends on clean artist names).
 */
const TRANSFORMS = [ftintitleTransform] as const;

/**
 * Apply all enabled transforms to a track
 *
 * Runs each transform in order, passing the result to the next.
 * Returns both the original and final transformed track.
 *
 * @param track - The track to transform
 * @param config - Transform configuration (which transforms are enabled)
 * @returns Original and transformed track, plus applied flag
 *
 * @example
 * const result = applyTransforms(track, { ftintitle: { enabled: true, drop: false, format: 'feat. {}' } });
 * if (result.applied) {
 *   console.log('Track was transformed');
 *   console.log('Original:', result.original);
 *   console.log('Transformed:', result.transformed);
 * }
 */
export function applyTransforms<T extends TransformableTrack>(
  track: T,
  config: TransformsConfig = DEFAULT_TRANSFORMS_CONFIG
): TransformResult<T> {
  let transformed: TransformableTrack = track;
  let anyApplied = false;

  for (const transform of TRANSFORMS) {
    const transformConfig = config[transform.name as keyof TransformsConfig];
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
 * Check if any transforms are enabled in the config
 *
 * @param config - Transform configuration
 * @returns True if at least one transform is enabled
 */
export function hasEnabledTransforms(config: TransformsConfig): boolean {
  return config.ftintitle.enabled;
  // Add more checks as transforms are added:
  // || config.otherTransform.enabled
}

/**
 * Get a summary of enabled transforms for display
 *
 * @param config - Transform configuration
 * @returns Array of { name, description } for enabled transforms
 */
export function getEnabledTransformsSummary(
  config: TransformsConfig
): Array<{ name: string; description: string }> {
  const enabled: Array<{ name: string; description: string }> = [];

  if (config.ftintitle.enabled) {
    const { drop, format } = config.ftintitle;
    if (drop) {
      enabled.push({
        name: 'ftintitle',
        description: 'drop featuring info',
      });
    } else {
      enabled.push({
        name: 'ftintitle',
        description: `move to title (format: "${format}")`,
      });
    }
  }

  return enabled;
}
