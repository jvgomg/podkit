/**
 * Shared device opening logic
 *
 * Encapsulates the type-check → capability-resolution → adapter-opening
 * pattern shared between sync.ts and device.ts.
 *
 * Callers pass the dynamically-imported `@podkit/core` module to avoid
 * triggering eager static imports of native bindings.
 *
 * @module
 */

import type { DeviceAdapter, DeviceCapabilities, IpodDatabase } from '@podkit/core';
import { resolveIpodModel } from '@podkit/devices-ipod';
import type { DeviceConfig, PodkitConfig } from '../config/types.js';

// =============================================================================
// Types
// =============================================================================

/** Result of opening a device */
export interface OpenDeviceResult {
  /** The opened adapter (works for any device type) */
  adapter: DeviceAdapter;
  /** Resolved capabilities for this device */
  capabilities: DeviceCapabilities;
  /** Whether the device supports ALAC playback */
  deviceSupportsAlac: boolean;
  /** Whether this is an iPod device (type undefined or 'ipod') */
  isIpodDevice: boolean;
  /**
   * Raw IpodDatabase handle — only set for iPod devices.
   * Use for iPod-specific operations (validation, generation info, playlists).
   * Prefer DeviceAdapter methods for everything else.
   */
  ipod?: IpodDatabase;
}

/**
 * The subset of `@podkit/core` needed by openDevice.
 * Callers pass the dynamically-imported module to avoid eager native loading.
 */
export type CoreModule = typeof import('@podkit/core');

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a device type represents a mass-storage device (not iPod).
 */
export function isMassStorageDevice(type: string | undefined): boolean {
  return type !== undefined && type !== 'ipod';
}

/**
 * Get a human-readable display name for a device type.
 */
export function getDeviceTypeDisplayName(type: string | undefined): string {
  switch (type) {
    case 'echo-mini':
      return 'Echo Mini';
    case 'rockbox':
      return 'Rockbox';
    case 'generic':
      return 'Generic mass-storage';
    case 'ipod':
      return 'iPod';
    default:
      return 'iPod'; // backward compat: undefined = iPod
  }
}

/**
 * Get a device label for user-facing messages based on device config type.
 */
export function getDeviceLabel(type: string | undefined): string {
  return isMassStorageDevice(type) ? getDeviceTypeDisplayName(type) : 'iPod';
}

/**
 * Build capability overrides from device config fields.
 *
 * Per-device config takes priority over global deviceDefaults (from env vars).
 */
function buildCapabilityOverrides(
  deviceConfig: DeviceConfig,
  deviceDefaults?: PodkitConfig['deviceDefaults']
): Partial<import('@podkit/core').DeviceCapabilities> | undefined {
  const overrides: Partial<import('@podkit/core').DeviceCapabilities> = {};
  let hasOverrides = false;

  const artworkMaxRes = deviceConfig.artworkMaxResolution ?? deviceDefaults?.artworkMaxResolution;
  if (artworkMaxRes !== undefined) {
    overrides.artworkMaxResolution = artworkMaxRes;
    hasOverrides = true;
  }

  const artworkSources = deviceConfig.artworkSources ?? deviceDefaults?.artworkSources;
  if (artworkSources !== undefined) {
    overrides.artworkSources = artworkSources;
    hasOverrides = true;
  }

  const supportedCodecs = deviceConfig.supportedAudioCodecs ?? deviceDefaults?.supportedAudioCodecs;
  if (supportedCodecs !== undefined) {
    overrides.supportedAudioCodecs = supportedCodecs;
    hasOverrides = true;
  }

  const supportsVideo = deviceConfig.supportsVideo ?? deviceDefaults?.supportsVideo;
  if (supportsVideo !== undefined) {
    overrides.supportsVideo = supportsVideo;
    hasOverrides = true;
  }

  const audioNormalization = deviceConfig.audioNormalization ?? deviceDefaults?.audioNormalization;
  if (audioNormalization !== undefined) {
    overrides.audioNormalization = audioNormalization;
    hasOverrides = true;
  }

  const supportsAlbumArtistBrowsing =
    deviceConfig.supportsAlbumArtistBrowsing ?? deviceDefaults?.supportsAlbumArtistBrowsing;
  if (supportsAlbumArtistBrowsing !== undefined) {
    overrides.supportsAlbumArtistBrowsing = supportsAlbumArtistBrowsing;
    hasOverrides = true;
  }

  return hasOverrides ? overrides : undefined;
}

// =============================================================================
// openDevice
// =============================================================================

/**
 * Open a device by resolving its type, capabilities, and adapter.
 *
 * Encapsulates the branching logic for iPod vs mass-storage devices:
 * - iPod: opens IpodDatabase, derives capabilities from generation metadata
 * - Mass-storage: resolves preset capabilities with config overrides, opens MassStorageAdapter
 *
 * @param core - Dynamically-imported `@podkit/core` module
 * @param path - Mount point / device path
 * @param deviceConfig - Optional device config from TOML (provides type, capability overrides)
 * @param deviceDefaults - Optional global device defaults from env vars (fallback for mass-storage)
 * @returns OpenDeviceResult with adapter, capabilities, and iPod handle if applicable
 *
 * @throws {Error} If the device fails to open (database missing, path invalid, etc.)
 * @throws {Error} If the device type is unknown (no matching preset)
 */
export async function openDevice(
  core: CoreModule,
  path: string,
  deviceConfig?: DeviceConfig,
  deviceDefaults?: PodkitConfig['deviceDefaults']
): Promise<OpenDeviceResult> {
  const deviceType = deviceConfig?.type;
  const isIpod = !deviceType || deviceType === 'ipod';

  if (isIpod) {
    // iPod: open database, derive capabilities via identifyCapabilities
    const ipod = await core.IpodDatabase.open(path);
    const ipodDeviceInfo = ipod.getInfo().device;

    // Resolve libgpod device info → IpodModel → DeviceCapabilities
    const model = resolveIpodModel({
      modelNumStr: ipodDeviceInfo.modelNumber ?? undefined,
      libgpodGeneration: ipodDeviceInfo.generation,
    });
    if (!model) {
      throw new Error(
        `Could not identify iPod model from libgpod data (generation="${ipodDeviceInfo.generation}"). ` +
          `Try specifying --type ipod or reconnecting the device.`
      );
    }
    const capabilities = core.identifyCapabilities(model);

    const deviceSupportsAlac = capabilities.supportedAudioCodecs.includes('alac');

    const adapter = new core.IpodDeviceAdapter(ipod, capabilities);

    return {
      adapter,
      capabilities,
      deviceSupportsAlac,
      isIpodDevice: true,
      ipod,
    };
  }

  // Mass-storage device: resolve preset + config overrides + env defaults
  const overrides = deviceConfig
    ? buildCapabilityOverrides(deviceConfig, deviceDefaults)
    : deviceDefaults
      ? buildCapabilityOverrides({}, deviceDefaults)
      : undefined;

  // Build a synthetic MassStorageIdentity and dispatch via resolveCapabilities
  const massStorageIdentity: import('@podkit/core').MassStorageIdentity = {
    kind: 'mass-storage',
    presetId: deviceType!,
  };
  let resolvedCaps: import('@podkit/core').DeviceCapabilities;
  try {
    resolvedCaps = core.resolveCapabilities(massStorageIdentity, {
      overrides: overrides ?? undefined,
    });
  } catch {
    throw new Error(`Unknown device type: ${deviceType}`);
  }

  // Resolve content paths: preset defaults < global deviceDefaults < per-device config
  const { BUILT_IN_PRESETS } = await import('@podkit/devices-mass-storage');
  const builtInPreset = BUILT_IN_PRESETS[deviceType! as keyof typeof BUILT_IN_PRESETS];
  const presetDefaults = builtInPreset?.contentPaths;
  const contentPathOverrides: Partial<import('@podkit/core').ContentPaths> = {};
  // Apply global deviceDefaults as fallback
  if (deviceDefaults?.musicDir !== undefined)
    contentPathOverrides.musicDir = deviceDefaults.musicDir;
  if (deviceDefaults?.moviesDir !== undefined)
    contentPathOverrides.moviesDir = deviceDefaults.moviesDir;
  if (deviceDefaults?.tvShowsDir !== undefined)
    contentPathOverrides.tvShowsDir = deviceDefaults.tvShowsDir;
  // Apply per-device config (highest priority)
  if (deviceConfig?.musicDir !== undefined) contentPathOverrides.musicDir = deviceConfig.musicDir;
  if (deviceConfig?.moviesDir !== undefined)
    contentPathOverrides.moviesDir = deviceConfig.moviesDir;
  if (deviceConfig?.tvShowsDir !== undefined)
    contentPathOverrides.tvShowsDir = deviceConfig.tvShowsDir;

  const hasOverrides = Object.keys(contentPathOverrides).length > 0;
  const contentPaths =
    hasOverrides || presetDefaults
      ? core.normalizeContentPaths(contentPathOverrides, presetDefaults)
      : undefined;

  // Resolve pathTemplate: per-device config > global deviceDefaults > adapter default
  const pathTemplate = deviceConfig?.pathTemplate ?? deviceDefaults?.pathTemplate;

  const adapterOptions =
    contentPaths || pathTemplate !== undefined
      ? { ...(contentPaths ? { contentPaths } : {}), ...(pathTemplate ? { pathTemplate } : {}) }
      : undefined;
  const adapter = await core.MassStorageAdapter.open(path, resolvedCaps, adapterOptions);

  return {
    adapter,
    capabilities: resolvedCaps,
    deviceSupportsAlac: resolvedCaps.supportedAudioCodecs.includes('alac'),
    isIpodDevice: false,
  };
}
