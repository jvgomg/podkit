/**
 * Transform system
 *
 * Transforms modify track metadata during sync without altering source files.
 * This allows per-device customization of how tracks appear on the iPod.
 *
 * ## Available Transforms
 *
 * - **cleanArtists**: Move featuring artists from Artist field to Title field
 *
 * ## Usage
 *
 * ```typescript
 * import { applyTransforms, type TransformsConfig } from '@podkit/core';
 *
 * const config: TransformsConfig = {
 *   cleanArtists: { enabled: true, drop: false, format: 'feat. {}' }
 * };
 *
 * const result = applyTransforms(track, config);
 * if (result.applied) {
 *   console.log('Original:', result.original);
 *   console.log('Transformed:', result.transformed);
 * }
 * ```
 *
 * @module
 */

// Types
export type {
  TransformableTrack,
  TransformResult,
  TrackTransform,
  CleanArtistsConfig,
  TransformsConfig,
} from './types.js';

// Config defaults
export { DEFAULT_CLEAN_ARTISTS_CONFIG, DEFAULT_TRANSFORMS_CONFIG } from './types.js';

// Pipeline
export { applyTransforms, hasEnabledTransforms, getEnabledTransformsSummary } from './pipeline.js';

// Clean artists transform
export { cleanArtistsTransform } from './ftintitle/index.js';

// Clean artists utilities (for testing and direct use)
export {
  applyFtInTitle,
  extractFeaturedArtist,
  insertFeatIntoTitle,
  titleContainsFeat,
} from './ftintitle/index.js';
