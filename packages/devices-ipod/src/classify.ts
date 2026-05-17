/**
 * iPod classification — bridges raw USB enumeration to iPod-domain knowledge.
 *
 * `classifyAsIpod` answers a single question: "is this USB device an iPod?".
 * It returns an {@link IpodClassification} when the device is an Apple-vendor
 * USB device with a product ID in the iPod or iOS ranges, and `null`
 * otherwise. Non-Apple vendors (Logitech, Realtek, CalDigit, …) and Apple
 * vendors with PIDs outside the recognised ranges (keyboards, AirPods, …)
 * are dropped here.
 *
 * The result also carries a `supported` flag — some iPod-family devices
 * (Touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G) are recognised but not
 * syncable by podkit; the caller decides how to render them.
 *
 * @module
 */

import type { ReadinessUnsupportedReason } from '@podkit/device-types';
import type { IpodModel } from './types.js';
import { identify } from './identity.js';
import { lookupByUsbId } from './lookups.js';
import { lookupUnsupportedReadinessReason } from './tables/unsupported.js';

// ── Apple vendor matching ────────────────────────────────────────────────────

/** Apple USB vendor ID — bare lower-case hex (no `0x` prefix). */
const APPLE_VENDOR_ID = '05ac';

function normaliseHexId(id: string): string {
  const lower = id.toLowerCase();
  return lower.startsWith('0x') ? lower.slice(2) : lower;
}

/**
 * Defensive vendor / product ID normalisation for `classifyAsIpod`'s public
 * surface.
 *
 * The enumeration layer in `@podkit/core` normalises raw system_profiler
 * strings to bare hex before calling the classifier. But `classifyAsIpod`
 * is a public generic — callers may feed it raw system_profiler input
 * directly. Accept all observed forms here so a real iPod is never silently
 * dropped:
 * - bare hex `"05ac"` / `"1261"` (canonical contract)
 * - `"0x05ac"` / `"0x1261"` (prefixed)
 * - `"0x05ac (Apple Inc.)"` / `"0x1261 (Apple Inc.)"` (suffixed)
 * - `"apple_vendor_id"` (vendor-only sentinel)
 *
 * Returns the bare-hex digits, or the lowercased input when no hex is found
 * (so downstream lookups still get a deterministic value to fail on).
 */
function defensiveNormaliseHexId(id: string): string {
  const lower = id.toLowerCase();
  if (lower === 'apple_vendor_id') return APPLE_VENDOR_ID;
  // `0x05ac`, `0x05ac (Apple Inc.)`, or any 0x-prefixed form: extract the
  // first hex run after `0x`.
  const prefixed = lower.match(/0x([\da-f]+)/);
  if (prefixed) return prefixed[1]!;
  return normaliseHexId(id);
}

function isAppleVendor(vendorId: string): boolean {
  return defensiveNormaliseHexId(vendorId) === APPLE_VENDOR_ID;
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal USB device shape consumed by `classifyAsIpod`.
 *
 * Structurally a subset of `EnumeratedUsbDevice` from `@podkit/core`, but
 * defined locally so that this package does not depend on `@podkit/core`.
 * The classifier only reads `vendorId` and `productId`.
 */
export interface ClassifiableUsbDevice {
  vendorId: string;
  productId: string;
  serialNumber?: string;
  bus?: number;
  devnum?: number;
  diskIdentifier?: string;
}

/**
 * The result of classifying a USB device as an iPod.
 *
 * `supported` is `false` when the device is a known but unsyncable iPod-family
 * member (touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G, Apple Watch). The
 * `unsupportedReason` field carries the structured payload in that case so
 * consumers can render it without re-deriving the `kind` discriminator or the
 * docs URL.
 *
 * `model` is populated when the product ID is in `IPOD_USB_IDS`; for
 * unsupported iOS-range PIDs that are not in that table, `model` is absent
 * but `supported: false` and `unsupportedReason` are still set.
 */
export interface IpodClassification<TDevice extends ClassifiableUsbDevice = ClassifiableUsbDevice> {
  kind: 'ipod';
  device: TDevice;
  model?: IpodModel;
  supported: boolean;
  unsupportedReason?: ReadinessUnsupportedReason;
}

// ── classifyAsIpod ───────────────────────────────────────────────────────────

/**
 * Classify a USB device as an iPod, or return `null` if it isn't.
 *
 * Returns `null` when:
 * - the vendor is not Apple (`0x05ac`), OR
 * - the product ID is not in `IPOD_USB_IDS` AND not in the iOS PID range
 *   (`0x1290–0x12af`) covered by `lookupIosRangeFallbackReason`.
 *
 * Returns `IpodClassification` when one of the above paths matches.
 *
 * The generic `TDevice` lets callers preserve their richer device-shape
 * (e.g. carrying `bus`/`devnum`/`diskIdentifier`) on the returned classification.
 */
export function classifyAsIpod<TDevice extends ClassifiableUsbDevice>(
  device: TDevice
): IpodClassification<TDevice> | null {
  if (!isAppleVendor(device.vendorId)) return null;

  // Normalise the productId to bare hex so callers feeding raw
  // system_profiler strings (e.g. `"0x1261 (Apple Inc.)"`) hit the lookup
  // tables, which key on bare-hex / `0x`-prefixed forms only.
  const productId = defensiveNormaliseHexId(device.productId);

  // Fast path: product ID is in the unsupported table or the iOS range.
  // These devices are reported as unsupported even when they are not in
  // `IPOD_USB_IDS`, so future iPhone/iPad PIDs fail closed with a useful
  // message rather than silently appearing as "Unknown iPod".
  const unsupportedReason = lookupUnsupportedReadinessReason(productId);

  // If the PID is in IPOD_USB_IDS, identify() returns a richer model with
  // generation/checksum metadata; if not, model is undefined.
  const model = identify({ from: 'usb', productId });
  const isKnownIpod = lookupByUsbId(productId) !== undefined;

  // Drop Apple-vendor devices that are neither known iPods nor iOS-range PIDs
  // (keyboards, AirPods, Apple TV, HomePod, etc.).
  if (!isKnownIpod && !unsupportedReason) return null;

  return {
    kind: 'ipod',
    device,
    ...(model ? { model } : {}),
    supported: !unsupportedReason,
    ...(unsupportedReason ? { unsupportedReason } : {}),
  };
}
