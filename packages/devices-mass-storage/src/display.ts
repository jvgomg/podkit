/**
 * Display-string helpers for mass-storage presets.
 *
 * Presets carry the human-facing strings (`manufacturer`, `productName`)
 * directly; the helpers compose them so the CLI's display layer never has
 * to hard-code per-id labels (it previously did, in
 * `commands/open-device.ts:getDeviceTypeDisplayName`).
 *
 * @module
 */

import type { MassStoragePreset } from './presets/types.js';

/**
 * Rich label for a preset — vendor, product, and the preset id (the
 * exact `--type` token). Used in `device add` output and anywhere a
 * one-line full identification is appropriate.
 *
 * The `id` is the lookup key in `BUILT_IN_PRESETS` / a user-defined
 * preset registry; it's required because `MassStoragePreset` itself
 * doesn't carry the id (the id is the *map key*, not a field on the
 * value — see the `Record<PresetId, MassStoragePreset>` shape in
 * `presets/built-in.ts`).
 *
 * @example formatPresetDisplay('echo-mini', BUILT_IN_PRESETS['echo-mini'])
 *   → 'FiiO Snowsky Echo Mini (echo-mini)'
 */
export function formatPresetDisplay(id: string, preset: MassStoragePreset): string {
  return `${preset.manufacturer} ${preset.productName} (${id})`;
}

/**
 * Short label for a preset — just the product name. Used in compact
 * contexts like `device list` table cells where the manufacturer + id
 * would be noise.
 *
 * @example formatPresetShortDisplay(BUILT_IN_PRESETS['echo-mini'])
 *   → 'Echo Mini'
 */
export function formatPresetShortDisplay(preset: MassStoragePreset): string {
  return preset.productName;
}
