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
import type { DeviceConfig } from '../config/types.js';

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
 */
function buildCapabilityOverrides(
  deviceConfig: DeviceConfig
): Partial<import('@podkit/core').DeviceCapabilities> | undefined {
  const overrides: Partial<import('@podkit/core').DeviceCapabilities> = {};
  let hasOverrides = false;

  if (deviceConfig.artworkMaxResolution !== undefined) {
    overrides.artworkMaxResolution = deviceConfig.artworkMaxResolution;
    hasOverrides = true;
  }
  if (deviceConfig.artworkSources !== undefined) {
    overrides.artworkSources = deviceConfig.artworkSources;
    hasOverrides = true;
  }
  if (deviceConfig.supportedAudioCodecs !== undefined) {
    overrides.supportedAudioCodecs = deviceConfig.supportedAudioCodecs;
    hasOverrides = true;
  }
  if (deviceConfig.supportsVideo !== undefined) {
    overrides.supportsVideo = deviceConfig.supportsVideo;
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
 * @returns OpenDeviceResult with adapter, capabilities, and iPod handle if applicable
 *
 * @throws {Error} If the device fails to open (database missing, path invalid, etc.)
 * @throws {Error} If the device type is unknown (no matching preset)
 */
export async function openDevice(
  core: CoreModule,
  path: string,
  deviceConfig?: DeviceConfig
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

  // Mass-storage device: resolve preset + config overrides
  const overrides = deviceConfig ? buildCapabilityOverrides(deviceConfig) : undefined;
  const resolvedCaps = core.resolveDeviceCapabilities(deviceType!, overrides);

  if (!resolvedCaps) {
    throw new Error(`Unknown device type: ${deviceType}`);
  }

  const adapter = await core.MassStorageAdapter.open(path, resolvedCaps);

  return {
    adapter,
    capabilities: resolvedCaps,
    deviceSupportsAlac: resolvedCaps.supportedAudioCodecs.includes('alac'),
    isIpodDevice: false,
  };
}
