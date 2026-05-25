/**
 * Canonical builders that derive runtime fixture shapes from a
 * {@link DevicePersona}.
 *
 * Tests in higher layers (podkit-cli, e2e) frequently need an
 * `EnumeratedUsbDevice` matching a known persona — for example, to feed
 * `classifyAsIpod` and walk the rendering pipeline. Hand-rolling those
 * fixtures inline keeps the test self-contained but loses the link back to
 * the persona registry, so when a persona is renamed or its USB IDs change
 * the inline fixtures drift silently.
 *
 * Going through these builders keeps the persona registry as the single
 * source of truth for "what USB descriptor does this device present?".
 *
 * @module
 */

import type { EnumeratedUsbDevice } from '@podkit/core';
import type { DevicePersona } from './types.js';

/**
 * Render a {@link DevicePersona}'s USB descriptor as a bare
 * {@link EnumeratedUsbDevice} — the shape the enumeration layer in
 * `@podkit/core` produces for a recognised USB device.
 *
 * `vendorId` and `productId` are normalised to four-digit lower-case bare
 * hex (no `0x` prefix), matching the contract that downstream classifiers
 * key on. `serialNumber` is populated from `persona.usbDescriptor.deviceSerial`.
 *
 * Pass `overrides` to add or override fields the caller cares about (for
 * example, a `diskIdentifier` to simulate a Linux block-device match).
 *
 * @example
 * ```ts
 * import { ipodTouch5gUnsupported } from '@podkit/device-testing';
 * import { buildEnumeratedUsbDevice } from '@podkit/device-testing';
 *
 * const device = buildEnumeratedUsbDevice(ipodTouch5gUnsupported);
 * // → { vendorId: '05ac', productId: '12aa', serialNumber: '...' }
 * ```
 */
export function buildEnumeratedUsbDevice(
  persona: DevicePersona,
  overrides: Partial<EnumeratedUsbDevice> = {}
): EnumeratedUsbDevice {
  const vendorId = persona.usbDescriptor.vendorId.toString(16).padStart(4, '0');
  const productId = persona.usbDescriptor.productId.toString(16).padStart(4, '0');
  return {
    vendorId,
    productId,
    ...(persona.usbDescriptor.deviceSerial
      ? { serialNumber: persona.usbDescriptor.deviceSerial }
      : {}),
    ...overrides,
  };
}
