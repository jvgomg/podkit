/**
 * Device capability presets
 *
 * Maps device type identifiers to their known DeviceCapabilities.
 * Used by the CLI to resolve capabilities when a device type is
 * specified in config without explicit capability overrides.
 *
 * @module
 */

import type { DeviceCapabilities } from './capabilities.js';

/** Supported device type identifiers */
export type DeviceTypeId = 'echo-mini' | 'rockbox' | 'generic';

/**
 * Capability presets for known device types.
 *
 * iPod is not included here — its capabilities are derived from
 * generation metadata via getDeviceCapabilities() in ipod/capabilities.ts.
 */
export const DEVICE_PRESETS: Record<DeviceTypeId, DeviceCapabilities> = {
  'echo-mini': {
    artworkSources: ['embedded'],
    artworkMaxResolution: 600,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav'],
    supportsVideo: false,
  },
  rockbox: {
    artworkSources: ['sidecar', 'embedded'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'opus', 'wav', 'aiff'],
    supportsVideo: false,
  },
  generic: {
    artworkSources: ['embedded'],
    artworkMaxResolution: 500,
    supportedAudioCodecs: ['aac', 'mp3', 'flac'],
    supportsVideo: false,
  },
};

/**
 * Get the capability preset for a device type.
 *
 * @param deviceType - Device type identifier
 * @returns DeviceCapabilities for the device type, or undefined if not a preset type
 */
export function getDevicePreset(deviceType: string): DeviceCapabilities | undefined {
  return DEVICE_PRESETS[deviceType as DeviceTypeId];
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
  };
}
