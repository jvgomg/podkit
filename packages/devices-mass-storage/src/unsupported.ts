/**
 * Recognised-but-unsupported USB devices.
 *
 * The complement of the preset table: vendor/product combinations that
 * podkit can identify by USB descriptor but does not (yet) support
 * because no mass-storage preset has been registered for them. Today this
 * is exclusively the Sony Walkman family — the `sony-nwz-e384` persona
 * is the canonical fixture for the eventual preset.
 *
 * Authority for the Sony VID/PID range is `devices/sony-walkman-nwz-e380.md`
 * and the persona's `provenance.md`. Hex values are stored bare (no `0x`)
 * matching `IpodClassification`'s normalisation contract; the lookup
 * accepts both forms.
 *
 * @module
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClassifiableUsbDevice {
  vendorId: string;
  productId: string;
  serialNumber?: string;
  bus?: number;
  devnum?: number;
  diskIdentifier?: string;
}

/**
 * The result of recognising a USB device as a known-but-unsupported DAP.
 *
 * Distinct from `MassStorageClassification` because no preset is known; the
 * only thing the classifier can offer is a canonical rejection reason for
 * `readiness-display`, `doctor`, and `device scan` to surface.
 */
export interface UnsupportedDeviceClassification<
  TDevice extends ClassifiableUsbDevice = ClassifiableUsbDevice,
> {
  kind: 'unsupported';
  device: TDevice;
  /**
   * Family label for output ("Sony Walkman", …). Optional — when absent,
   * consumers fall back to the raw VID/PID.
   */
  family?: string;
  /**
   * Canonical rejection text. Always set when `kind === 'unsupported'`; this
   * is what feeds `ReadinessResult.unsupportedReason` and the doctor's
   * "device not supported" prompt.
   */
  reason: string;
}

interface UnsupportedVendorEntry {
  /** Bare-hex vendor ID. */
  vendorId: string;
  /** Family label for human-readable output. */
  family: string;
  /**
   * Function producing the canonical rejection reason for a matched device.
   * Receives the bare-hex VID/PID so the message can include the exact
   * USB identifier the user is looking at.
   */
  reason: (vendorId: string, productId: string) => string;
}

// ── Table ────────────────────────────────────────────────────────────────────

/**
 * Vendor-level rejection table. A USB device whose vendor matches one of
 * these entries — and which no other classifier (`classifyAsIpod`,
 * `classifyAsMassStorage`) has claimed — is reported as unsupported with
 * the entry's `reason` text.
 *
 * Keep this list short. Anything that is actually supported lives in
 * `presets/built-in.ts` + `usb-hints.ts`; anything that is not a music
 * player is silently dropped by the upstream classifier composer.
 */
export const UNSUPPORTED_VENDORS: ReadonlyArray<UnsupportedVendorEntry> = [
  {
    vendorId: '054c', // Sony Corporation
    family: 'Sony Walkman',
    reason: (vendorId, productId) =>
      `Sony Walkman is not yet supported by podkit — no preset registered for USB 0x${vendorId}:0x${productId}.`,
  },
  {
    vendorId: '0781', // SanDisk Corp.
    family: 'SanDisk USB storage',
    // Generic flash drives are not music players; podkit explicitly refuses
    // to operate on them so users plugging the wrong USB stick into a
    // `podkit sync` invocation get a clear rejection rather than silent
    // probing of an unrelated filesystem. The matching `non-ipod-usb-disk`
    // persona pins this path in test.
    reason: (vendorId, productId) =>
      `Non-Apple USB storage device (SanDisk); podkit has no preset for this vendor (USB 0x${vendorId}:0x${productId}).`,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseId(id: string): string {
  const lower = id.trim().toLowerCase();
  return lower.startsWith('0x') ? lower.slice(2) : lower;
}

// ── classifyAsUnsupportedDevice ──────────────────────────────────────────────

/**
 * Classify a USB device as a known-but-unsupported DAP, or return `null`.
 *
 * Designed to run last in the classifier chain — after `classifyAsIpod`
 * and `classifyAsMassStorage` have had a chance to claim the device. The
 * caller is responsible for ordering.
 */
export function classifyAsUnsupportedDevice<TDevice extends ClassifiableUsbDevice>(
  device: TDevice,
  table: ReadonlyArray<UnsupportedVendorEntry> = UNSUPPORTED_VENDORS
): UnsupportedDeviceClassification<TDevice> | null {
  const vendorId = normaliseId(device.vendorId);
  const productId = normaliseId(device.productId);

  for (const entry of table) {
    if (normaliseId(entry.vendorId) !== vendorId) continue;
    return {
      kind: 'unsupported',
      device,
      family: entry.family,
      reason: entry.reason(vendorId, productId),
    };
  }
  return null;
}
