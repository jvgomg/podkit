/**
 * Device manager factory
 *
 * Provides platform detection and creates the appropriate
 * device manager implementation.
 */

import type { DeviceManager } from './types.js';
import { createMacOSManager } from './platforms/macos.js';
import { createLinuxManager } from './platforms/linux.js';
import { createWindowsManager } from './platforms/windows.js';
import { createUnsupportedManager } from './platforms/unsupported.js';

/**
 * Cached device manager instance
 */
let cachedManager: DeviceManager | null = null;

/**
 * Get the current platform
 */
export function getPlatform(): NodeJS.Platform {
  return process.platform;
}

/**
 * Create a device manager for a specific platform
 *
 * @param platform - Platform identifier (defaults to current platform)
 * @returns Device manager implementation
 */
export function createDeviceManager(platform: NodeJS.Platform = process.platform): DeviceManager {
  switch (platform) {
    case 'darwin':
      return createMacOSManager();
    case 'linux':
      return createLinuxManager();
    case 'win32':
      return createWindowsManager();
    default:
      return createUnsupportedManager(platform);
  }
}

/**
 * Get the device manager singleton
 *
 * Returns a cached instance for the current platform.
 * Use this for normal operations; use createDeviceManager()
 * when you need a fresh instance or specific platform.
 */
export function getDeviceManager(): DeviceManager {
  if (!cachedManager) {
    cachedManager = createDeviceManager();
  }
  return cachedManager;
}

/**
 * Clear the cached device manager
 *
 * Useful for testing to reset state.
 */
export function clearDeviceManagerCache(): void {
  cachedManager = null;
}

/**
 * Check if the current platform supports device management
 */
export function isPlatformSupported(): boolean {
  return getDeviceManager().isSupported;
}
