/**
 * Config resolution with provenance tracking
 *
 * Resolves the effective value for each config setting through the
 * inheritance chain (device → global → default), tracking where
 * each value came from so callers can display provenance.
 *
 * @module
 */

import type { QualityPreset, VideoQualityPreset, DeviceCapabilities } from '@podkit/core';
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

/** A resolved value with its provenance */
export interface ResolvedValue<T> {
  value: T;
  source: ConfigSource;
}

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
  isDefault: boolean;
  connected: boolean;
  quality: ResolvedValue<QualityPreset>;
  audio: ResolvedValue<QualityPreset>;
  video: ResolvedValue<VideoQualityPreset | null>;
  artwork: ResolvedValue<boolean | null>;
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
 */
export function resolveDeviceSettings(
  config: PodkitConfig,
  deviceName: string,
  deviceConfig: DeviceConfig,
  capabilities: DeviceCapabilities | null,
  connected: boolean,
  isDefault: boolean
): ResolvedDeviceSettings {
  const type = deviceConfig.type ?? 'ipod';
  const quality = resolveDeviceQuality(config, deviceConfig);

  return {
    name: deviceName,
    type,
    isDefault,
    connected,
    quality,
    audio: resolveDeviceAudio(config, deviceConfig, quality),
    video: resolveDeviceVideo(config, deviceConfig, quality, capabilities),
    artwork: resolveDeviceArtwork(config, deviceConfig, capabilities),
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
 *   1. Check capability (unsupported/unknown)
 *   2. device.artwork → global.artwork
 */
function resolveDeviceArtwork(
  config: PodkitConfig,
  deviceConfig: DeviceConfig,
  capabilities: DeviceCapabilities | null
): ResolvedValue<boolean | null> {
  // Check device capability first
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
export function formatResolved(resolved: ResolvedValue<unknown>): string {
  if (resolved.source === 'unsupported') return '\u2717'; // ✗
  if (resolved.source === 'unknown') return '?';

  const display = formatValue(resolved.value);

  if (resolved.source === 'device') return display;

  // Everything else is inherited — wrap in brackets
  return `[${display}]`;
}

/**
 * Format a resolved value for the global config line.
 *
 * - Values explicitly set: shown as-is
 * - Values inherited from unified quality or defaults: wrapped in [brackets]
 */
export function formatGlobalResolved(resolved: ResolvedValue<unknown>): string {
  const display = formatValue(resolved.value);

  if (resolved.source === 'global') return display;

  // Inherited from quality or default — wrap in brackets
  return `[${display}]`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}
