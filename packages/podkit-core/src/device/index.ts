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
export type { DeviceCapabilities, DeviceArtworkSource, AudioCodec } from '@podkit/device-types';

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
export type { TrackPathVars } from './mass-storage-utils.js';
export {
  sanitizeFilename,
  generateTrackPath,
  generateVideoPath,
  resolvePathTemplate,
  DEFAULT_MUSIC_PATH_TEMPLATE,
  deduplicatePath,
  padTrackNumber,
  isAudioExtension,
  isVideoExtension,
  isMediaExtension,
  normalizeContentDir,
  normalizeContentPaths,
  validateContentPaths,
  PODKIT_DIR,
  MANIFEST_FILE,
} from './mass-storage-utils.js';
export type { MassStorageManifest } from './mass-storage-utils.js';
export { DEFAULT_CONTENT_PATHS } from '@podkit/devices-mass-storage';
export type { ContentPaths } from '@podkit/devices-mass-storage';

// Device type identifiers (CLI-surface types; iPod is a built-in type id that
// has no mass-storage preset, so these live here rather than in
// @podkit/devices-mass-storage).
export const PRESET_DEVICE_TYPE_IDS = ['echo-mini', 'rockbox', 'generic'] as const;
export type PresetDeviceTypeId = (typeof PRESET_DEVICE_TYPE_IDS)[number];

export const BUILT_IN_DEVICE_TYPE_IDS = ['ipod', ...PRESET_DEVICE_TYPE_IDS] as const;
export type BuiltInDeviceTypeId = (typeof BUILT_IN_DEVICE_TYPE_IDS)[number];

/** Supported device type identifiers. */
export type DeviceTypeId = BuiltInDeviceTypeId | (string & {});

// Types
export type {
  PlatformDeviceInfo,
  DeviceManager,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
  StoredIpodLink,
  EjectProgressEvent,
  EjectWithRetryOptions,
} from './types.js';

export type { DeviceAssessment, IFlashAssessment, IFlashEvidence } from './assessment.js';

export { detectIFlash } from './assessment.js';
export {
  lookupByUsbId,
  lookupByModelNumber,
  lookupBySerial,
  lookupGenerationInfo,
  lookupGenerationByProductId,
  getChecksumType,
  getChecksumTypeByModelNumber,
  lookupGenerationByModelNumber,
  toLibgpodGeneration,
  identify,
  formatGeneration,
} from '@podkit/devices-ipod';
export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGeneration,
  IpodModelVariant,
  IpodModel,
  IpodModelSource,
  IpodModelInput,
} from '@podkit/devices-ipod';

export { modelFromLibgpodInfo, type LibgpodDeviceInfo } from '@podkit/devices-ipod';

// Unified capability resolver
export { resolveCapabilities, identifyCapabilities } from './resolve-capabilities.js';
export type { ResolveCapabilitiesOptions } from './resolve-capabilities.js';

// Readiness pipeline
export type {
  ReadinessStage,
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessInput,
} from './readiness.js';
export {
  checkReadiness,
  checkIpodStructure,
  checkSysInfo,
  checkDatabase,
  createUsbOnlyReadinessResult,
  STAGE_DISPLAY_NAMES,
} from './readiness.js';

// SysInfoExtended orchestrator (imported directly from @podkit/ipod-firmware)
export type { SysInfoExtendedResult, UsbDeviceAddress, ReadFromUsbFn } from '@podkit/ipod-firmware';
export {
  ensureSysInfoExtended,
  readSysInfoExtended,
  writeSysInfoExtended,
} from '@podkit/ipod-firmware';

// USB discovery
export type { UsbDiscoveredDevice } from './usb-discovery.js';
export { discoverUsbIpods, resolveUsbDeviceFromPath } from './usb-discovery.js';

// Device enumeration framework
export type { EnumeratedDevice, EnumerateOptions } from './enumeration.js';
export { enumerateConnectedDevices } from './enumeration.js';

// OS error code interpreter
export type { InterpretedError } from './error-codes.js';
export { interpretError } from './error-codes.js';

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
