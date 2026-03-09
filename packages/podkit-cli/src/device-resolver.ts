/**
 * Device path resolution
 *
 * Centralizes the logic for finding the iPod mount point.
 * Priority order:
 *   1. CLI --device flag (explicit override)
 *   2. Named device from -d flag (lookup in config.devices)
 *   3. Default device from config.defaults.device
 *   4. Auto-detect via Volume UUID (from resolved device config)
 */

import type { PodkitConfig, DeviceConfig } from './config/index.js';
import type { DeviceManager, PlatformDeviceInfo } from '@podkit/core';

/**
 * Device identity for resolution
 *
 * This is passed to resolveDevicePath when we have a resolved device.
 */
export interface DeviceIdentity {
  volumeUuid: string;
  volumeName: string;
}

/**
 * Result of device resolution
 */
export interface ResolveDeviceResult {
  /** Resolved device path, if found */
  path?: string;
  /** How the device was found */
  source: 'cli' | 'uuid' | 'config' | 'none';
  /** Device info if found via UUID */
  deviceInfo?: PlatformDeviceInfo;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Options for device resolution
 */
export interface ResolveDeviceOptions {
  /** CLI --device flag value */
  cliDevice?: string;
  /** Device identity for UUID-based resolution */
  deviceIdentity?: DeviceIdentity;
  /** Device manager instance */
  manager: DeviceManager;
  /** Whether to require the device to be mounted */
  requireMounted?: boolean;
  /** Suppress console output */
  quiet?: boolean;
}

/**
 * Resolve the iPod device path
 *
 * Priority:
 * 1. CLI --device flag (always wins)
 * 2. Auto-detect via Volume UUID from device identity
 */
export async function resolveDevicePath(
  options: ResolveDeviceOptions
): Promise<ResolveDeviceResult> {
  const { cliDevice, deviceIdentity, manager, requireMounted = true } = options;

  // 1. CLI --device flag takes precedence
  if (cliDevice) {
    return {
      path: cliDevice,
      source: 'cli',
    };
  }

  // 2. Try auto-detect via Volume UUID
  if (deviceIdentity?.volumeUuid) {
    const device = await manager.findByVolumeUuid(deviceIdentity.volumeUuid);

    if (device) {
      if (requireMounted) {
        if (device.isMounted && device.mountPoint) {
          return {
            path: device.mountPoint,
            source: 'uuid',
            deviceInfo: device,
          };
        } else {
          return {
            source: 'uuid',
            deviceInfo: device,
            error: 'iPod found but not mounted',
          };
        }
      } else {
        // For mount command - return device info even if not mounted
        return {
          path: device.mountPoint,
          source: 'uuid',
          deviceInfo: device,
        };
      }
    }

    // UUID configured but device not found
    return {
      source: 'none',
      error: `iPod with UUID ${deviceIdentity.volumeUuid} not found. Is it connected?`,
    };
  }

  // No device configured
  return {
    source: 'none',
    error: 'No iPod configured. Run: podkit add-device',
  };
}

/**
 * Format a helpful error message for device resolution failures
 */
export function formatDeviceError(result: ResolveDeviceResult): string {
  if (result.error) {
    return result.error;
  }

  switch (result.source) {
    case 'uuid':
      if (result.deviceInfo && !result.deviceInfo.isMounted) {
        return 'iPod found but not mounted. Run: sudo podkit mount';
      }
      return 'iPod not found';
    case 'none':
      return 'No iPod configured. Run: podkit add-device';
    default:
      return 'Device not found';
  }
}

// =============================================================================
// Named Device Resolution (ADR-008)
// =============================================================================

/**
 * Resolved device information from config
 */
export interface ResolvedDevice {
  /** Device name (key in config.devices) */
  name: string;
  /** Device configuration */
  config: DeviceConfig;
}

/**
 * Resolve a named device from config
 *
 * @param config - The merged config
 * @param deviceName - Optional device name from -d flag
 * @returns Resolved device config or undefined if not found
 */
export function resolveDeviceFromConfig(
  config: PodkitConfig,
  deviceName?: string
): ResolvedDevice | undefined {
  // If a specific device name is given, look it up
  if (deviceName) {
    if (config.devices?.[deviceName]) {
      return {
        name: deviceName,
        config: config.devices[deviceName],
      };
    }
    return undefined; // Device not found
  }

  // Use default device from config
  const defaultDeviceName = config.defaults?.device;
  if (defaultDeviceName && config.devices?.[defaultDeviceName]) {
    return {
      name: defaultDeviceName,
      config: config.devices[defaultDeviceName],
    };
  }

  return undefined;
}

/**
 * Get device identity for device path resolution
 *
 * @param resolvedDevice - The resolved named device, if any
 * @returns Device identity for resolveDevicePath
 */
export function getDeviceIdentity(
  resolvedDevice: ResolvedDevice | undefined
): DeviceIdentity | undefined {
  if (!resolvedDevice) {
    return undefined;
  }

  return {
    volumeUuid: resolvedDevice.config.volumeUuid,
    volumeName: resolvedDevice.config.volumeName,
  };
}

/**
 * Format error message when a named device is not found
 */
export function formatDeviceNotFoundError(
  deviceName: string,
  config: PodkitConfig
): string {
  const availableDevices = config.devices
    ? Object.keys(config.devices).join(', ')
    : '(none)';
  return `Device "${deviceName}" not found in config. Available devices: ${availableDevices}`;
}
