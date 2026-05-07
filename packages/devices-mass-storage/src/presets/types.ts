/**
 * Mass-storage preset types
 *
 * Type definitions for device capability presets used by mass-storage DAPs
 * (Echo Mini, Rockbox, generic players, and user-defined devices).
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';

// =============================================================================
// Content Paths
// =============================================================================

/**
 * Default content directory paths on a mass-storage device.
 * Each field is a device-relative directory path (no leading slash).
 * An empty string means the device root.
 */
export interface ContentPaths {
  /** Root directory for music tracks (empty string = device root) */
  musicDir: string;
  /** Root directory for movie files */
  moviesDir: string;
  /** Root directory for TV show files */
  tvShowsDir: string;
}

/**
 * Default content directory layout used by Rockbox and generic presets.
 *
 * This is the canonical home for `DEFAULT_CONTENT_PATHS`. The copy in
 * `podkit-core/device/mass-storage-utils.ts` re-exports from here for
 * backward-compatibility and is scheduled for removal at m-8.
 */
export const DEFAULT_CONTENT_PATHS: ContentPaths = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};

// =============================================================================
// Preset IDs
// =============================================================================

/**
 * Identifiers for the built-in mass-storage device presets shipped with podkit.
 */
export const BUILT_IN_PRESET_IDS = ['echo-mini', 'rockbox', 'generic'] as const;

/** Literal union of built-in preset IDs. */
export type BuiltInPresetId = (typeof BUILT_IN_PRESET_IDS)[number];

/**
 * A preset ID is either one of the built-in names or any user-supplied string.
 *
 * The `string & {}` intersection keeps the literal suggestions in IDE
 * autocomplete while accepting arbitrary strings at runtime.
 */
export type PresetId = BuiltInPresetId | (string & {});

// =============================================================================
// Preset interface
// =============================================================================

/**
 * A fully-resolved mass-storage device preset.
 *
 * Combines a `DeviceCapabilities` snapshot (what the device can do) with
 * the default content directory paths used when writing files to the device.
 *
 * The optional `extends` field names another preset ID whose values are used
 * as the baseline before this preset's own fields are applied. Resolution
 * happens at construction time in `definePreset()` — the stored preset is
 * always fully resolved; no chained lookups at runtime.
 */
export interface MassStoragePreset extends DeviceCapabilities {
  /** Default content directory paths on this device */
  contentPaths: ContentPaths;
  /**
   * ID of a preset this one extends (resolved at construction time).
   * Present only in `PresetDefinition` input; absent in fully-resolved presets.
   *
   * @internal Populated by `definePreset()` before storing. Not present on
   * built-in presets (they are already fully resolved).
   */
  extends?: PresetId;
}
