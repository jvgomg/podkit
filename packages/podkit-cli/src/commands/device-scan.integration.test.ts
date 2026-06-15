/**
 * Integration test for `device scan` USB enumeration → classification → rendering.
 *
 * Mocks the OS USB walk by feeding a realistic device list directly through
 * `classifyUsbDevices`, then validates that the resulting recognised-device
 * list matches what `device scan` would render. Captures the pre-refactor
 * phantom-iPod regression (8 USB peripherals → 8 phantoms) by asserting
 * non-iPod / non-mass-storage devices drop to zero recognised entries.
 *
 * Coverage at the rendering layer is pinned by the companion unit test
 * `device-scan-render.unit.test.ts`, which exercises `renderDeviceScan`
 * directly with synthetic classified-device sets — including the empty-
 * input regression that asserts the renderer never emits "Unknown iPod"
 * when nothing is on the bus. Together the two files cover the data-flow
 * boundary (here) and the rendering boundary (the unit test).
 */

import { describe, expect, it } from 'bun:test';
import { classifyUsbDevices, type EnumeratedUsbDevice } from '@podkit/core';

// ── Realistic Mac-with-CalDigit-dock fixture ────────────────────────────────

/**
 * Reproduces the user's machine state when no iPods are plugged in: only
 * USB peripherals (CalDigit dock, USB hub, Realtek Ethernet, Logitech mouse,
 * Kingston USB drive). Pre-refactor, `device scan` rendered 8 phantom iPods.
 */
const PERIPHERALS_ONLY: EnumeratedUsbDevice[] = [
  { vendorId: '2188', productId: '0fa0' }, // CalDigit Thunderbolt dock
  { vendorId: '2188', productId: '0fa1' },
  { vendorId: '2188', productId: '0fa2' },
  { vendorId: '2109', productId: '0817' }, // VIA Labs USB hub
  { vendorId: '0bda', productId: '8153' }, // Realtek USB Ethernet
  { vendorId: '046d', productId: '0893' }, // Logitech mouse
  { vendorId: '0951', productId: '16a4' }, // Kingston USB drive
  { vendorId: '3066', productId: '2244' }, // Misc peripheral
];

/**
 * Realistic mixed scan — 1 iPod + 1 Echo Mini + 5 peripherals + 1 iOS device.
 * Specified verbatim in TASK-317.01 AC #8.
 */
const MIXED_SCAN: EnumeratedUsbDevice[] = [
  { vendorId: '05ac', productId: '1209', diskIdentifier: 'disk5' }, // iPod 5G Video (supported)
  { vendorId: '071b', productId: '3203', diskIdentifier: 'disk7' }, // Echo Mini
  { vendorId: '2188', productId: '0fa0' }, // CalDigit dock controller
  { vendorId: '2109', productId: '0817' }, // VIA Labs USB hub
  { vendorId: '0bda', productId: '8153' }, // Realtek Ethernet
  { vendorId: '046d', productId: '0893' }, // Logitech mouse
  { vendorId: '0951', productId: '16a4' }, // Kingston USB drive
  { vendorId: '05ac', productId: '12aa' }, // iPod touch 5G (iOS — unsupported)
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('device scan integration — USB enumeration → classification', () => {
  it('emits zero recognised entries when no iPods are plugged in (peripherals only)', () => {
    // The phantom-iPod regression: pre-refactor this would render 8
    // "Unknown iPod (USB only)" entries. Post-refactor: 0.
    const recognised = classifyUsbDevices(PERIPHERALS_ONLY);
    expect(recognised).toHaveLength(0);
  });

  it('emits exactly 3 recognised entries for the realistic mixed scan', () => {
    const recognised = classifyUsbDevices(MIXED_SCAN);
    expect(recognised).toHaveLength(3);

    // Tally by kind.
    const kinds = recognised.map((r) => r.kind).sort();
    expect(kinds).toEqual(['ipod', 'ipod', 'mass-storage']);

    // Supported iPod (iPod 5G Video).
    const supportedIpod = recognised.find((r) => r.kind === 'ipod' && r.supported);
    expect(supportedIpod).toBeDefined();
    if (supportedIpod && supportedIpod.kind === 'ipod') {
      expect(supportedIpod.device.productId).toBe('1209');
      expect(supportedIpod.device.diskIdentifier).toBe('disk5');
    }

    // Unsupported iPod (iPod touch 5G).
    const unsupportedIpod = recognised.find((r) => r.kind === 'ipod' && !r.supported);
    expect(unsupportedIpod).toBeDefined();
    if (unsupportedIpod && unsupportedIpod.kind === 'ipod') {
      expect(unsupportedIpod.device.productId).toBe('12aa');
      expect(unsupportedIpod.unsupportedReason?.headline).toContain('proprietary sync protocol');
    }

    // Echo Mini.
    const echoMini = recognised.find((r) => r.kind === 'mass-storage');
    expect(echoMini).toBeDefined();
    if (echoMini && echoMini.kind === 'mass-storage') {
      expect(echoMini.presetId).toBe('echo-mini');
      expect(echoMini.device.diskIdentifier).toBe('disk7');
    }
  });

  it('classifies an Echo Mini with no mounted SD card (no diskIdentifier)', () => {
    // AC #11: Echo Mini plugged with SD card removed should still classify as
    // mass-storage rather than fall through to "Unknown iPod (USB only)".
    const recognised = classifyUsbDevices([{ vendorId: '071b', productId: '3203' }]);
    expect(recognised).toHaveLength(1);
    expect(recognised[0]!.kind).toBe('mass-storage');
    if (recognised[0]!.kind === 'mass-storage') {
      expect(recognised[0]!.device.diskIdentifier).toBeUndefined();
    }
  });

  it('preserves deterministic ordering across repeated runs (regression: m-18 §6)', () => {
    // Two iPods + peripherals — the recognised-device list must keep input
    // order so multi-device renders stably.
    const input: EnumeratedUsbDevice[] = [
      { vendorId: '05ac', productId: '1260', diskIdentifier: 'disk6' }, // nano 2G
      { vendorId: '046d', productId: '0893' }, // mouse — dropped
      { vendorId: '05ac', productId: '1263', diskIdentifier: 'disk7' }, // nano 4G
    ];
    const a = classifyUsbDevices(input);
    const b = classifyUsbDevices(input);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a.map((r) => r.device.productId)).toEqual(['1260', '1263']);
    expect(b.map((r) => r.device.productId)).toEqual(['1260', '1263']);
  });
});
