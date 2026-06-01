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

import type {
  DeviceCapabilities,
  MassStorageIdentity,
  ResolvedDeviceCapabilities,
  CapabilitySource,
} from '@podkit/device-types';
import { projectResolved, resolveChain } from '@podkit/device-types';
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
   *
   * Provenance-collapsed: callers that distinguish per-device TOML from
   * env-driven device defaults should use {@link getCapabilitiesResolved}
   * with `deviceConfigOverrides` / `deviceDefaultsOverrides` instead.
   */
  overrides?: Partial<DeviceCapabilities>;
}

/**
 * Options for {@link getCapabilitiesResolved} — the provenance-aware
 * variant. Splits the formerly-opaque `overrides` blob into the two
 * layers that actually feed it (per-device TOML and env-var-driven
 * device defaults), so the resolver can attribute each field correctly.
 */
export interface GetCapabilitiesResolvedOptions {
  presets: Record<string, MassStoragePreset>;
  /**
   * Per-device TOML overrides. Highest priority — wins over device
   * defaults and the preset baseline.
   */
  deviceConfigOverrides?: Partial<DeviceCapabilities>;
  /**
   * Global device defaults from env vars
   * (`PODKIT_ARTWORK_MAX_RESOLUTION`, etc.). Sits between per-device
   * config and the preset.
   */
  deviceDefaultsOverrides?: Partial<DeviceCapabilities>;
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
 *   // → { supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'], ... }
 * }
 * ```
 */
export function getCapabilities(
  identity: MassStorageIdentity,
  opts: GetCapabilitiesOptions
): DeviceCapabilities {
  // Backward-compat wrapper: route through the provenance-aware
  // resolver, then strip the `{ value, source }` shell via
  // `projectResolved`. The cast handles `containerConstraints?` —
  // `projectResolved` walks `Object.keys` and skips undefined entries
  // at runtime, but the mapped type loses the optional marker.
  const resolved = getCapabilitiesResolved(identity, {
    presets: opts.presets,
    deviceConfigOverrides: opts.overrides,
  });
  return projectResolved(resolved) as DeviceCapabilities;
}

/**
 * Provenance-aware variant of {@link getCapabilities}. Splits the
 * formerly-collapsed `overrides` into per-device and device-defaults
 * layers so each field's resolved value carries the inheritance source
 * it came from.
 *
 * Resolution order per field (highest priority first):
 *   device-config → device-defaults → preset
 *
 * Each layer walked through the shared `resolveChain` primitive in
 * `@podkit/device-types`. Same merge semantics as {@link getCapabilities};
 * the only addition is the `{ value, source }` shape.
 *
 * @example
 * ```ts
 * const resolved = getCapabilitiesResolved(identity, {
 *   presets: BUILT_IN_PRESETS,
 *   deviceConfigOverrides: { artworkMaxResolution: 96 },
 * });
 * // → resolved.artworkMaxResolution = { value: 96, source: 'device-config' }
 * // → resolved.artworkSources       = { value: ['embedded'], source: 'preset' }
 * ```
 */
export function getCapabilitiesResolved(
  identity: MassStorageIdentity,
  opts: GetCapabilitiesResolvedOptions
): ResolvedDeviceCapabilities {
  const presetId = identity.presetId ?? 'generic';

  const preset: MassStoragePreset | undefined =
    opts.presets[presetId] ?? BUILT_IN_PRESETS[presetId as keyof typeof BUILT_IN_PRESETS];

  if (!preset) {
    throw new Error(
      `getCapabilities: no preset found for id "${presetId}". ` +
        `Register the preset in opts.presets or use a built-in id.`
    );
  }

  const cfg = opts.deviceConfigOverrides;
  const defaults = opts.deviceDefaultsOverrides;

  // Field-by-field walk. Layers in priority order — the chain helper
  // returns the first defined hit. `'preset'` is always the bottom
  // because every preset is required to populate every field (the
  // extends chain in `definePreset` guarantees this).
  return {
    artworkSources: resolveChain<
      import('@podkit/device-types').DeviceArtworkSource[],
      CapabilitySource
    >(
      [
        { value: cfg?.artworkSources, source: 'device-config' },
        { value: defaults?.artworkSources, source: 'device-defaults' },
      ],
      preset.artworkSources,
      'preset'
    ),
    artworkMaxResolution: resolveChain<number | null, CapabilitySource>(
      [
        { value: cfg?.artworkMaxResolution, source: 'device-config' },
        { value: defaults?.artworkMaxResolution, source: 'device-defaults' },
      ],
      preset.artworkMaxResolution,
      'preset'
    ),
    supportedAudioCodecs: resolveChain<
      import('@podkit/device-types').AudioCodec[],
      CapabilitySource
    >(
      [
        { value: cfg?.supportedAudioCodecs, source: 'device-config' },
        { value: defaults?.supportedAudioCodecs, source: 'device-defaults' },
      ],
      preset.supportedAudioCodecs,
      'preset'
    ),
    supportsVideo: resolveChain<boolean, CapabilitySource>(
      [
        { value: cfg?.supportsVideo, source: 'device-config' },
        { value: defaults?.supportsVideo, source: 'device-defaults' },
      ],
      preset.supportsVideo,
      'preset'
    ),
    audioNormalization: resolveChain<
      import('@podkit/device-types').AudioNormalizationMode,
      CapabilitySource
    >(
      [
        { value: cfg?.audioNormalization, source: 'device-config' },
        { value: defaults?.audioNormalization, source: 'device-defaults' },
      ],
      preset.audioNormalization,
      'preset'
    ),
    supportsAlbumArtistBrowsing: resolveChain<boolean, CapabilitySource>(
      [
        { value: cfg?.supportsAlbumArtistBrowsing, source: 'device-config' },
        { value: defaults?.supportsAlbumArtistBrowsing, source: 'device-defaults' },
      ],
      preset.supportsAlbumArtistBrowsing,
      'preset'
    ),
    // Container constraints are sparse — only emit a resolved entry when
    // at least one layer supplied them. Skipping the chain when nothing
    // contributes keeps the output shape consistent with
    // `DeviceCapabilities.containerConstraints?` (also optional).
    containerConstraints:
      cfg?.containerConstraints !== undefined ||
      defaults?.containerConstraints !== undefined ||
      preset.containerConstraints !== undefined
        ? resolveChain<
            Partial<
              Record<
                import('@podkit/device-types').AudioCodec,
                import('@podkit/device-types').AudioContainer[]
              >
            >,
            CapabilitySource
          >(
            [
              { value: cfg?.containerConstraints, source: 'device-config' },
              { value: defaults?.containerConstraints, source: 'device-defaults' },
              { value: preset.containerConstraints, source: 'preset' },
            ],
            {},
            'preset'
          )
        : undefined,
  };
}
