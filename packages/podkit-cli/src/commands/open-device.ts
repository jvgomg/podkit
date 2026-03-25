/**
 * Shared device opening logic
 *
 * Encapsulates the type-check → capability-resolution → adapter-opening
 * pattern that was previously duplicated across sync.ts and device.ts.
 *
 * Callers pass the dynamically-imported `@podkit/core` module to avoid
 * triggering eager static imports of native bindings.
 *
 * @module
 */

import type { DeviceAdapter, DeviceCapabilities, IpodDatabase } from '@podkit/core';
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
    // iPod: open database, derive capabilities from generation
    const ipod = await core.IpodDatabase.open(path);
    const ipodDeviceInfo = ipod.getInfo().device;

    const deviceSupportsAlac = ipodDeviceInfo?.generation
      ? core.supportsAlac(ipodDeviceInfo.generation)
      : false;

    const generationCaps = ipodDeviceInfo?.generation
      ? core.getDeviceCapabilities(ipodDeviceInfo.generation)
      : undefined;

    const capabilities = generationCaps ?? {
      artworkSources: ['database'] as const,
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['aac', 'mp3'] as const,
      supportsVideo: false,
    };

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
  const resolvedCaps = core.resolveDeviceCapabilities(deviceType!, overrides);

  if (!resolvedCaps) {
    throw new Error(`Unknown device type: ${deviceType}`);
  }

  const musicDir = deviceConfig?.musicDir ?? deviceDefaults?.musicDir;
  const adapterOptions = musicDir ? { musicDir } : undefined;
  const adapter = await core.MassStorageAdapter.open(path, resolvedCaps, adapterOptions);

  return {
    adapter,
    capabilities: resolvedCaps,
    deviceSupportsAlac: resolvedCaps.supportedAudioCodecs.includes('alac'),
    isIpodDevice: false,
  };
}
