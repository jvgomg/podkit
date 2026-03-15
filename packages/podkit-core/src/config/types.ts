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
