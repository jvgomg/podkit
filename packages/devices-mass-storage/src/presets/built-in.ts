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
 * Codecs podkit refuses to USE as device-output on mass-storage devices,
 * even when the device firmware can play them. WAV/AIFF tag-writing via
 * node-taglib-sharp is unreliable across containers, so podkit transcodes
 * sources in these formats to a managed codec before transfer.
 *
 * The codecs themselves remain listed in built-in presets (and may be
 * declared by user-supplied presets) for documentation purposes — the
 * presets represent device facts. The sync planner is the gate that
 * actually enforces this policy.
 *
 * `podkit device info` surfaces both views so users can see the gap:
 * the unfiltered "Firmware:" line lists what the device can play, and the
 * "Podkit:" line lists what podkit will actually write (with the gap codecs
 * annotated as "transcoded before transfer"). The filter site is
 * `MassStorageAdapter`'s constructor; the renderer is
 * `packages/podkit-cli/src/commands/device/capability-summary.ts`.
 *
 * Note: iPod is exempt. Its `supportedAudioCodecs` come from libgpod
 * generation metadata and the iPod's iTunesDB carries metadata so the
 * tag-writing limitation does not apply.
 */
export const MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS: readonly string[] = ['wav', 'aiff'];

/**
 * Preset data for all built-in mass-storage device types.
 *
 * iPod is intentionally absent — its capabilities are derived from
 * generation metadata in `@podkit/devices-ipod`.
 *
 * WAV/AIFF appear here as documentation of what the device firmware can
 * play. Podkit will not use them as output formats — see
 * `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`.
 */
export const BUILT_IN_PRESETS: Record<BuiltInPresetId, MassStoragePreset> = {
  'echo-mini': {
    manufacturer: 'FiiO Snowsky',
    productName: 'Echo Mini',
    artworkSources: ['embedded'],
    artworkMaxResolution: 127,
    // Vorbis (not Opus) — Echo Mini firmware hides `.opus` files from both
    // library and folder browser (firsthand-confirmed, devices/echo-mini.md).
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'],
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
    manufacturer: 'Rockbox',
    productName: 'Rockbox device',
    artworkSources: ['sidecar', 'embedded'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'opus', 'wav', 'aiff'],
    supportsVideo: false,
    audioNormalization: 'replaygain',
    supportsAlbumArtistBrowsing: true,
    contentPaths: DEFAULT_CONTENT_PATHS,
  },
  generic: {
    // 'Generic mass-storage device' was the long form podkit shipped before
    // the type carried display metadata. Keep it as the rich label so
    // existing `device add` users see a stable description; the short form
    // is just the product half.
    manufacturer: 'Generic',
    productName: 'Mass-storage device',
    artworkSources: ['embedded'],
    artworkMaxResolution: 500,
    supportedAudioCodecs: ['aac', 'mp3', 'flac'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
    contentPaths: DEFAULT_CONTENT_PATHS,
  },
};
