/**
 * Device enumeration framework
 *
 * Walks the OS USB tree via the existing usb-discovery infrastructure and
 * asks each registered `DeviceProvider` whether it recognises each device.
 * Returns an `EnumeratedDevice[]` that includes every discovered USB device —
 * matched or not — so callers can surface unknown devices as they choose.
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
import { discoverUsbIpods } from './usb-discovery.js';
import type { UsbDiscoveredDevice } from './usb-discovery.js';

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
   * Full usb-discovery result for this device (includes iPod model if Apple,
   * diskIdentifier if mounted). Available for callers that need it; most
   * provider-aware code should prefer `identity`.
   */
  discovered: UsbDiscoveredDevice;
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
   * When supplied, `discoverUsbIpods` is not called; this function is used
   * instead. Receives no arguments; returns raw discovered devices.
   */
  walk?: () => Promise<UsbDiscoveredDevice[]>;
}

// =============================================================================
// UsbDiscoveredDevice → UsbFingerprint extraction
// =============================================================================

/**
 * Extract the `UsbFingerprint` from a `UsbDiscoveredDevice`.
 *
 * `UsbDiscoveredDevice.usb` is already a `UsbFingerprint` (bare-hex VID/PID,
 * optional bus/devnum). This function is a trivial pass-through kept for
 * readability at the call site.
 */
function toFingerprint(d: UsbDiscoveredDevice): UsbFingerprint {
  return d.usb;
}

// =============================================================================
// enumerateConnectedDevices
// =============================================================================

/**
 * Enumerate all connected USB devices and classify them via providers.
 *
 * Walks the OS USB tree (or uses the injected `opts.walk` for testing), then
 * for each discovered device tries each provider in order. The first non-null
 * `detect()` result wins. Devices that no provider recognises are included in
 * the result with `identity` and `matchedProviderId` absent.
 *
 * @returns One `EnumeratedDevice` per discovered USB device.
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
  // Step 1: Walk the USB tree (or use injected walk for tests).
  const discovered = await (opts.walk ? opts.walk() : discoverUsbIpods());

  // Step 2: Classify each device in parallel (devices are independent hardware).
  const results = await Promise.all(
    discovered.map(async (d): Promise<EnumeratedDevice> => {
      const fingerprint = toFingerprint(d);

      // Try providers in priority order — serial per device (predictable, avoids
      // concurrent SCSI inquiries on the same physical device).
      for (const provider of opts.providers) {
        let identity: DeviceIdentity | null = null;
        try {
          identity = await provider.detect(fingerprint);
        } catch {
          // Provider threw — treat as no-match, continue to next.
          continue;
        }
        if (identity !== null) {
          return { fingerprint, discovered: d, matchedProviderId: provider.id, identity };
        }
      }

      // No provider matched.
      return { fingerprint, discovered: d };
    })
  );

  return results;
}
