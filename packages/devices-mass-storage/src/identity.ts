/**
 * Mass-storage device identity matching
 *
 * Matches a USB device against the known VID/PID hint table and returns a
 * `MassStorageIdentity` tagged with the matched preset id, or `null` if the
 * device is not recognised as a known mass-storage DAP.
 *
 * The caller (provider enumeration) is responsible for falling back to
 * `'generic'` for unrecognised non-iPod USB devices, if desired.
 *
 * @module
 */

import type { MassStorageIdentity, UsbFingerprint } from '@podkit/device-types';
import type { MassStoragePreset } from './presets/types.js';
import { USB_PRESET_HINTS } from './usb-hints.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalise a USB VID/PID string for comparison.
 *
 * Accepts formats like `'0x071B'`, `'071b'`, `'0x071b'`, `'071B'` and
 * returns a lowercase `'0x...'` string so all formats compare equal.
 */
function normaliseId(id: string): string {
  const cleaned = id.trim().toLowerCase();
  // Strip 0x prefix if present, then re-add it
  const hex = cleaned.startsWith('0x') ? cleaned.slice(2) : cleaned;
  return `0x${hex}`;
}

// =============================================================================
// identify
// =============================================================================

/**
 * Match a USB device against the VID/PID hint table.
 *
 * The optional `presets` map can be used by callers to restrict matching to
 * presets that are actually in scope (e.g. when the user has removed a preset
 * from the registry). If omitted, all hint-table entries are eligible.
 *
 * @param usb - USB connection info carrying `vendorId` and `productId` (hex strings, with or without `0x` prefix).
 * @param presets - Optional map of active presets. When supplied, only hint-table entries whose
 *   `presetId` exists as a key in this map are considered.
 * @returns `MassStorageIdentity` with the matched `presetId`, or `null` if no hint matches.
 *
 * @example
 * ```ts
 * import { identify } from '@podkit/devices-mass-storage';
 *
 * const identity = identify({ vendorId: '0x071b', productId: '0x3203' });
 * // → { kind: 'mass-storage', presetId: 'echo-mini' }
 *
 * const unknown = identify({ vendorId: '0xffff', productId: '0x0001' });
 * // → null
 * ```
 */
export function identify(
  usb: UsbFingerprint,
  presets?: Record<string, MassStoragePreset>
): MassStorageIdentity | null {
  const vendorId = normaliseId(usb.vendorId);
  const productId = normaliseId(usb.productId);

  for (const hint of USB_PRESET_HINTS) {
    if (normaliseId(hint.vendorId) !== vendorId) continue;
    if (hint.confidence === 'exact' && normaliseId(hint.productId) !== productId) continue;

    // If a presets map is provided, verify the preset is in scope
    if (presets !== undefined && !(hint.presetId in presets)) continue;

    const identity: MassStorageIdentity = {
      kind: 'mass-storage',
      presetId: hint.presetId,
    };

    if (usb.serialNumber !== undefined) {
      identity.serialNumber = usb.serialNumber;
    }

    return identity;
  }

  return null;
}
