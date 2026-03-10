/**
 * Device path resolution
 *
 * This module centralizes the logic for finding the iPod mount point.
 * Priority order:
 *   1. CLI --device flag (path or named device)
 *   2. Named device from positional arg or -d flag
 *   3. Default device from config.defaults.device
 *   4. Auto-detect via Volume UUID (from resolved device config)
 *
 * @see ./resolvers/device.ts for the core implementation
 */

import type { PodkitConfig } from './config/index.js';
import type { DeviceManager } from '@podkit/core';
import {
  resolveDevice,
  getDeviceIdentity as getDeviceIdentityCore,
  resolveDevicePath as resolveDevicePathCore,
  formatDevicePathError,
  formatDeviceLookupMessage as formatDeviceLookupMessageCore,
  type DevicePathResult,
  type DevicePathOptions,
  type ResolvedDevice,
  type DeviceIdentity,
} from './resolvers/index.js';

// =============================================================================
// Re-exports from new resolvers module
// =============================================================================

export type { ResolvedDevice, DeviceIdentity } from './resolvers/index.js';
export { parseCliDeviceArg, resolveEffectiveDevice } from './resolvers/index.js';

// =============================================================================
// Backward-Compatible Wrappers
// =============================================================================

// Old return type aliases
export type ResolveDeviceResult = DevicePathResult;
export interface ResolveDeviceOptions {
  /** CLI --device flag value (path) */
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
 * Resolve a named device from config
 *
 * @param config - The merged config
 * @param deviceName - Optional device name from -d flag
 * @returns Resolved device config or undefined if not found
 *
 * @deprecated For new code, use resolveDevice() from './resolvers' which returns
 * a ResolutionResult with proper error handling.
 */
export function resolveDeviceFromConfig(
  config: PodkitConfig,
  deviceName?: string
): ResolvedDevice | undefined {
  const result = resolveDevice(config, deviceName);
  if (result.success) {
    return result.entity;
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
  return getDeviceIdentityCore(resolvedDevice);
}

/**
 * Resolve the iPod device path
 *
 * Priority:
 * 1. CLI --device flag (always wins)
 * 2. Auto-detect via Volume UUID from device identity
 *
 * @param options - Resolution options (uses cliDevice for backward compatibility)
 * @returns Device path result
 */
export async function resolveDevicePath(
  options: ResolveDeviceOptions
): Promise<ResolveDeviceResult> {
  // Map old option names to new ones
  const newOptions: DevicePathOptions = {
    cliPath: options.cliDevice,
    deviceIdentity: options.deviceIdentity,
    manager: options.manager,
    requireMounted: options.requireMounted,
  };
  return resolveDevicePathCore(newOptions);
}

/**
 * Format a helpful error message for device resolution failures
 */
export function formatDeviceError(result: ResolveDeviceResult): string {
  return formatDevicePathError(result);
}

/**
 * Format error message when a named device is not found
 */
export function formatDeviceNotFoundError(deviceName: string, config: PodkitConfig): string {
  const availableDevices = config.devices ? Object.keys(config.devices).join(', ') : '(none)';
  return `Device "${deviceName}" not found in config. Available devices: ${availableDevices}`;
}

/**
 * Format a message for device lookup
 *
 * @param deviceName - Name of the device from config (e.g., 'terapod')
 * @param deviceIdentity - Device identity with volumeUuid
 * @param verbose - Whether to show UUID details
 * @returns Formatted lookup message
 */
export function formatDeviceLookupMessage(
  deviceName: string | undefined,
  deviceIdentity: DeviceIdentity | undefined,
  verbose: boolean
): string {
  return formatDeviceLookupMessageCore(deviceName, deviceIdentity, verbose);
}
