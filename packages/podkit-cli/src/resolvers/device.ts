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
    path: device.config.path,
    type: device.config.type,
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
 * A configured device that was auto-matched by UUID
 */
export interface MatchedDevice {
  /** Device name from config */
  name: string;
  /** Device configuration */
  config: import('../config/types.js').DeviceConfig;
}

/**
 * Result of resolving device to physical path
 */
export interface DevicePathResult {
  /** Resolved device path, if found */
  path?: string;
  /** How the device was found */
  source: 'cli' | 'uuid' | 'auto-detected' | 'path-matched' | 'config-path' | 'none';
  /** Device info if found via UUID */
  deviceInfo?: PlatformDeviceInfo;
  /** Error message if resolution failed */
  error?: string;
  /**
   * Configured device matched by UUID auto-detection.
   * Present when a CLI path or auto-detected iPod was matched to a
   * configured device by its Volume UUID. The caller should apply
   * device-specific config from this field.
   */
  matchedDevice?: MatchedDevice;
  /** Hint message (not an error) to show the user */
  hint?: string;
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
  /**
   * Full config for UUID→device matching (Scenario B).
   * When a CLI path is given, the resolver reads the UUID at that path
   * and matches it against configured devices. Pass config to enable this.
   */
  config?: import('../config/types.js').PodkitConfig;
}

/**
 * Resolve device to physical mount path
 *
 * Priority:
 * 1. CLI path (--device /path) - always wins
 * 2. Config path for mass-storage devices (path without UUID)
 * 3. Auto-detect via Volume UUID from device identity
 *
 * @param options - Resolution options
 * @returns Device path result
 */
export async function resolveDevicePath(options: DevicePathOptions): Promise<DevicePathResult> {
  const { cliPath, deviceIdentity, manager, requireMounted = true, config } = options;

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

    // Scenario B: CLI path given without a named device — try to match by UUID
    // Look up what's mounted at this path and match against configured devices
    if (!deviceIdentity && config?.devices) {
      const matched = await matchPathToConfigDevice(cliPath, config, manager);
      if (matched) {
        return {
          path: cliPath,
          source: 'path-matched',
          matchedDevice: matched.matchedDevice,
          deviceInfo: matched.deviceInfo,
        };
      }
    }

    return {
      path: cliPath,
      source: 'cli',
    };
  }

  // Priority 2: Path-based resolution for mass-storage devices
  if (deviceIdentity?.path && !deviceIdentity?.volumeUuid) {
    return {
      path: deviceIdentity.path,
      source: 'config-path',
    };
  }

  // Priority 3: Auto-detect via Volume UUID
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
          error: 'Device found but not mounted',
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
      error: `Device with UUID ${deviceIdentity.volumeUuid} not found. Is it connected?`,
    };
  }

  // No UUID or path available — either no device configured or device has no identification
  if (deviceIdentity) {
    // Device exists in config but has no volumeUuid or path
    return {
      source: 'none',
      error:
        'Device has no volumeUuid or path for detection. ' +
        'Use --device <path> to specify the mount point, or add a path to the device config.',
    };
  }

  return {
    source: 'none',
    error: 'No device configured. Run: podkit device add -d <name>',
  };
}

// =============================================================================
// Auto-Detection (Scenario A & B helpers)
// =============================================================================

/**
 * Build a UUID→device name map from config.devices
 */
function buildUuidMap(
  devices: Record<string, import('../config/types.js').DeviceConfig>
): Map<string, { name: string; config: import('../config/types.js').DeviceConfig }> {
  const map = new Map<
    string,
    { name: string; config: import('../config/types.js').DeviceConfig }
  >();
  for (const [name, deviceConfig] of Object.entries(devices)) {
    if (deviceConfig.volumeUuid) {
      map.set(deviceConfig.volumeUuid.toUpperCase(), { name, config: deviceConfig });
    }
  }
  return map;
}

/**
 * Match a CLI path to a configured device by reading the UUID at that mount point
 * and looking it up in config.devices. (Scenario B)
 */
async function matchPathToConfigDevice(
  mountPath: string,
  config: import('../config/types.js').PodkitConfig,
  manager: DeviceManager
): Promise<{ matchedDevice: MatchedDevice; deviceInfo?: PlatformDeviceInfo } | null> {
  if (!config.devices) return null;

  const uuid = await manager.getUuidForMountPoint(mountPath);
  if (!uuid) return null;

  const uuidMap = buildUuidMap(config.devices);
  const match = uuidMap.get(uuid.toUpperCase());
  if (!match) return null;

  // Also get device info for the matched UUID
  const deviceInfo = await manager.findByVolumeUuid(uuid);

  return {
    matchedDevice: { name: match.name, config: match.config },
    deviceInfo: deviceInfo ?? undefined,
  };
}

/**
 * Auto-detect a connected iPod and match it to a configured device (Scenario A)
 *
 * Called when no --device flag is given and no default device is configured.
 * Scans for connected iPods and matches their UUIDs against config.devices.
 *
 * @returns DevicePathResult with the matched device info, or an error
 */
export async function autoDetectDevice(
  manager: DeviceManager,
  config: import('../config/types.js').PodkitConfig
): Promise<DevicePathResult> {
  const ipods = await manager.findIpodDevices();

  if (ipods.length === 0) {
    return {
      source: 'none',
      error: 'No iPod found. Is it connected and mounted?',
    };
  }

  // Build UUID→device name map from config
  const uuidMap = config.devices ? buildUuidMap(config.devices) : new Map();

  // Match detected iPods against configured devices
  const matches: Array<{
    deviceInfo: PlatformDeviceInfo;
    matchedDevice: MatchedDevice;
  }> = [];

  for (const ipod of ipods) {
    if (ipod.volumeUuid) {
      const match = uuidMap.get(ipod.volumeUuid.toUpperCase());
      if (match) {
        matches.push({
          deviceInfo: ipod,
          matchedDevice: { name: match.name, config: match.config },
        });
      }
    }
  }

  // One match → auto-select
  if (matches.length === 1) {
    const { deviceInfo, matchedDevice } = matches[0]!;
    if (!deviceInfo.isMounted || !deviceInfo.mountPoint) {
      return {
        source: 'auto-detected',
        deviceInfo,
        matchedDevice,
        error: `Device '${matchedDevice.name}' found but not mounted`,
      };
    }
    return {
      path: deviceInfo.mountPoint,
      source: 'auto-detected',
      deviceInfo,
      matchedDevice,
    };
  }

  // Multiple matches → error
  if (matches.length > 1) {
    const names = matches.map((m) => m.matchedDevice.name).join(', ');
    return {
      source: 'none',
      error: `Multiple configured iPods detected: ${names}. Specify with --device <name>`,
    };
  }

  // No config match — use the iPod with global settings if exactly one is connected
  if (ipods.length === 1) {
    const ipod = ipods[0]!;
    if (!ipod.isMounted || !ipod.mountPoint) {
      return {
        source: 'none',
        deviceInfo: ipod,
        error: 'iPod found but not mounted',
      };
    }
    return {
      path: ipod.mountPoint,
      source: 'auto-detected',
      deviceInfo: ipod,
      hint: "Tip: Run 'podkit device add' to save device-specific settings",
    };
  }

  // Multiple iPods connected but none match config
  return {
    source: 'none',
    error: `${ipods.length} iPods detected but none match configured devices. Specify with --device <name> or --device <path>`,
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
      return 'No device configured. Run: podkit device add -d <name>';
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
  // Determine the device label
  const isIpod = !deviceIdentity?.type || deviceIdentity.type === 'ipod';
  const deviceLabel = isIpod ? 'iPod' : 'device';

  if (!deviceName) {
    return `Looking for ${deviceLabel}...`;
  }

  const base = `Looking for ${deviceLabel} '${deviceName}'`;

  if (verbose && deviceIdentity?.volumeUuid) {
    return `${base} (UUID: ${deviceIdentity.volumeUuid})...`;
  }

  return `${base}...`;
}
