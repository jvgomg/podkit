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
  PlatformDeviceIdentity,
  PlatformDeviceMountState,
  PlatformDeviceStorage,
  PartitionLayout,
  PartitionLayoutEntry,
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

export { resolveIpodModel, type ResolveModelInput } from '@podkit/devices-ipod';

// Unified capability resolver
export {
  resolveCapabilities,
  resolveCapabilitiesResolved,
  identifyCapabilities,
} from './resolve-capabilities.js';
export type {
  ResolveCapabilitiesOptions,
  ResolveCapabilitiesResolvedOptions,
} from './resolve-capabilities.js';

// Readiness pipeline
export type {
  ReadinessStage,
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessInput,
  ReadinessUnsupportedReason,
} from './readiness.js';
export {
  checkReadiness,
  checkIpodStructure,
  checkSysInfo,
  checkDatabase,
  createUsbOnlyReadinessResult,
  STAGE_DISPLAY_NAMES,
} from './readiness.js';

// Cross-platform filesystem policy (HFS+-on-Linux refusal — TASK-317.12)
export {
  isFilesystemUnsupportedHere,
  formatHfsplusOnLinuxRefusal,
  makeHfsplusOnLinuxUnsupportedReason,
  LINUX_FILESYSTEMS_DOCS_URL,
} from './filesystem-policy.js';

// iPod identity assessment (cascade-resolved model + capabilities + inquiry state)
export type {
  IpodIdentityAssessment,
  IpodFirmwareInquiryState,
  EnsureSysInfoExtendedAndReassessResult,
  EnsureSysInfoExtendedAndReassessOptions,
  IdentitySignalSummary,
} from './ipod-identity.js';
export {
  assessIpodIdentity,
  ensureSysInfoExtendedAndReassess,
  isIdentityFullyEmpty,
  summariseIdentitySignals,
} from './ipod-identity.js';

// Mass-storage device assessment (symmetric to assessIpodIdentity)
export type {
  MassStorageAssessment,
  AssessMassStorageDeviceOptions,
} from './mass-storage-identity.js';
export { assessMassStorageDevice } from './mass-storage-identity.js';

// Cross-provider add-intent helper (drives the CLI's "you have X attached" hint)
export type { SuggestAddIntentsOptions } from './add-intent.js';
export { suggestAddIntents } from './add-intent.js';
// Re-export the contract types for callers that consume the helper's return shape.
export type { DeviceAddIntent, DiscoveredContext } from '@podkit/device-types';

// SysInfoExtended orchestrator (imported directly from @podkit/ipod-firmware)
export type {
  SysInfoExtendedResult,
  ReadFromUsbFn,
  EnsureSysInfoExtendedOptions,
} from '@podkit/ipod-firmware';
export {
  ensureSysInfoExtended,
  readSysInfoExtended,
  writeSysInfoExtended,
  SYSINFO_PATH,
  SYSINFO_EXTENDED_PATH,
  SYSINFO_DEVICE_DIR,
} from '@podkit/ipod-firmware';

// USB enumeration
export type { EnumeratedUsbDevice } from './usb-enumeration.js';
export { enumerateUsb } from './usb-enumeration.js';

// USB path-mode resolution (mount path → USB fingerprint)
export type { ResolvedUsbDevice, CompleteUsbDevice } from './usb-path-resolution.js';
export { resolveUsbDeviceFromPath, hasCompleteUsbFingerprint } from './usb-path-resolution.js';

// USB device classification (composes per-domain classifiers)
export type { RecognizedDevice, ClassifyUsbDevicesOptions } from './classify.js';
export { classifyUsbDevices } from './classify.js';
export type { IpodClassification } from '@podkit/devices-ipod';
export type {
  MassStorageClassification,
  UnsupportedDeviceClassification,
} from '@podkit/devices-mass-storage';

// Discovery reconciliation — folds USB-inquiry + block-device records into
// a single record per physical iPod for `device scan` rendering.
export type { ReconciledIpodRecord } from './reconcile.js';
export { reconcileIpodDiscovery } from './reconcile.js';

// Device enumeration framework (provider-based)
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
