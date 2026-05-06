/**
 * Mass-storage device capability resolution
 *
 * Resolves a `DeviceCapabilities` for a mass-storage device from its identity
 * and the active preset registry.
 *
 * Resolution order (last wins):
 *   1. Preset capabilities (after extends-resolution at preset-construction time)
 *   2. Per-call overrides (opts.overrides)
 *
 * Arrays replace entirely rather than merging element-by-element, consistent
 * with `resolveCapabilities` in podkit-core.
 *
 * @module
 */

import type { DeviceCapabilities, MassStorageIdentity } from '@podkit/device-types';
import type { MassStoragePreset } from './presets/types.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';

// =============================================================================
// Types
// =============================================================================

export interface GetCapabilitiesOptions {
  /**
   * All presets in scope (built-in + user-registered).
   * Must contain an entry for the preset id referenced by the identity, unless
   * the identity has no presetId (falls back to 'generic').
   */
  presets: Record<string, MassStoragePreset>;
  /**
   * Per-call capability overrides applied last.
   *
   * Useful for "two Echo Minis configured differently" — pass different
   * override maps for each device without touching the shared preset registry.
   */
  overrides?: Partial<DeviceCapabilities>;
}

// =============================================================================
// getCapabilities
// =============================================================================

/**
 * Resolve the `DeviceCapabilities` for a mass-storage device.
 *
 * Preset lookup order:
 *   1. `identity.presetId` in `opts.presets` (user-registered or built-in)
 *   2. `identity.presetId` in the global `BUILT_IN_PRESETS` (fallback)
 *   3. `'generic'` in `opts.presets` (final fallback when no presetId)
 *
 * @param identity - Result of `identify()` — carries the `presetId` that selects the preset.
 * @param opts - Required; must supply `presets` map and optionally per-call `overrides`.
 * @returns `DeviceCapabilities` suitable for the sync engine and transcoding pipeline.
 *
 * @throws if no matching preset is found and 'generic' is also absent.
 *
 * @example
 * ```ts
 * import { identify, getCapabilities, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
 *
 * const identity = identify({ vendorId: '0x071b', productId: '0x3203' });
 * if (identity) {
 *   const caps = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
 *   // → { supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav'], ... }
 * }
 * ```
 */
export function getCapabilities(
  identity: MassStorageIdentity,
  opts: GetCapabilitiesOptions
): DeviceCapabilities {
  const presetId = identity.presetId ?? 'generic';

  // Resolve preset — check opts.presets first, then built-ins
  const preset: MassStoragePreset | undefined =
    opts.presets[presetId] ?? BUILT_IN_PRESETS[presetId as keyof typeof BUILT_IN_PRESETS];

  if (!preset) {
    throw new Error(
      `getCapabilities: no preset found for id "${presetId}". ` +
        `Register the preset in opts.presets or use a built-in id.`
    );
  }

  // Extract DeviceCapabilities fields from the preset (excluding contentPaths)
  const base: DeviceCapabilities = {
    artworkSources: preset.artworkSources,
    artworkMaxResolution: preset.artworkMaxResolution,
    supportedAudioCodecs: preset.supportedAudioCodecs,
    supportsVideo: preset.supportsVideo,
    audioNormalization: preset.audioNormalization,
    supportsAlbumArtistBrowsing: preset.supportsAlbumArtistBrowsing,
  };

  if (!opts.overrides) {
    return base;
  }

  // Arrays replace entirely (not concatenated) — mirrors resolveDeviceCapabilities semantics
  return {
    artworkSources: opts.overrides.artworkSources ?? base.artworkSources,
    artworkMaxResolution: opts.overrides.artworkMaxResolution ?? base.artworkMaxResolution,
    supportedAudioCodecs: opts.overrides.supportedAudioCodecs ?? base.supportedAudioCodecs,
    supportsVideo: opts.overrides.supportsVideo ?? base.supportsVideo,
    audioNormalization: opts.overrides.audioNormalization ?? base.audioNormalization,
    supportsAlbumArtistBrowsing:
      opts.overrides.supportsAlbumArtistBrowsing ?? base.supportsAlbumArtistBrowsing,
  };
}
