/**
 * Device provider interface
 *
 * A `DeviceProvider` is responsible for detecting and identifying a specific
 * class of device from a raw USB fingerprint. Providers are registered in the
 * podkit-core device enumeration layer and tried in priority order.
 *
 * @module
 */

import type { DeviceIdentity } from './identity.js';
import type { UsbFingerprint } from './identity.js';

export type { UsbFingerprint };

/**
 * A provider that can detect and identify a specific class of connected device.
 *
 * @typeParam TIdentity - The identity variant this provider produces.
 *   Defaults to `DeviceIdentity` for generic providers.
 */
export interface DeviceProvider<TIdentity extends DeviceIdentity = DeviceIdentity> {
  /** Unique provider identifier, e.g. `"ipod"` or `"mass-storage"` */
  readonly id: string;
  /**
   * Attempt to identify the device described by `fp`.
   *
   * @returns The resolved identity, or `null` if this provider does not
   *   recognise the device.
   */
  detect(fp: UsbFingerprint): Promise<TIdentity | null>;
}
