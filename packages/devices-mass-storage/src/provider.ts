/**
 * Mass-storage device provider
 *
 * Implements the `DeviceProvider<MassStorageIdentity>` interface for
 * USB mass-storage devices (Echo Mini, Rockbox, generic DAPs).
 *
 * @module
 */

import type { DeviceProvider, UsbFingerprint, MassStorageIdentity } from '@podkit/device-types';
import type { UsbConnectionInfo } from '@podkit/device-types';
import type { MassStoragePreset } from './presets/types.js';
import { identify } from './identity.js';

// =============================================================================
// createMassStorageProvider
// =============================================================================

/**
 * Construct a mass-storage device provider.
 *
 * The provider matches USB devices against the supplied preset map's
 * VID/PID hints. Unmatched non-iPod devices fall back to the generic
 * preset (caller decision: include `'generic'` in the preset map for
 * fallback behaviour, or omit it to require explicit recognition).
 *
 * Stateless: each call to `detect()` re-evaluates against the preset
 * map. Two callers with different preset maps get independent providers.
 *
 * **UsbFingerprint → UsbConnectionInfo conversion:**
 * Both types carry `vendorId`, `productId`, and `serialNumber`. They differ
 * in bus-addressing fields: `UsbFingerprint` uses `bus` / `devnum` (required)
 * while `UsbConnectionInfo` uses `busNumber` / `deviceAddress` (optional).
 * `identify()` only needs `vendorId` + `productId` + `serialNumber` for hint
 * matching, so the bus fields are mapped through for completeness but are not
 * required for correctness.
 *
 * @param presets - Preset map in scope (built-in + user-registered). The
 *   resulting provider sees only these presets. Include `'generic'` to enable
 *   fallback detection for any unrecognised mass-storage USB device.
 * @returns A `DeviceProvider<MassStorageIdentity>` for use with `enumerateConnectedDevices`.
 *
 * @example
 * ```ts
 * import { createMassStorageProvider, BUILT_IN_PRESETS, definePreset } from '@podkit/devices-mass-storage';
 * import { enumerateConnectedDevices } from '@podkit/core';
 *
 * const myDap = definePreset({ id: 'my-dap', extends: 'generic' });
 * const provider = createMassStorageProvider({ ...BUILT_IN_PRESETS, 'my-dap': myDap });
 *
 * const devices = await enumerateConnectedDevices({ providers: [provider] });
 * ```
 */
export function createMassStorageProvider(
  presets: Record<string, MassStoragePreset>
): DeviceProvider<MassStorageIdentity> {
  return {
    id: 'mass-storage',
    async detect(fp: UsbFingerprint): Promise<MassStorageIdentity | null> {
      // UsbFingerprint and UsbConnectionInfo both carry vendorId/productId/
      // serialNumber. The only divergence is bus-addressing field names:
      //   UsbFingerprint:     bus (number, required), devnum (number, required)
      //   UsbConnectionInfo:  busNumber (number, optional), deviceAddress (number, optional)
      // identify() only uses vendorId + productId + serialNumber for matching,
      // so mapping bus → busNumber and devnum → deviceAddress is purely for
      // completeness (future-proofing if identify() ever uses bus addressing).
      const usb: UsbConnectionInfo = {
        vendorId: fp.vendorId,
        productId: fp.productId,
        ...(fp.serialNumber !== undefined ? { serialNumber: fp.serialNumber } : {}),
        busNumber: fp.bus,
        deviceAddress: fp.devnum,
      };
      return identify(usb, presets);
    },
  };
}
