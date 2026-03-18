/**
 * Core configuration types
 *
 * This module provides config types for transforms and other sync options.
 * Types are re-exported from their implementation modules for convenience.
 *
 * @module
 */

// Re-export transform configuration types
export type { CleanArtistsConfig, TransformsConfig } from '../transforms/types.js';
export { DEFAULT_CLEAN_ARTISTS_CONFIG, DEFAULT_TRANSFORMS_CONFIG } from '../transforms/types.js';

// Re-export video transform configuration types
export type { ShowLanguageConfig, VideoTransformsConfig } from '../transforms/types.js';
export {
  DEFAULT_SHOW_LANGUAGE_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
} from '../transforms/types.js';
