/**
 * Mass-storage device preset constructor
 *
 * `definePreset` is the only way to create a `MassStoragePreset` at runtime.
 * It resolves `extends` chains eagerly at construction time so all downstream
 * lookups operate on fully-resolved presets.
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type {
  BuiltInPresetId,
  ContentPaths,
  MassStoragePreset,
  PresetId,
} from './presets/types.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input shape for `definePreset`.
 *
 * Only `id` is required. Capabilities and content paths can be specified as
 * partial overrides on top of the extended preset (or sensible defaults if no
 * `extends` is given).
 */
export interface PresetDefinition {
  /** Unique identifier for this preset (non-empty string) */
  id: string;
  /**
   * Optional preset id to inherit from.
   * The extended preset is resolved at construction time; the stored preset
   * is always fully resolved.
   */
  extends?: PresetId | BuiltInPresetId;
  /** Capability overrides applied on top of the `extends` baseline */
  capabilities?: Partial<DeviceCapabilities>;
  /** Content-path overrides applied on top of the `extends` baseline */
  contentPaths?: Partial<ContentPaths>;
}

/** Options for `definePreset` */
export interface DefinePresetOptions {
  /**
   * Custom preset registry to resolve `extends` against, in addition to the
   * built-in presets. Pass a partial map of already-constructed presets when
   * building a chain.
   */
  available?: Record<string, MassStoragePreset>;
}

// =============================================================================
// definePreset
// =============================================================================

/**
 * Construct a fully-resolved `MassStoragePreset`.
 *
 * - Pure: no global state, no I/O.
 * - `extends` is resolved eagerly: the stored preset contains the merged result,
 *   not a reference to the parent.
 * - Merge order: extended preset (baseline) → this preset's overrides (last wins).
 * - Arrays replace entirely — not concatenated (consistent with `resolveDeviceCapabilities`).
 * - Infinite `extends` loops are detected and rejected.
 *
 * @param input - Preset definition (id required; capabilities and contentPaths are optional overrides).
 * @param opts - Optional; supply `opts.available` when chaining custom presets that `extend` each other.
 * @returns A fully-resolved `MassStoragePreset` with all `extends` chains collapsed.
 *
 * @throws if `id` is empty.
 * @throws if `extends` references an unknown preset id.
 * @throws if a cycle is detected in the `extends` chain.
 *
 * @example
 * ```ts
 * import { definePreset, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
 *
 * // Custom DAP extending the generic preset
 * const myDap = definePreset({
 *   id: 'my-dap',
 *   extends: 'generic',
 *   capabilities: { supportedAudioCodecs: ['aac', 'mp3', 'flac', 'ogg'] },
 *   contentPaths: { musicDir: 'MUSIC' },
 * });
 *
 * // Two Echo Minis configured differently (without touching the shared preset)
 * const echoMini256 = definePreset({
 *   id: 'echo-mini-256',
 *   extends: 'echo-mini',
 *   capabilities: { artworkMaxResolution: 256 },
 * });
 * ```
 */
export function definePreset(
  input: PresetDefinition,
  opts?: DefinePresetOptions
): MassStoragePreset {
  // Validate id
  if (!input.id || input.id.trim() === '') {
    throw new Error('definePreset: id must be a non-empty string');
  }

  // Resolve the base preset (extends chain)
  const base = input.extends
    ? resolveExtendsChain(input.extends, opts?.available ?? {}, new Set([input.id]))
    : defaultBase();

  // Merge capabilities (arrays replace, scalars overwrite)
  const caps = input.capabilities ?? {};
  const mergedCapabilities: DeviceCapabilities = {
    artworkSources: caps.artworkSources ?? base.artworkSources,
    artworkMaxResolution: caps.artworkMaxResolution ?? base.artworkMaxResolution,
    supportedAudioCodecs: caps.supportedAudioCodecs ?? base.supportedAudioCodecs,
    supportsVideo: caps.supportsVideo ?? base.supportsVideo,
    audioNormalization: caps.audioNormalization ?? base.audioNormalization,
    supportsAlbumArtistBrowsing:
      caps.supportsAlbumArtistBrowsing ?? base.supportsAlbumArtistBrowsing,
  };

  // Merge contentPaths
  const cp = input.contentPaths ?? {};
  const mergedContentPaths: ContentPaths = {
    musicDir: cp.musicDir ?? base.contentPaths.musicDir,
    moviesDir: cp.moviesDir ?? base.contentPaths.moviesDir,
    tvShowsDir: cp.tvShowsDir ?? base.contentPaths.tvShowsDir,
  };

  return {
    ...mergedCapabilities,
    contentPaths: mergedContentPaths,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Returns the 'generic' built-in preset as the default baseline when no
 * `extends` is given. This ensures every preset has sensible defaults.
 *
 * Note: we use 'generic' only as an implicit default when NO extends is
 * specified. Callers can override all fields via capabilities/contentPaths.
 */
function defaultBase(): MassStoragePreset {
  return BUILT_IN_PRESETS['generic'];
}

/**
 * Resolve the base preset for an `extends` reference, following the chain
 * and detecting cycles via the `visited` set.
 *
 * Lookup order: built-ins first, then `available` (custom presets).
 * This means built-in ids always win over custom presets with the same id —
 * consistent with the registry design where built-ins are authoritative.
 */
function resolveExtendsChain(
  extendsId: string,
  available: Record<string, MassStoragePreset>,
  visited: Set<string>
): MassStoragePreset {
  if (visited.has(extendsId)) {
    throw new Error(
      `definePreset: circular extends detected — "${extendsId}" is already in the chain [${[...visited].join(' → ')}]`
    );
  }

  // Check built-ins first
  const builtIn = BUILT_IN_PRESETS[extendsId as BuiltInPresetId];
  if (builtIn) {
    return builtIn;
  }

  // Check custom available presets
  const custom = available[extendsId];
  if (custom) {
    // Custom presets from `available` are already fully resolved (they were
    // produced by a previous `definePreset` call), so no further chain walk.
    return custom;
  }

  throw new Error(`definePreset: extends unknown preset id "${extendsId}"`);
}
