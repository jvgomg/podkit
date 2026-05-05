/**
 * Built-in mass-storage device presets
 *
 * Canonical preset data for all mass-storage DAPs that podkit knows about
 * out of the box. Values are verbatim from podkit-core/device/presets.ts and
 * must be kept in sync until the shim in core is replaced (TASK-294.12).
 *
 * Runtime functions (`definePreset`, `identify`, `getCapabilities`,
 * `createMassStorageProvider`) are deferred to TASK-294.05 / 294.06 / 294.07.
 *
 * @module
 */

import type { BuiltInPresetId, ContentPaths, MassStoragePreset } from './types.js';

// =============================================================================
// Default content paths
// =============================================================================

/**
 * Default content directory layout used by Rockbox and generic presets.
 *
 * Mirrors `DEFAULT_CONTENT_PATHS` from `podkit-core/device/mass-storage-utils.ts`.
 * The value is inlined here to avoid a dependency on podkit-core.
 * TASK-294.05 will move `ContentPaths` / `DEFAULT_CONTENT_PATHS` to this
 * package and delete the duplication.
 */
const DEFAULT_CONTENT_PATHS: ContentPaths = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};

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
