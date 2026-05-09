import { describe, expect, it } from 'bun:test';
import { classifyAsMassStorage } from './classify.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import type { UsbPresetHint } from './usb-hints.js';

describe('classifyAsMassStorage — known presets', () => {
  it('classifies Echo Mini (0x071b:0x3203) as mass-storage with echo-mini preset', () => {
    const result = classifyAsMassStorage({ vendorId: '071b', productId: '3203' });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('mass-storage');
    expect(result!.presetId).toBe('echo-mini');
    expect(result!.confidence).toBe('exact');
    expect(result!.preset).toBe(BUILT_IN_PRESETS['echo-mini']!);
  });

  it('preserves passed-in device fields on the classification', () => {
    const device = {
      vendorId: '071b',
      productId: '3203',
      serialNumber: 'EM-SERIAL-001',
      bus: 5,
      devnum: 3,
      diskIdentifier: 'disk7',
    };
    const result = classifyAsMassStorage(device);
    expect(result!.device).toEqual(device);
  });

  it('accepts vendorId/productId with 0x prefix', () => {
    const result = classifyAsMassStorage({ vendorId: '0x071b', productId: '0x3203' });
    expect(result).not.toBeNull();
    expect(result!.presetId).toBe('echo-mini');
  });

  it('accepts upper-case hex IDs', () => {
    const result = classifyAsMassStorage({ vendorId: '071B', productId: '3203' });
    expect(result).not.toBeNull();
  });
});

describe('classifyAsMassStorage — unknown devices', () => {
  it('returns null for an iPod Classic (0x05ac:0x1209)', () => {
    expect(classifyAsMassStorage({ vendorId: '05ac', productId: '1209' })).toBeNull();
  });

  it('returns null for a Logitech mouse (0x046d:0x0893)', () => {
    expect(classifyAsMassStorage({ vendorId: '046d', productId: '0893' })).toBeNull();
  });

  it('returns null for a CalDigit Thunderbolt dock (0x2188:*)', () => {
    expect(classifyAsMassStorage({ vendorId: '2188', productId: '0fa0' })).toBeNull();
  });

  it('returns null for a Kingston USB drive (0x0951:0x16a4) — generic mass storage is not auto-claimed', () => {
    expect(classifyAsMassStorage({ vendorId: '0951', productId: '16a4' })).toBeNull();
  });
});

// ── Confidence translation: hint-table 'vendor-only' → public 'partial' ────
//
// `UsbPresetHint.confidence` is internal vocabulary: 'exact' | 'vendor-only'.
// `MassStorageClassification.confidence` is public surface: 'exact' | 'partial'.
// These tests pin the translation contract — see classify.ts for rationale.

describe('classifyAsMassStorage — confidence translation', () => {
  it("translates a 'vendor-only' hint to public 'partial' confidence", () => {
    const customHints: UsbPresetHint[] = [
      { vendorId: '0x071b', productId: '0x0000', presetId: 'echo-mini', confidence: 'vendor-only' },
    ];
    // Different productId from the hint — vendor-only matches anyway.
    const result = classifyAsMassStorage(
      { vendorId: '071b', productId: 'cafe' },
      BUILT_IN_PRESETS,
      customHints
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('partial');
    expect(result!.presetId).toBe('echo-mini');
  });

  it("retains 'exact' confidence when the hint is exact (built-in Echo Mini case)", () => {
    const result = classifyAsMassStorage({ vendorId: '071b', productId: '3203' });
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('exact');
  });
});

describe('classifyAsMassStorage — preset map filtering', () => {
  it('returns null when the preset is not present in the supplied preset map', () => {
    const result = classifyAsMassStorage(
      { vendorId: '071b', productId: '3203' },
      // Empty preset map — nothing matches.
      {}
    );
    expect(result).toBeNull();
  });

  it('matches when the preset is present in a custom preset map', () => {
    const customPresets = { 'echo-mini': BUILT_IN_PRESETS['echo-mini']! };
    const result = classifyAsMassStorage({ vendorId: '071b', productId: '3203' }, customPresets);
    expect(result).not.toBeNull();
    expect(result!.preset).toBe(customPresets['echo-mini']);
  });
});
