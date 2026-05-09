/**
 * Mass-storage classification — bridges raw USB enumeration to known DAP presets.
 *
 * `classifyAsMassStorage` answers a single question: "is this USB device a
 * mass-storage music player podkit knows about?". It walks the USB hint table
 * (`USB_PRESET_HINTS`) and returns a {@link MassStorageClassification} when a
 * VID/PID matches a built-in preset (Echo Mini, …); `null` otherwise.
 *
 * Generic mass-storage fallback (matching every USB device to the `'generic'`
 * preset) is intentionally out of scope here — it would defeat the purpose of
 * filtering peripherals out of `device scan`. Callers that want generic
 * behaviour can layer it on top of this classifier explicitly.
 *
 * @module
 */

import type { MassStoragePreset } from './presets/types.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import { USB_PRESET_HINTS, type UsbPresetHint } from './usb-hints.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal USB device shape consumed by `classifyAsMassStorage`.
 *
 * Structurally a subset of `EnumeratedUsbDevice` from `@podkit/core`, but
 * defined locally so that this package does not depend on `@podkit/core`.
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
 * The result of classifying a USB device as a known mass-storage DAP.
 *
 * `presetId` names the matched preset (e.g. `'echo-mini'`); `preset` is the
 * fully-resolved capability snapshot looked up at classification time.
 * `confidence` reflects how specific the match is — `'exact'` for VID+PID,
 * `'partial'` for vendor-only matches.
 */
export interface MassStorageClassification<
  TDevice extends ClassifiableUsbDevice = ClassifiableUsbDevice,
> {
  kind: 'mass-storage';
  device: TDevice;
  presetId: string;
  preset: MassStoragePreset;
  confidence: 'exact' | 'partial';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseId(id: string): string {
  const cleaned = id.trim().toLowerCase();
  const hex = cleaned.startsWith('0x') ? cleaned.slice(2) : cleaned;
  return hex;
}

// ── classifyAsMassStorage ───────────────────────────────────────────────────

/**
 * Classify a USB device as a known mass-storage music player, or return `null`.
 *
 * @param device - USB device to classify (carries `vendorId` / `productId`).
 * @param presets - Optional preset map. When supplied, only hints whose
 *   `presetId` exists as a key in this map produce a match — this lets callers
 *   restrict classification to presets that are in scope (e.g. the user has
 *   removed a preset from the registry). Defaults to `BUILT_IN_PRESETS`.
 * @param usbHints - Optional hint table. Defaults to `USB_PRESET_HINTS`.
 *   Injectable for tests and for callers that want to extend / override the
 *   built-in VID/PID → preset mappings.
 *
 * Returns `null` when no hint matches the device's VID/PID. The matched
 * preset object is included on the result so callers do not need a second
 * lookup against the presets map.
 */
export function classifyAsMassStorage<TDevice extends ClassifiableUsbDevice>(
  device: TDevice,
  presets: Record<string, MassStoragePreset> = BUILT_IN_PRESETS,
  usbHints: ReadonlyArray<UsbPresetHint> = USB_PRESET_HINTS
): MassStorageClassification<TDevice> | null {
  const vendorId = normaliseId(device.vendorId);
  const productId = normaliseId(device.productId);

  for (const hint of usbHints) {
    if (normaliseId(hint.vendorId) !== vendorId) continue;
    if (hint.confidence === 'exact' && normaliseId(hint.productId) !== productId) continue;

    const preset = presets[hint.presetId];
    if (!preset) continue;

    return {
      kind: 'mass-storage',
      device,
      presetId: hint.presetId,
      preset,
      // Translate hint-table 'vendor-only' to public 'partial' so the
      // classifier surface is decoupled from internal hint vocabulary —
      // callers reason about match specificity, not how the hint table
      // happens to spell it.
      confidence: hint.confidence === 'exact' ? 'exact' : 'partial',
    };
  }

  return null;
}
