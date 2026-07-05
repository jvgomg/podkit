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
 * Display strings (`IpodModel.displayName`) are composed by `formatIpodLabel`
 * from the structured family + ordinal + capacity/color/variant fields per
 * ADR-020. No upstream table stores hand-curated label strings.
 *
 * @module
 */

import { GENERATIONS } from './tables/generations.js';
import { lookupByUsbId, lookupBySerial, lookupByModelNumber } from './lookups.js';
import { lookupUnsupportedReason } from './tables/unsupported.js';
import { buildUnsupportedReason } from './build-unsupported-reason.js';
import { formatIpodLabel } from './format.js';
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
 * identify({ from: 'usb', productId: '0x1262' })
 * // → { displayName: "iPod nano (3rd Generation)", family: "iPod nano", ordinal: 3, … }
 *
 * // From SysInfo model number (full variant)
 * identify({ from: 'sysinfo', modelNumStr: 'MA477' })
 * // → { displayName: "iPod nano 2GB Silver (2nd Generation)", color: "Silver", … }
 *
 * // From serial number suffix (full variant)
 * identify({ from: 'serial', serialNumber: '5U828GFNYXX' })
 * // → { displayName: "iPod nano 8GB Black (3rd Generation)", color: "Black", … }
 * ```
 */
export function identify(input: IpodModelInput): IpodModel | undefined {
  switch (input.from) {
    case 'usb': {
      const entry = lookupByUsbId(input.productId);
      if (!entry) return undefined;
      const gen = GENERATIONS[entry.generation];
      const displayName = formatIpodLabel({ family: gen.family, ordinal: gen.ordinal });
      // Check unsupported PID table first, then fall back to the access tier.
      const headline =
        lookupUnsupportedReason(input.productId) ??
        (gen.support.access !== 'syncable'
          ? `${displayName} is not a podkit-supported generation.`
          : undefined);
      const unsupportedReason = headline
        ? buildUnsupportedReason(headline, entry.generation)
        : undefined;
      return {
        displayName,
        generationId: entry.generation,
        family: gen.family,
        ordinal: gen.ordinal,
        checksumType: gen.checksumType,
        source: 'usb' satisfies IpodModelSource,
        ...(unsupportedReason ? { unsupportedReason } : {}),
      };
    }

    case 'sysinfo': {
      const entry = lookupByModelNumber(input.modelNumStr);
      if (!entry) return undefined;
      const gen = GENERATIONS[entry.generation];
      const displayName = formatIpodLabel({
        family: gen.family,
        ordinal: gen.ordinal,
        capacityGb: entry.capacityGb,
        color: entry.color,
        variant: entry.variant,
      });
      // Re-derive stripped model number for the modelNumber field
      const upper = input.modelNumStr.toUpperCase();
      const stripped = /^[MPF]/.test(upper) ? upper.slice(1) : upper;
      const headline =
        gen.support.access !== 'syncable'
          ? `${displayName} is not a podkit-supported generation.`
          : undefined;
      const unsupportedReason = headline
        ? buildUnsupportedReason(headline, entry.generation)
        : undefined;
      return {
        displayName,
        generationId: entry.generation,
        family: gen.family,
        ordinal: gen.ordinal,
        checksumType: gen.checksumType,
        modelNumber: stripped,
        capacityGb: entry.capacityGb,
        color: entry.color,
        ...(entry.variant ? { variant: entry.variant } : {}),
        source: 'sysinfo' satisfies IpodModelSource,
        ...(unsupportedReason ? { unsupportedReason } : {}),
      };
    }

    case 'serial': {
      const serial = input.serialNumber;
      if (!serial || serial.length < 3) return undefined;
      const suffix = serial.slice(-3);
      const variant = lookupBySerial(suffix);
      if (!variant) return undefined;
      const gen = GENERATIONS[variant.generation];
      const displayName = formatIpodLabel({
        family: gen.family,
        ordinal: gen.ordinal,
        capacityGb: variant.capacityGb,
        color: variant.color,
        variant: variant.variant,
      });
      const headline =
        gen.support.access !== 'syncable'
          ? `${displayName} is not a podkit-supported generation.`
          : undefined;
      const unsupportedReason = headline
        ? buildUnsupportedReason(headline, variant.generation)
        : undefined;
      return {
        displayName,
        generationId: variant.generation,
        family: gen.family,
        ordinal: gen.ordinal,
        checksumType: gen.checksumType,
        modelNumber: variant.modelNumber,
        capacityGb: variant.capacityGb,
        color: variant.color,
        ...(variant.variant ? { variant: variant.variant } : {}),
        source: 'serial' satisfies IpodModelSource,
        ...(unsupportedReason ? { unsupportedReason } : {}),
      };
    }
  }
}
