/**
 * Multi-axis iPod identification facade.
 *
 * `identify()` accepts discriminated inputs from all identification axes
 * (USB, SysInfo, serial) and returns a rich `IpodModel` result.
 *
 * Note on IpodIdentity alignment: The canonical `IpodIdentity` from
 * `@podkit/device-types` requires firmware fields (`firewireGuid`,
 * `serialNumber`, `familyId`) that are not available at USB-ID lookup time.
 * This module returns `IpodModel` instead — a richer "model lookup result"
 * that captures capacity, color, and generation without requiring a live
 * firmware inquiry.
 *
 * @module
 */

import { GENERATIONS } from './tables/generations.js';
import { lookupByUsbId, lookupBySerial, lookupByModelNumber } from './lookups.js';
import { lookupUnsupportedReason } from './tables/unsupported.js';
import type { IpodModel, IpodModelSource } from './types.js';

// ── Input types ──────────────────────────────────────────────────────────────

/** Discriminated input for identify() */
export type IpodModelInput =
  | { from: 'usb'; productId: string }
  | { from: 'sysinfo'; modelNumStr: string }
  | { from: 'serial'; serialNumber: string };

// ── identify ─────────────────────────────────────────────────────────────────

/**
 * Build an IpodModel from a single identification source.
 *
 * Each call produces one IpodModel — no merging. Callers hold multiple
 * models from different sources and pick or compare as needed.
 *
 * @returns IpodModel if the input matches a known model, undefined otherwise
 *
 * @example
 * ```ts
 * // From USB product ID (generation only)
 * identify({ from: 'usb', productId: '0x1260' })
 * // → { displayName: "iPod nano 2nd generation", generationId: "nano_2g", source: "usb" }
 *
 * // From SysInfo model number (full variant)
 * identify({ from: 'sysinfo', modelNumStr: 'MA477' })
 * // → { displayName: "iPod nano 2GB Silver (2nd Generation)", color: "Silver", source: "sysinfo" }
 *
 * // From serial number suffix (full variant)
 * identify({ from: 'serial', serialNumber: '5U828GFNYXX' })
 * // → { displayName: "iPod nano 8GB Black (3rd Generation)", color: "Black", source: "serial" }
 * ```
 */
export function identify(input: IpodModelInput): IpodModel | undefined {
  switch (input.from) {
    case 'usb': {
      const entry = lookupByUsbId(input.productId);
      if (!entry) return undefined;
      const gen = GENERATIONS[entry.generation];
      // Check unsupported PID table first, then fall back to generation flag.
      const notSupportedReason =
        lookupUnsupportedReason(input.productId) ??
        (!gen.supported
          ? `${entry.displayName} is not supported by podkit (libgpod cannot sync this generation).`
          : undefined);
      return {
        displayName: entry.displayName,
        generationId: entry.generation,
        checksumType: gen.checksumType,
        source: 'usb' satisfies IpodModelSource,
        ...(notSupportedReason ? { notSupportedReason } : {}),
      };
    }

    case 'sysinfo': {
      const entry = lookupByModelNumber(input.modelNumStr);
      if (!entry) return undefined;
      const gen = GENERATIONS[entry.generation];
      // Re-derive stripped model number for the modelNumber field
      const upper = input.modelNumStr.toUpperCase();
      const stripped = /^[MPF]/.test(upper) ? upper.slice(1) : upper;
      const notSupportedReason = !gen.supported
        ? `${entry.displayName} is not supported by podkit (libgpod cannot sync this generation).`
        : undefined;
      return {
        displayName: entry.displayName,
        generationId: entry.generation,
        checksumType: gen.checksumType,
        modelNumber: stripped,
        capacityGb: entry.capacityGb,
        color: entry.color,
        source: 'sysinfo' satisfies IpodModelSource,
        ...(notSupportedReason ? { notSupportedReason } : {}),
      };
    }

    case 'serial': {
      const serial = input.serialNumber;
      if (!serial || serial.length < 3) return undefined;
      const suffix = serial.slice(-3);
      const variant = lookupBySerial(suffix);
      if (!variant) return undefined;
      const gen = GENERATIONS[variant.generation];
      const notSupportedReason = !gen.supported
        ? `${variant.displayName} is not supported by podkit (libgpod cannot sync this generation).`
        : undefined;
      return {
        displayName: variant.displayName,
        generationId: variant.generation,
        checksumType: gen.checksumType,
        modelNumber: variant.modelNumber,
        capacityGb: variant.capacityGb,
        color: variant.color,
        source: 'serial' satisfies IpodModelSource,
        ...(notSupportedReason ? { notSupportedReason } : {}),
      };
    }
  }
}
