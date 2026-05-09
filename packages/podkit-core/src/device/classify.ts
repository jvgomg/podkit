/**
 * USB device classification — composes per-domain classifiers.
 *
 * `classifyUsbDevices` takes a list of platform-agnostic
 * {@link EnumeratedUsbDevice} entries (from `enumerateUsb`) and produces a
 * tagged union of recognised devices. Unrecognised entries (Logitech mice,
 * Thunderbolt docks, USB hubs, …) are dropped.
 *
 * Each per-domain classifier (`classifyAsIpod`, `classifyAsMassStorage`)
 * lives in its own `@podkit/devices-*` package and is responsible for
 * knowing which devices belong to its domain. The composer here is pure
 * orchestration: try each classifier in priority order, take the first
 * non-null result, drop the device if none match.
 */

import { classifyAsIpod, type IpodClassification } from '@podkit/devices-ipod';
import {
  classifyAsMassStorage,
  type MassStorageClassification,
} from '@podkit/devices-mass-storage';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A USB device recognised by one of the per-domain classifiers.
 *
 * The `kind` discriminator is forwarded from the matching classifier
 * (`'ipod'` or `'mass-storage'`); narrow on it to access kind-specific
 * fields.
 */
export type RecognizedDevice =
  | IpodClassification<EnumeratedUsbDevice>
  | MassStorageClassification<EnumeratedUsbDevice>;

/**
 * Options for `classifyUsbDevices`.
 */
export interface ClassifyUsbDevicesOptions {
  /**
   * Mass-storage presets in scope. Defaults to the built-in preset map
   * embedded in `@podkit/devices-mass-storage`. Override to restrict or
   * extend the set of recognised mass-storage DAPs.
   */
  massStoragePresets?: Record<string, MassStoragePreset>;
}

// ── classifyUsbDevices ───────────────────────────────────────────────────────

/**
 * Classify enumerated USB devices into recognised iPods and mass-storage DAPs.
 *
 * For each input device the classifiers are tried in priority order:
 *
 * 1. `classifyAsIpod` — claims Apple-vendor devices in iPod / iOS PID ranges.
 * 2. `classifyAsMassStorage` — claims devices whose VID/PID matches a known
 *    mass-storage preset hint (Echo Mini, …).
 *
 * The first non-null result wins. Devices that no classifier claims
 * (Logitech mice, Realtek Ethernet, USB hubs, Thunderbolt dock controllers, …)
 * are dropped from the output entirely.
 *
 * Pure function — no I/O, no side effects.
 */
export function classifyUsbDevices(
  devices: EnumeratedUsbDevice[],
  options: ClassifyUsbDevicesOptions = {}
): RecognizedDevice[] {
  const results: RecognizedDevice[] = [];
  for (const device of devices) {
    const ipod = classifyAsIpod(device);
    if (ipod) {
      results.push(ipod);
      continue;
    }
    const massStorage = classifyAsMassStorage(device, options.massStoragePresets);
    if (massStorage) {
      results.push(massStorage);
      continue;
    }
  }
  return results;
}
