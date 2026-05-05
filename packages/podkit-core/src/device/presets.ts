/**
 * Device capability presets
 *
 * Maps device type identifiers to their known DeviceCapabilities and
 * default content paths. Used by the CLI to resolve capabilities and
 * path defaults when a device type is specified in config.
 *
 * ## Migration note
 *
 * `BUILT_IN_PRESETS`, `MassStoragePreset`, `ContentPaths`, `BuiltInPresetId`,
 * and `PresetId` have moved to `@podkit/devices-mass-storage`. The
 * re-exports below keep existing callers compiling for one release; they will
 * be removed in TASK-295.05 (P4). The runtime functions `getDevicePreset`,
 * `resolveDeviceCapabilities`, `DEVICE_PRESETS`, and the `DeviceTypeId` family
 * remain in core — they are not being migrated.
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import { DEFAULT_CONTENT_PATHS, type ContentPaths } from './mass-storage-utils.js';

// ── Re-export shim: preset types + data moved to @podkit/devices-mass-storage ─
// Remove in TASK-295.05 (P4).

/**
 * @deprecated Moved to `@podkit/devices-mass-storage`. Import from there for
 * new code. Will be removed in TASK-295.05 (P4).
 */
export type {
  ContentPaths as MassStorageContentPaths,
  MassStoragePreset,
  BuiltInPresetId,
  PresetId,
} from '@podkit/devices-mass-storage';

/**
 * @deprecated Moved to `@podkit/devices-mass-storage`. Import from there for
 * new code. Will be removed in TASK-295.05 (P4).
 */
export { BUILT_IN_PRESETS, BUILT_IN_PRESET_IDS } from '@podkit/devices-mass-storage';

/** Built-in mass-storage preset identifiers (excludes 'ipod' which has no preset). */
export const PRESET_DEVICE_TYPE_IDS = ['echo-mini', 'rockbox', 'generic'] as const;
export type PresetDeviceTypeId = (typeof PRESET_DEVICE_TYPE_IDS)[number];

/** Built-in device type identifiers (includes 'ipod' for CLI surface). */
export const BUILT_IN_DEVICE_TYPE_IDS = ['ipod', ...PRESET_DEVICE_TYPE_IDS] as const;
export type BuiltInDeviceTypeId = (typeof BUILT_IN_DEVICE_TYPE_IDS)[number];

/**
 * Supported device type identifiers.
 *
 * Built-in ids autocomplete and type-check. Custom user-registered preset ids
 * are accepted at runtime via the `(string & {})` companion — preserves
 * literal-union autocomplete while allowing arbitrary strings.
 */
export type DeviceTypeId = BuiltInDeviceTypeId | (string & {});

/** A device preset combining capabilities with default content paths */
export interface DevicePreset extends DeviceCapabilities {
  contentPaths: ContentPaths;
}

/**
 * Presets for known device types.
 *
 * iPod is not included here — its capabilities are derived from
 * generation metadata via getDeviceCapabilities() in ipod/capabilities.ts.
 */
export const DEVICE_PRESETS: Record<PresetDeviceTypeId, DevicePreset> = {
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

/**
 * Get the preset for a device type.
 *
 * @param deviceType - Device type identifier
 * @returns DevicePreset for the device type, or undefined if not a preset type
 */
export function getDevicePreset(deviceType: string): DevicePreset | undefined {
  return DEVICE_PRESETS[deviceType as PresetDeviceTypeId];
}

/**
 * Resolve device capabilities by merging preset defaults with user overrides.
 *
 * Starts with the preset for the given device type, then applies any
 * explicitly provided overrides on top. For array fields (artworkSources,
 * supportedAudioCodecs), overrides replace the entire array rather than
 * merging element-by-element.
 *
 * @param deviceType - Device type identifier (e.g., 'generic', 'echo-mini')
 * @param overrides - Optional partial capability overrides from user config
 * @returns Merged DeviceCapabilities, or undefined if deviceType has no preset
 */
export function resolveDeviceCapabilities(
  deviceType: string,
  overrides?: Partial<DeviceCapabilities>
): DeviceCapabilities | undefined {
  const preset = getDevicePreset(deviceType);
  if (!preset) return undefined;

  if (!overrides) return preset;

  return {
    artworkSources: overrides.artworkSources ?? preset.artworkSources,
    artworkMaxResolution: overrides.artworkMaxResolution ?? preset.artworkMaxResolution,
    supportedAudioCodecs: overrides.supportedAudioCodecs ?? preset.supportedAudioCodecs,
    supportsVideo: overrides.supportsVideo ?? preset.supportsVideo,
    audioNormalization: overrides.audioNormalization ?? preset.audioNormalization,
    supportsAlbumArtistBrowsing:
      overrides.supportsAlbumArtistBrowsing ?? preset.supportsAlbumArtistBrowsing,
  };
}
