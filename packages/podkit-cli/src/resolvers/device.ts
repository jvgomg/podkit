/**
 * Device resolution module
 *
 * Handles resolving iPod devices from:
 * - CLI --device argument (path or name)
 * - Positional argument [name]
 * - Default device from config
 * - Auto-detection via Volume UUID
 */

import * as path from 'node:path';
import type { PodkitConfig, DeviceConfig } from '../config/types.js';
import type { DeviceManager, PlatformDeviceInfo } from '@podkit/core';
import type { ResolvedDevice, DeviceIdentity, CliDeviceArg, ResolutionResult } from './types.js';
import { resolveNamedEntity, isPathLike, formatNotFoundError } from './core.js';

/**
 * Normalize a path for comparison (resolve and remove trailing slashes)
 */
function normalizePath(p: string): string {
  return path.resolve(p);
}

// =============================================================================
// Named Device Resolution
// =============================================================================

/**
 * Resolve a named device from config
 *
 * @param config - The merged config
 * @param deviceName - Optional device name (from CLI arg or positional)
 * @returns Resolution result with device config or error
 *
 * @example
 * ```typescript
 * const result = resolveDevice(config, 'terapod');
 * if (result.success) {
 *   console.log(result.entity.config.volumeUuid);
 * }
 * ```
 */
export function resolveDevice(
  config: PodkitConfig,
  deviceName?: string
): ResolutionResult<DeviceConfig> {
  return resolveNamedEntity({
    entities: config.devices,
    defaultName: config.defaults?.device,
    requestedName: deviceName,
    entityType: 'device',
    addCommand: 'podkit device add -d <name>',
    defaultCommand: 'podkit device default -d <name>',
  });
}

/**
 * Get device identity for path resolution
 *
 * Extracts the volumeUuid and volumeName needed for auto-detection.
 */
export function getDeviceIdentity(device: ResolvedDevice | undefined): DeviceIdentity | undefined {
  if (!device) return undefined;
  return {
    volumeUuid: device.config.volumeUuid,
    volumeName: device.config.volumeName,
  };
}

// =============================================================================
// CLI --device Argument Resolution
// =============================================================================

/**
 * Parse and resolve the --device CLI argument
 *
 * The --device flag accepts either:
 * - A path (e.g., /Volumes/IPOD, ./ipod) - used directly
 * - A named device (e.g., terapod) - looked up in config.devices
 *
 * Resolution logic:
 * 1. If value contains '/' or starts with '.' → treat as path
 * 2. Otherwise → try named device lookup
 * 3. If named device not found → treat as path (will fail gracefully later)
 *
 * @param cliDevice - The --device argument value
 * @param config - The merged config
 * @returns Parsed CLI device argument
 *
 * @example
 * ```typescript
 * // Path-like values
 * parseCliDeviceArg('/Volumes/IPOD', config)
 * // => { type: 'path', path: '/Volumes/IPOD' }
 *
 * // Named device (found)
 * parseCliDeviceArg('terapod', config)
 * // => { type: 'name', name: 'terapod', device: { name: 'terapod', config: {...} } }
 *
 * // Named device (not found - falls back to path)
 * parseCliDeviceArg('unknown', config)
 * // => { type: 'name', name: 'unknown', notFound: true }
 * ```
 */
export function parseCliDeviceArg(
  cliDevice: string | undefined,
  config: PodkitConfig
): CliDeviceArg {
  if (!cliDevice) {
    return { type: 'none' };
  }

  // Path-like values are used directly
  if (isPathLike(cliDevice)) {
    return { type: 'path', path: cliDevice };
  }

  // Try named device lookup
  const result = resolveDevice(config, cliDevice);
  if (result.success) {
    return {
      type: 'name',
      name: cliDevice,
      device: result.entity,
    };
  }

  // Not found as named device - will be treated as path for error handling
  return {
    type: 'name',
    name: cliDevice,
    notFound: true,
  };
}

/**
 * Resolve effective device from CLI args
 *
 * Combines --device flag resolution with positional argument/default resolution.
 * The --device flag takes precedence over positional arguments.
 *
 * @param cliDeviceArg - Parsed --device argument
 * @param positionalName - Device name from positional argument
 * @param config - The merged config
 * @returns Resolution result
 *
 * @example
 * ```typescript
 * const cliArg = parseCliDeviceArg(globalOpts.device, config);
 * const result = resolveEffectiveDevice(cliArg, positionalName, config);
 *
 * if (!result.success) {
 *   console.error(result.error);
 *   return;
 * }
 *
 * const { device, cliPath } = result;
 * // device: ResolvedDevice | undefined (if using named device)
 * // cliPath: string | undefined (if using direct path)
 * ```
 */
export function resolveEffectiveDevice(
  cliDeviceArg: CliDeviceArg,
  positionalName: string | undefined,
  config: PodkitConfig
):
  | { success: true; device?: ResolvedDevice; cliPath?: string }
  | { success: false; error: string } {
  // Case 1: --device provided as path
  if (cliDeviceArg.type === 'path') {
    return { success: true, cliPath: cliDeviceArg.path };
  }

  // Case 2: --device provided as named device
  if (cliDeviceArg.type === 'name') {
    if (cliDeviceArg.device) {
      return { success: true, device: cliDeviceArg.device };
    }
    // Named device not found - return error with helpful message
    const error = formatNotFoundError(cliDeviceArg.name, config.devices, 'device');
    return { success: false, error };
  }

  // Case 3: No --device flag, use positional/default
  const result = resolveDevice(config, positionalName);
  if (result.success) {
    return { success: true, device: result.entity };
  }
  return { success: false, error: result.error };
}

// =============================================================================
// Device Path Resolution (Physical Device Lookup)
// =============================================================================

/**
 * Result of resolving device to physical path
 */
export interface DevicePathResult {
  /** Resolved device path, if found */
  path?: string;
  /** How the device was found */
  source: 'cli' | 'uuid' | 'none';
  /** Device info if found via UUID */
  deviceInfo?: PlatformDeviceInfo;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Options for device path resolution
 */
export interface DevicePathOptions {
  /** CLI --device path value (if path-like) */
  cliPath?: string;
  /** Device identity for UUID-based resolution */
  deviceIdentity?: DeviceIdentity;
  /** Device manager instance */
  manager: DeviceManager;
  /** Whether to require the device to be mounted (default: true) */
  requireMounted?: boolean;
}

/**
 * Resolve device to physical mount path
 *
 * Priority:
 * 1. CLI path (--device /path) - always wins
 * 2. Auto-detect via Volume UUID from device identity
 *
 * @param options - Resolution options
 * @returns Device path result
 */
export async function resolveDevicePath(options: DevicePathOptions): Promise<DevicePathResult> {
  const { cliPath, deviceIdentity, manager, requireMounted = true } = options;

  // Priority 1: CLI path takes precedence
  if (cliPath) {
    // If device has a UUID configured, validate that the device at this path
    // matches the expected UUID. Protects against syncing to the wrong iPod
    // when multiple devices share the same mount point.
    if (deviceIdentity?.volumeUuid) {
      const device = await manager.findByVolumeUuid(deviceIdentity.volumeUuid);
      if (device) {
        // UUID device found — check if it's at the expected path
        if (device.mountPoint && normalizePath(device.mountPoint) !== normalizePath(cliPath)) {
          return {
            source: 'cli',
            error:
              `UUID mismatch: expected device with UUID ${deviceIdentity.volumeUuid}` +
              ` at ${cliPath}, but it is mounted at ${device.mountPoint}.` +
              ` A different iPod may be connected at ${cliPath}.`,
          };
        }
        // UUID matches the device at this path — proceed with device info
        return {
          path: cliPath,
          source: 'cli',
          deviceInfo: device,
        };
      }
      // UUID not found among connected devices — can't validate, proceed with path.
      // This is expected on platforms without device detection (e.g., Linux/Docker).
    }

    return {
      path: cliPath,
      source: 'cli',
    };
  }

  // Priority 2: Auto-detect via Volume UUID
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
        }
        return {
          source: 'uuid',
          deviceInfo: device,
          error: 'iPod found but not mounted',
        };
      }
      // For mount command - return device info even if not mounted
      return {
        path: device.mountPoint,
        source: 'uuid',
        deviceInfo: device,
      };
    }

    // UUID configured but device not found
    return {
      source: 'none',
      error: `iPod with UUID ${deviceIdentity.volumeUuid} not found. Is it connected?`,
    };
  }

  // No UUID available — either no device configured or device has no UUID
  if (deviceIdentity) {
    // Device exists in config but has no volumeUuid
    return {
      source: 'none',
      error:
        'Device has no volumeUuid for auto-detection. ' +
        'Use --device <path> to specify the mount point, or run "podkit device add" to register the device.',
    };
  }

  return {
    source: 'none',
    error: 'No iPod configured. Run: podkit device add -d <name>',
  };
}

/**
 * Format error message for device path resolution failure
 */
export function formatDevicePathError(result: DevicePathResult): string {
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
      return 'No iPod configured. Run: podkit device add -d <name>';
    default:
      return 'Device not found';
  }
}

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Format a message for device lookup (shown during resolution)
 *
 * @param deviceName - Name of the device from config
 * @param deviceIdentity - Device identity with volumeUuid
 * @param verbose - Whether to show UUID details
 * @returns Formatted lookup message
 *
 * @example
 * formatDeviceLookupMessage('terapod', { volumeUuid: 'ABC', volumeName: 'X' }, false)
 * // => "Looking for iPod 'terapod'..."
 *
 * formatDeviceLookupMessage('terapod', { volumeUuid: 'ABC', volumeName: 'X' }, true)
 * // => "Looking for iPod 'terapod' (UUID: ABC)..."
 */
export function formatDeviceLookupMessage(
  deviceName: string | undefined,
  deviceIdentity: DeviceIdentity | undefined,
  verbose: boolean
): string {
  if (!deviceName) {
    return 'Looking for iPod...';
  }

  const base = `Looking for iPod '${deviceName}'`;

  if (verbose && deviceIdentity?.volumeUuid) {
    return `${base} (UUID: ${deviceIdentity.volumeUuid})...`;
  }

  return `${base}...`;
}
