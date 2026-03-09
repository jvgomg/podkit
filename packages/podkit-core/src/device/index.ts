/**
 * Device management module
 *
 * Provides cross-platform abstraction for iPod device operations:
 * - Device discovery and enumeration
 * - Mounting and unmounting
 * - iPod identification by Volume UUID
 *
 * @example
 * ```typescript
 * import { getDeviceManager } from '@podkit/core';
 *
 * const manager = getDeviceManager();
 *
 * // Find attached iPods
 * const ipods = await manager.findIpodDevices();
 *
 * // Eject a device
 * await manager.eject('/Volumes/iPod');
 *
 * // Mount by UUID
 * const device = await manager.findByVolumeUuid('ABC-123');
 * if (device) {
 *   await manager.mount(device.identifier);
 * }
 * ```
 */

// Types
export type {
  PlatformDeviceInfo,
  DeviceManager,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
  IpodIdentity,
} from './types.js';

// Manager factory
export {
  getDeviceManager,
  createDeviceManager,
  clearDeviceManagerCache,
  getPlatform,
  isPlatformSupported,
} from './manager.js';

// Platform-specific managers (for testing)
export { MacOSDeviceManager, createMacOSManager } from './platforms/macos.js';
export {
  UnsupportedDeviceManager,
  createUnsupportedManager,
} from './platforms/unsupported.js';
