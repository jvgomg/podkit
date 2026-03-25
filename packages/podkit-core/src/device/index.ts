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

// Device capability types
export type { DeviceCapabilities, DeviceArtworkSource, AudioCodec } from './capabilities.js';

// Device adapter interface
export type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './adapter.js';

// iPod adapter implementation
export { IpodDeviceAdapter } from './ipod-adapter.js';

// Mass-storage adapter implementation
export { MassStorageAdapter, MassStorageTrack } from './mass-storage-adapter.js';
export type {
  MetadataReader,
  MetadataReaderResult,
  MassStorageAdapterOptions,
} from './mass-storage-adapter.js';
export {
  sanitizeFilename,
  generateTrackPath,
  generateVideoPath,
  deduplicatePath,
  padTrackNumber,
  isAudioExtension,
  isVideoExtension,
  isMediaExtension,
  MUSIC_DIR,
  VIDEO_DIR,
  PODKIT_DIR,
  MANIFEST_FILE,
} from './mass-storage-utils.js';
export type { MassStorageManifest } from './mass-storage-utils.js';

// Device presets
export { DEVICE_PRESETS, getDevicePreset, resolveDeviceCapabilities } from './presets.js';
export type { DeviceTypeId } from './presets.js';

// Types
export type {
  PlatformDeviceInfo,
  DeviceManager,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
  IpodIdentity,
  EjectProgressEvent,
  EjectWithRetryOptions,
} from './types.js';

export type {
  DeviceAssessment,
  IFlashAssessment,
  IFlashEvidence,
  UsbDeviceInfo,
} from './assessment.js';

export { detectIFlash } from './assessment.js';
export { lookupIpodModel } from './ipod-models.js';

// Eject with retry
export { ejectWithRetry, isRetryableError } from './eject.js';

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
export { LinuxDeviceManager, createLinuxManager, stripPartitionSuffix } from './platforms/linux.js';
export { UnsupportedDeviceManager, createUnsupportedManager } from './platforms/unsupported.js';
