/**
 * @podkit/devices-mass-storage — mass-storage device presets and types
 *
 * Provides built-in preset data (Echo Mini, Rockbox, generic DAPs), the
 * `MassStoragePreset` interface, USB hint matching, capability resolution,
 * and a `DeviceProvider` factory for the podkit device-capability system.
 *
 * @module
 */

export { BUILT_IN_PRESETS } from './presets/built-in.js';

export type {
  ContentPaths,
  MassStoragePreset,
  BuiltInPresetId,
  PresetId,
} from './presets/types.js';

export { BUILT_IN_PRESET_IDS, DEFAULT_CONTENT_PATHS } from './presets/types.js';

// Runtime functions (TASK-294.05)
export { definePreset } from './preset.js';
export type { PresetDefinition, DefinePresetOptions } from './preset.js';

export { identify } from './identity.js';

export { getCapabilities } from './capabilities.js';
export type { GetCapabilitiesOptions } from './capabilities.js';

export { USB_PRESET_HINTS } from './usb-hints.js';
export type { UsbPresetHint } from './usb-hints.js';

// Provider (TASK-294.06)
export { createMassStorageProvider } from './provider.js';
