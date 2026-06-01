/**
 * @podkit/devices-mass-storage — mass-storage device presets and types
 *
 * Provides built-in preset data (Echo Mini, Rockbox, generic DAPs), the
 * `MassStoragePreset` interface, USB hint matching, capability resolution,
 * and a `DeviceProvider` factory for the podkit device-capability system.
 *
 * @module
 */

export { BUILT_IN_PRESETS, MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS } from './presets/built-in.js';

export type {
  ContentPaths,
  MassStoragePreset,
  BuiltInPresetId,
  PresetId,
} from './presets/types.js';

export { BUILT_IN_PRESET_IDS, DEFAULT_CONTENT_PATHS } from './presets/types.js';

// Runtime functions
export { definePreset } from './preset.js';
export type { PresetDefinition, DefinePresetOptions } from './preset.js';

// Display string helpers
export { formatPresetDisplay, formatPresetShortDisplay } from './display.js';

export { identify } from './identity.js';

export { getCapabilities, getCapabilitiesResolved } from './capabilities.js';
export type { GetCapabilitiesOptions, GetCapabilitiesResolvedOptions } from './capabilities.js';

export { USB_PRESET_HINTS } from './usb-hints.js';
export type { UsbPresetHint } from './usb-hints.js';

// Classifier
export {
  classifyAsMassStorage,
  type MassStorageClassification,
  type ClassifiableUsbDevice as MassStorageClassifiableUsbDevice,
} from './classify.js';

// Recognised-but-unsupported classifier (Sony Walkman, …)
export {
  classifyAsUnsupportedDevice,
  UNSUPPORTED_VENDORS,
  type UnsupportedDeviceClassification,
} from './unsupported.js';

// Provider
export { createMassStorageProvider } from './provider.js';

// Capability override validation
export { validateCapabilityOverrides, MASS_STORAGE_CAPABILITY_KEYS } from './validate-overrides.js';
export type {
  CapabilityOverrideValidationError,
  CapabilityOverrideValidationResult,
  CapabilityOverrideErrorCode,
} from './validate-overrides.js';
