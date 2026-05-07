/**
 * Built-in mass-storage device presets
 *
 * Canonical preset data for all mass-storage DAPs that podkit knows about
 * out of the box.
 *
 * @module
 */

import { DEFAULT_CONTENT_PATHS } from './types.js';
import type { BuiltInPresetId, MassStoragePreset } from './types.js';

// =============================================================================
// Built-in presets
// =============================================================================

/**
 * Preset data for all built-in mass-storage device types.
 *
 * iPod is intentionally absent — its capabilities are derived from
 * generation metadata in `@podkit/devices-ipod`.
 */
export const BUILT_IN_PRESETS: Record<BuiltInPresetId, MassStoragePreset> = {
  'echo-mini': {
    artworkSources: ['embedded'],
    artworkMaxResolution: 127,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
    contentPaths: {
      musicDir: '',
      moviesDir: 'Video/Movies',
      tvShowsDir: 'Video/Shows',
    },
  },
  rockbox: {
    artworkSources: ['sidecar', 'embedded'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'opus', 'wav', 'aiff'],
    supportsVideo: false,
    audioNormalization: 'replaygain',
    supportsAlbumArtistBrowsing: true,
    contentPaths: DEFAULT_CONTENT_PATHS,
  },
  generic: {
    artworkSources: ['embedded'],
    artworkMaxResolution: 500,
    supportedAudioCodecs: ['aac', 'mp3', 'flac'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
    contentPaths: DEFAULT_CONTENT_PATHS,
  },
};
