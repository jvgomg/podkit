/**
 * @podkit/devices-mass-storage — mass-storage device presets and types
 *
 * Provides the built-in preset data (Echo Mini, Rockbox, generic DAPs) and
 * the `MassStoragePreset` interface for the podkit device capability system.
 *
 * Runtime functions (`createMassStorageProvider`) are added in TASK-294.06.
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

export { BUILT_IN_PRESET_IDS } from './presets/types.js';

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
