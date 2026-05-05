/**
 * USB VID/PID hint table for mass-storage device presets
 *
 * Known USB VID/PID combinations that hint at a specific mass-storage preset.
 * The provider's `identify` walks this table; if a match is found, the
 * resulting MassStorageIdentity tags the device with the preset id.
 *
 * Adding entries: prefer the most-specific match (vendor + product) over
 * vendor-only. New devices land here as user requests + research lands.
 *
 * All IDs are stored in lowercase with `0x` prefix for consistent comparison.
 *
 * @module
 */

import type { BuiltInPresetId } from './presets/types.js';

// =============================================================================
// Types
// =============================================================================

/** A single entry in the USB preset hint table */
export interface UsbPresetHint {
  /** USB vendor ID — lowercase hex with 0x prefix (e.g. '0x071b') */
  vendorId: string;
  /** USB product ID — lowercase hex with 0x prefix (e.g. '0x3203') */
  productId: string;
  /** Preset to apply when this VID/PID is matched */
  presetId: BuiltInPresetId;
  /** How specific the match is */
  confidence: 'exact' | 'vendor-only';
}

// =============================================================================
// Table
// =============================================================================

/**
 * Known USB VID/PID combinations mapped to built-in presets.
 *
 * Entry: Echo Mini (Pioneer)
 *   Vendor: Pioneer Corporation (0x071b)
 *   Product: Pioneer XDP-300R / Echo Mini (0x3203)
 */
export const USB_PRESET_HINTS: UsbPresetHint[] = [
  { vendorId: '0x071b', productId: '0x3203', presetId: 'echo-mini', confidence: 'exact' },
  // Future: more devices land here as user requests + research lands.
];
