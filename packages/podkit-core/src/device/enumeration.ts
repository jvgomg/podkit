/**
 * Device enumeration framework
 *
 * Walks the OS USB tree via {@link enumerateUsb} and asks each registered
 * `DeviceProvider` whether it recognises each device. Returns an
 * `EnumeratedDevice[]` that includes every discovered USB device — matched
 * or not — so callers can surface unknown devices as they choose.
 *
 * ## Provider matching
 *
 * Providers are tried in the order supplied in `opts.providers`. The first
 * provider that returns a non-null identity from `detect()` wins; remaining
 * providers are skipped for that device. This is intentional: the caller
 * controls priority by ordering the list.
 *
 * ## Parallelism
 *
 * Providers are run serially against each device (predictable ordering, avoids
 * concurrent SCSI/USB inquiries hitting the same device). Devices are
 * enumerated in parallel (`Promise.all`) since they are independent hardware.
 *
 * ## Error handling
 *
 * If a provider's `detect()` throws, the error is caught and treated as a
 * null match (the provider is considered to have not recognised the device).
 * This keeps enumeration robust against flaky hardware or provider bugs.
 *
 * @module
 */

import type { DeviceProvider, DeviceIdentity, UsbFingerprint } from '@podkit/device-types';
import { enumerateUsb } from './usb-enumeration.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';

// =============================================================================
// Types
// =============================================================================

/**
 * A single USB device from the enumeration walk, with optional provider match.
 */
export interface EnumeratedDevice {
  /** Raw USB connection info from the OS walk. */
  fingerprint: UsbFingerprint;
  /**
   * Full enumeration result for this device (carries diskIdentifier when
   * the device exposes a mass-storage volume). Available for callers that
   * need it; most provider-aware code should prefer `identity`.
   */
  discovered: EnumeratedUsbDevice;
  /** The provider that successfully matched this device, or undefined. */
  matchedProviderId?: string;
  /** Provider-produced identity, or undefined when no provider matched. */
  identity?: DeviceIdentity;
}

/**
 * Options for `enumerateConnectedDevices`.
 */
export interface EnumerateOptions {
  /**
   * Providers to consult, in priority order. First non-null `detect()` wins.
   * An empty list returns all USB devices without any classification.
   */
  providers: DeviceProvider[];
  /**
   * Optional override for the USB walk (for testing).
   * When supplied, `enumerateUsb` is not called; this function is used
   * instead. Receives no arguments; returns raw enumerated devices.
   */
  walk?: () => Promise<EnumeratedUsbDevice[]>;
}

// =============================================================================
// EnumeratedUsbDevice → UsbFingerprint extraction
// =============================================================================

/**
 * Extract the `UsbFingerprint` from an `EnumeratedUsbDevice`.
 *
 * The enumeration result already carries the bare-hex VID/PID and optional
 * bus/devnum/serial that make up a `UsbFingerprint`; this helper strips
 * the `diskIdentifier` field which is not part of the fingerprint shape.
 */
function toFingerprint(d: EnumeratedUsbDevice): UsbFingerprint {
  const fp: UsbFingerprint = { vendorId: d.vendorId, productId: d.productId };
  if (d.serialNumber !== undefined) fp.serialNumber = d.serialNumber;
  if (d.bus !== undefined) fp.bus = d.bus;
  if (d.devnum !== undefined) fp.devnum = d.devnum;
  return fp;
}

// =============================================================================
// enumerateConnectedDevices
// =============================================================================

/**
 * Enumerate all connected USB devices and classify them via providers.
 *
 * Walks the OS USB tree (or uses the injected `opts.walk` for testing), then
 * for each enumerated device tries each provider in order. The first non-null
 * `detect()` result wins. Devices that no provider recognises are included in
 * the result with `identity` and `matchedProviderId` absent.
 *
 * @returns One `EnumeratedDevice` per enumerated USB device.
 *
 * @example
 * ```typescript
 * const devices = await enumerateConnectedDevices({
 *   providers: [ipodProvider, createMassStorageProvider(BUILT_IN_PRESETS)],
 * });
 * for (const d of devices) {
 *   if (d.identity?.kind === 'ipod') { ... }
 *   else if (d.identity?.kind === 'mass-storage') { ... }
 *   else { // unknown device }
 * }
 * ```
 */
export async function enumerateConnectedDevices(
  opts: EnumerateOptions
): Promise<EnumeratedDevice[]> {
  const discovered = await (opts.walk ? opts.walk() : enumerateUsb());

  const results = await Promise.all(
    discovered.map(async (d): Promise<EnumeratedDevice> => {
      const fingerprint = toFingerprint(d);

      for (const provider of opts.providers) {
        let identity: DeviceIdentity | null = null;
        try {
          identity = await provider.detect(fingerprint);
        } catch {
          continue;
        }
        if (identity !== null) {
          return { fingerprint, discovered: d, matchedProviderId: provider.id, identity };
        }
      }

      return { fingerprint, discovered: d };
    })
  );

  return results;
}
