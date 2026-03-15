/**
 * Clean artists transform
 *
 * Moves "featuring" artists from the Artist field to the Title field.
 * This keeps artist lists clean on iPods (which don't respect Album Artist).
 *
 * Ported from beets ftintitle plugin
 * Original: Copyright 2016, Verrus, <github.com/Verrus/beets-plugin-featInTitle>
 * Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
 * License: MIT
 *
 * @module
 */

import type { TrackTransform, TransformableTrack, CleanArtistsConfig } from '../types.js';
import { DEFAULT_CLEAN_ARTISTS_CONFIG } from '../types.js';
import { applyFtInTitle } from './extract.js';

/**
 * The clean artists transform implementation
 *
 * Transforms track metadata by:
 * 1. Extracting featured artist from the artist field
 * 2. Moving it to the title field (unless `drop` is true)
 *
 * @example
 * // Before
 * { artist: 'Artist A feat. Artist B', title: 'Song Name' }
 *
 * // After (with default config)
 * { artist: 'Artist A', title: 'Song Name (feat. Artist B)' }
 *
 * // After (with drop: true)
 * { artist: 'Artist A', title: 'Song Name' }
 */
export const cleanArtistsTransform: TrackTransform<CleanArtistsConfig> = {
  name: 'cleanArtists',
  defaultConfig: DEFAULT_CLEAN_ARTISTS_CONFIG,

  apply(track: TransformableTrack, config: CleanArtistsConfig): TransformableTrack {
    // If not enabled, return track unchanged
    if (!config.enabled) {
      return track;
    }

    // Apply the transformation
    const result = applyFtInTitle(track.artist, track.title, {
      drop: config.drop,
      format: config.format,
      ignore: config.ignore,
    });

    // If nothing changed, return original track object
    if (!result.changed) {
      return track;
    }

    // Return new track with transformed metadata
    return {
      ...track,
      artist: result.artist,
      title: result.title,
    };
  },
};

// Re-export extraction utilities for direct use
export { applyFtInTitle, extractFeaturedArtist, insertFeatIntoTitle } from './extract.js';
export { titleContainsFeat } from './extract.js';
export { findInsertPosition } from './patterns.js';
