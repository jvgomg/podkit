/**
 * Merged mass-storage preset registry
 *
 * Combines the canonical `BUILT_IN_PRESETS` from `@podkit/devices-mass-storage`
 * with any user-defined presets parsed from `[presets.<id>]` blocks in the
 * user's config file (stored on `PodkitConfig.presets`).
 *
 * Use `mergedPresets(config)` wherever code currently indexes
 * `BUILT_IN_PRESETS[id]`. Built-in ids are authoritative — `parsePresets`
 * already refuses user `[presets.echo-mini]` collisions at load time.
 *
 * @module
 */

import { BUILT_IN_PRESETS, BUILT_IN_PRESET_IDS } from '@podkit/devices-mass-storage';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';
import type { PartialConfig, PodkitConfig } from './types.js';

// Re-export so command code importing the helpers from this module also
// gets the type from the same boundary, instead of separately reaching
// into `@podkit/devices-mass-storage` for it.
export type { MassStoragePreset };

/**
 * Return the union of built-in presets and user-defined presets resolved at
 * config load time. Built-ins always win on id collision (the loader already
 * refuses such collisions, but the merge order makes the contract explicit).
 */
export function mergedPresets(
  config: PartialConfig | PodkitConfig | undefined
): Record<string, MassStoragePreset> {
  // Always return a fresh frozen object so callers can't mutate
  // `BUILT_IN_PRESETS` via the returned reference, and so accidental
  // writes to individual preset entries fail fast in development.
  // Built-ins win on collision (the loader already refuses such
  // collisions, but the merge order makes it explicit).
  const merged: Record<string, MassStoragePreset> = {
    ...config?.presets,
    ...BUILT_IN_PRESETS,
  };
  for (const id of Object.keys(merged)) {
    Object.freeze(merged[id]);
  }
  return Object.freeze(merged);
}

/**
 * Return the list of all known mass-storage preset ids — built-in plus any
 * user-defined ids in the config. iPod is intentionally absent (it is the
 * iPod provider, not a mass-storage preset).
 */
export function knownPresetIds(config: PartialConfig | PodkitConfig | undefined): string[] {
  const userIds = config?.presets ? Object.keys(config.presets) : [];
  return [...BUILT_IN_PRESET_IDS, ...userIds];
}

/**
 * Return the list of all known device-type ids accepted by `--type`. This is
 * `'ipod'` plus the mass-storage preset ids.
 */
export function knownDeviceTypeIds(config: PartialConfig | PodkitConfig | undefined): string[] {
  return ['ipod', ...knownPresetIds(config)];
}
