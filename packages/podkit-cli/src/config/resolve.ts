/**
 * Config resolution with provenance tracking
 *
 * Resolves the effective value for each config setting through the
 * inheritance chain (device → global → default), tracking where
 * each value came from so callers can display provenance.
 *
 * @module
 */

import type {
  QualityPreset,
  VideoQualityPreset,
  DeviceCapabilities,
  EncodingMode,
  TransferMode,
} from '@podkit/core';
import { resolveChain, type Resolved, type CapabilitySource } from '@podkit/device-types';
import type { DeviceConfig, PodkitConfig } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Where a resolved config value came from.
 *
 * Resolution order (first match wins):
 *   device-specific → device-quality → global-specific → global-quality → default
 */
export type ConfigSource =
  | 'default' // hardcoded fallback (e.g. quality='high')
  | 'global' // set at top level in config (e.g. audioQuality='max')
  | 'global-quality' // inherited from global unified quality
  | 'device' // set on the device explicitly (e.g. devices.x.audioQuality)
  | 'device-quality' // inherited from device unified quality
  | 'unsupported' // device doesn't support this capability
  | 'unknown'; // can't determine without device connection

/**
 * A resolved config value with its provenance.
 *
 * Thin alias over the shared `Resolved<T, Source>` primitive from
 * `@podkit/device-types`; the runtime shape is identical. Existing
 * consumers continue to import `ResolvedValue<T>` from here — there's
 * no need to plumb the lower-level type through the CLI surface unless
 * a call site wants to construct one explicitly.
 */
export type ResolvedValue<T> = Resolved<T, ConfigSource>;

/** Resolved global config settings */
export interface ResolvedGlobalConfig {
  quality: ResolvedValue<QualityPreset>;
  audio: ResolvedValue<QualityPreset>;
  video: ResolvedValue<VideoQualityPreset>;
  artwork: ResolvedValue<boolean>;
}

/** Resolved settings for a single device */
export interface ResolvedDeviceSettings {
  name: string;
  type: string;
  /**
   * Resolved display label fields — preset default → per-device config
   * override. Same shape as resolved capabilities, using the
   * `CapabilitySource` union ('preset' | 'device-config'), so
   * `device info` / future provenance consumers can render inheritance
   * markers consistently across capability fields and display labels.
   *
   * Only populated for mass-storage devices that have a known preset;
   * `undefined` for iPods (whose display label comes from libgpod's
   * runtime model name, not a preset).
   */
  manufacturer?: Resolved<string, CapabilitySource>;
  productName?: Resolved<string, CapabilitySource>;
  isDefault: boolean;
  connected: boolean;
  quality: ResolvedValue<QualityPreset>;
  audio: ResolvedValue<QualityPreset>;
  video: ResolvedValue<VideoQualityPreset | null>;
  artwork: ResolvedValue<boolean | null>;
  checkArtwork: ResolvedValue<boolean>;
  skipUpgrades: ResolvedValue<boolean>;
  encoding: ResolvedValue<EncodingMode | undefined>;
  transferMode: ResolvedValue<TransferMode>;
  customBitrate: ResolvedValue<number | undefined>;
  bitrateTolerance: ResolvedValue<number | undefined>;
}

// =============================================================================
// Global resolution
// =============================================================================

/**
 * Resolve global config values with provenance.
 *
 * - quality: global.quality → default('high')
 * - audio: global.audioQuality → global.quality → default('high')
 * - video: global.videoQuality → global.quality → default('high')
 * - artwork: global.artwork → default(true)
 */
export function resolveGlobalConfig(config: PodkitConfig): ResolvedGlobalConfig {
  const quality = resolveGlobalQuality(config);
  return {
    quality,
    audio: resolveGlobalAudio(config, quality),
    video: resolveGlobalVideo(config, quality),
    artwork: resolveGlobalArtwork(config),
  };
}

function resolveGlobalQuality(config: PodkitConfig): ResolvedValue<QualityPreset> {
  // PodkitConfig.quality is always present (required field, defaults to 'high')
  // If it matches the default, it was either explicitly set to 'high' or defaulted.
  // We can't distinguish, but the config loader sets it — treat as 'global' if present
  // in the config file, 'default' only for the hardcoded fallback.
  // Since PodkitConfig always has quality set by the loader, we check if it differs
  // from the hardcoded default to determine source. But the loader always sets it,
  // so we treat it as 'global' — the config file was loaded.
  return { value: config.quality, source: 'global' };
}

function resolveGlobalAudio(
  config: PodkitConfig,
  quality: ResolvedValue<QualityPreset>
): ResolvedValue<QualityPreset> {
  if (config.audioQuality !== undefined) {
    return { value: config.audioQuality, source: 'global' };
  }
  return { value: quality.value, source: 'global-quality' };
}

function resolveGlobalVideo(
  config: PodkitConfig,
  quality: ResolvedValue<QualityPreset>
): ResolvedValue<VideoQualityPreset> {
  if (config.videoQuality !== undefined) {
    return { value: config.videoQuality, source: 'global' };
  }
  return { value: quality.value as VideoQualityPreset, source: 'global-quality' };
}

function resolveGlobalArtwork(config: PodkitConfig): ResolvedValue<boolean> {
  // artwork is always present on PodkitConfig (required, defaults to true)
  return { value: config.artwork, source: 'global' };
}

// =============================================================================
// Device resolution
// =============================================================================

/**
 * Resolve device settings with provenance.
 *
 * @param config - Global config
 * @param deviceName - Device name from config
 * @param deviceConfig - Device config entry
 * @param capabilities - Device capabilities, or null if unknown (disconnected iPod)
 * @param connected - Whether the device is currently connected
 * @param isDefault - Whether this is the default device
 * @param presetDisplay - Preset's default display labels (for mass-storage devices
 *   only). When supplied, manufacturer/productName resolve as
 *   `preset → device-config` with provenance; when omitted (e.g. iPod), the
 *   fields are left undefined on the resolved settings.
 */
export function resolveDeviceSettings(
  config: PodkitConfig,
  deviceName: string,
  deviceConfig: DeviceConfig,
  capabilities: DeviceCapabilities | null,
  connected: boolean,
  isDefault: boolean,
  presetDisplay?: { manufacturer: string; productName: string }
): ResolvedDeviceSettings {
  const type = deviceConfig.type ?? 'ipod';
  const quality = resolveDeviceQuality(config, deviceConfig);

  // Display labels: preset baseline + per-device override. Uses the
  // shared resolveChain with the same `CapabilitySource` union the
  // capability resolver emits, so consumers see one consistent
  // provenance vocabulary across capability + display fields.
  const manufacturer = presetDisplay
    ? resolveChain<string, CapabilitySource>(
        [{ value: deviceConfig.manufacturer, source: 'device-config' }],
        presetDisplay.manufacturer,
        'preset'
      )
    : undefined;
  const productName = presetDisplay
    ? resolveChain<string, CapabilitySource>(
        [{ value: deviceConfig.productName, source: 'device-config' }],
        presetDisplay.productName,
        'preset'
      )
    : undefined;

  return {
    name: deviceName,
    type,
    manufacturer,
    productName,
    isDefault,
    connected,
    quality,
    audio: resolveDeviceAudio(config, deviceConfig, quality),
    video: resolveDeviceVideo(config, deviceConfig, quality, capabilities),
    artwork: resolveDeviceArtwork(config, deviceConfig, capabilities),
    checkArtwork: resolveSimple<boolean>(config.checkArtwork, deviceConfig.checkArtwork, false),
    skipUpgrades: resolveSimple<boolean>(config.skipUpgrades, deviceConfig.skipUpgrades, false),
    encoding: resolveSimple(config.encoding, deviceConfig.encoding, undefined),
    transferMode: resolveSimple(
      config.transferMode,
      deviceConfig.transferMode,
      'fast' as TransferMode
    ),
    customBitrate: resolveSimple(config.customBitrate, deviceConfig.customBitrate, undefined),
    bitrateTolerance: resolveSimple(
      config.bitrateTolerance,
      deviceConfig.bitrateTolerance,
      undefined
    ),
  };
}

// -- Quality ------------------------------------------------------------------

function resolveDeviceQuality(
  config: PodkitConfig,
  deviceConfig: DeviceConfig
): ResolvedValue<QualityPreset> {
  if (deviceConfig.quality !== undefined) {
    return { value: deviceConfig.quality, source: 'device' };
  }
  // Fall through to global quality
  return { value: config.quality, source: 'global-quality' };
}

// -- Audio --------------------------------------------------------------------

/**
 * Audio quality resolution:
 *   device.audioQuality → device.quality → global.audioQuality → global.quality
 */
function resolveDeviceAudio(
  config: PodkitConfig,
  deviceConfig: DeviceConfig,
  quality: ResolvedValue<QualityPreset>
): ResolvedValue<QualityPreset> {
  if (deviceConfig.audioQuality !== undefined) {
    return { value: deviceConfig.audioQuality, source: 'device' };
  }
  if (deviceConfig.quality !== undefined) {
    return { value: deviceConfig.quality, source: 'device-quality' };
  }
  if (config.audioQuality !== undefined) {
    return { value: config.audioQuality, source: 'global' };
  }
  return { value: quality.value, source: quality.source };
}

// -- Video --------------------------------------------------------------------

/**
 * Video quality resolution:
 *   1. Check capability (unsupported/unknown)
 *   2. device.videoQuality → device.quality → global.videoQuality → global.quality → 'high'
 */
function resolveDeviceVideo(
  config: PodkitConfig,
  deviceConfig: DeviceConfig,
  quality: ResolvedValue<QualityPreset>,
  capabilities: DeviceCapabilities | null
): ResolvedValue<VideoQualityPreset | null> {
  // Check device capability first
  if (capabilities === null) {
    return { value: null, source: 'unknown' };
  }
  if (!capabilities.supportsVideo) {
    return { value: null, source: 'unsupported' };
  }

  // Device supports video — resolve quality
  if (deviceConfig.videoQuality !== undefined) {
    return { value: deviceConfig.videoQuality, source: 'device' };
  }
  if (deviceConfig.quality !== undefined) {
    return { value: deviceConfig.quality as VideoQualityPreset, source: 'device-quality' };
  }
  if (config.videoQuality !== undefined) {
    return { value: config.videoQuality, source: 'global' };
  }
  return { value: quality.value as VideoQualityPreset, source: quality.source };
}

// -- Artwork ------------------------------------------------------------------

/**
 * Artwork resolution:
 *   1. Explicit `false` from device or global → honored regardless of
 *      capability state (user intent to disable beats "we don't know yet").
 *   2. Check capability (unsupported/unknown).
 *   3. device.artwork → global.artwork.
 *
 * The explicit-false bypass exists because settings are derived BEFORE
 * device capabilities are loaded in some call paths (see
 * `sync.ts:deriveSettings`). Without the bypass, an explicit `artwork =
 * false` in config would silently resolve to `null` → `unknown` → callsite
 * `?? true` fallback, re-enabling artwork against the user's wishes.
 *
 * No matching bypass for explicit `true` is needed: with null capabilities,
 * the resolver returns `{ value: null, source: 'unknown' }` and the
 * callsite `?? true` falls through to `true` — the same value the user
 * configured. Only the `false` case degrades incorrectly under the default
 * fallback, so only that direction needs the carve-out.
 */
function resolveDeviceArtwork(
  config: PodkitConfig,
  deviceConfig: DeviceConfig,
  capabilities: DeviceCapabilities | null
): ResolvedValue<boolean | null> {
  // Honor explicit disable regardless of capability state — "user said off"
  // beats "we don't know what the device supports."
  if (deviceConfig.artwork === false) {
    return { value: false, source: 'device' };
  }
  if (config.artwork === false) {
    return { value: false, source: 'global' };
  }

  // Check device capability
  if (capabilities === null) {
    return { value: null, source: 'unknown' };
  }
  if (capabilities.artworkSources.length === 0) {
    return { value: null, source: 'unsupported' };
  }

  // Device supports artwork — resolve setting
  if (deviceConfig.artwork !== undefined) {
    return { value: deviceConfig.artwork, source: 'device' };
  }
  return { value: config.artwork, source: 'global' };
}

// -- Simple settings (device → global → default) -----------------------------

/**
 * Generic resolution for simple scalar settings via the shared
 * `resolveChain` primitive. The layer order is (highest priority first):
 * device → global → default. Used for both scalar and boolean settings;
 * a separate `*Boolean` helper is no longer needed because the primitive
 * is generic and `false` is a defined value (the `??` chain happily
 * picked it up before, but only because nullish coalescing distinguishes
 * `undefined` from `false` — same semantic, expressed once).
 */
function resolveSimple<T>(
  globalValue: T | undefined,
  deviceValue: T | undefined,
  defaultValue: T
): ResolvedValue<T> {
  return resolveChain<T, ConfigSource>(
    [
      { value: deviceValue, source: 'device' },
      { value: globalValue, source: 'global' },
    ],
    defaultValue,
    'default'
  );
}

// =============================================================================
// Display helpers
// =============================================================================

/**
 * Format a resolved value for display.
 *
 * - Values explicitly set at the current level: shown as-is
 * - Values inherited from a parent level: wrapped in [brackets]
 * - Unsupported capabilities: ✗
 * - Unknown capabilities: ?
 */
export function formatResolved(
  resolved: { value: unknown; source: string },
  opts: { explicitSources?: readonly string[] } = {}
): string {
  if (resolved.source === 'unsupported') return '\u2717'; // ✗
  if (resolved.source === 'unknown') return '?';

  const display = formatValue(resolved.value);
  const explicit = opts.explicitSources ?? DEFAULT_EXPLICIT_SOURCES;
  return explicit.includes(resolved.source) ? display : `[${display}]`;
}

/**
 * Sources `formatResolved` treats as "explicit at this level" (no brackets)
 * by default.
 *
 * - `'device'` — per-device override on a `ResolvedValue<…>` (ConfigSource).
 * - `'device-config'` — per-device override on a capability `Resolved<…>`
 *   (CapabilitySource — see `@podkit/device-types`). Mass-storage capability
 *   fields use this label; semantically the same as `'device'` for the
 *   inheritance-marker logic.
 */
export const DEFAULT_EXPLICIT_SOURCES: readonly string[] = ['device', 'device-config'];

/**
 * Sources to pass via `formatResolved(r, { explicitSources: GLOBAL_EXPLICIT_SOURCES })`
 * when rendering the `device list` global row.
 */
export const GLOBAL_EXPLICIT_SOURCES: readonly string[] = ['global'];

/**
 * Render a bare cascade value with the canonical CLI vocabulary
 * (`true → 'on'`, `false → 'off'`, everything else `String(value)`).
 *
 * Single source of truth for value-side rendering. Used both internally by
 * `formatResolved` and externally by `capability-summary.ts`'s
 * provenance-less fallback render path so the two surfaces can't disagree
 * on how booleans display.
 */
export function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}
