/**
 * Unit tests for the display-string helpers + the built-in presets' display
 * fields. Locks in the labels users see in `device add` (rich form) and
 * `device list` (short form).
 */
import { describe, it, expect } from 'bun:test';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import { definePreset } from './preset.js';
import { formatPresetDisplay, formatPresetShortDisplay } from './display.js';

describe('formatPresetDisplay (rich form)', () => {
  it('echo-mini → "FiiO Snowsky Echo Mini (echo-mini)"', () => {
    expect(formatPresetDisplay('echo-mini', BUILT_IN_PRESETS['echo-mini'])).toBe(
      'FiiO Snowsky Echo Mini (echo-mini)'
    );
  });

  it('rockbox → "Rockbox Rockbox device (rockbox)"', () => {
    expect(formatPresetDisplay('rockbox', BUILT_IN_PRESETS['rockbox'])).toBe(
      'Rockbox Rockbox device (rockbox)'
    );
  });

  it('generic → "Generic Mass-storage device (generic)"', () => {
    expect(formatPresetDisplay('generic', BUILT_IN_PRESETS['generic'])).toBe(
      'Generic Mass-storage device (generic)'
    );
  });

  it('honours user-defined preset manufacturer + productName', () => {
    const preset = definePreset({
      id: 'my-dap',
      manufacturer: 'Acme',
      productName: 'TunesBox 3000',
      capabilities: { supportedAudioCodecs: ['mp3'] },
    });
    expect(formatPresetDisplay('my-dap', preset)).toBe('Acme TunesBox 3000 (my-dap)');
  });

  it('user-defined preset without display fields inherits from extends baseline', () => {
    // Inheriting from echo-mini → manufacturer/productName flow through.
    const preset = definePreset({ id: 'my-echo', extends: 'echo-mini' });
    expect(formatPresetDisplay('my-echo', preset)).toBe('FiiO Snowsky Echo Mini (my-echo)');
  });

  it('user-defined preset without extends falls back to generic baseline', () => {
    // No manufacturer/productName + no extends → generic baseline strings.
    const preset = definePreset({ id: 'minimal' });
    expect(formatPresetDisplay('minimal', preset)).toBe('Generic Mass-storage device (minimal)');
  });
});

describe('formatPresetShortDisplay (short form)', () => {
  it('echo-mini → "Echo Mini"', () => {
    expect(formatPresetShortDisplay(BUILT_IN_PRESETS['echo-mini'])).toBe('Echo Mini');
  });

  it('rockbox → "Rockbox device"', () => {
    expect(formatPresetShortDisplay(BUILT_IN_PRESETS['rockbox'])).toBe('Rockbox device');
  });

  it('generic → "Mass-storage device"', () => {
    expect(formatPresetShortDisplay(BUILT_IN_PRESETS['generic'])).toBe('Mass-storage device');
  });
});

describe('built-in presets carry required display fields', () => {
  for (const id of ['echo-mini', 'rockbox', 'generic'] as const) {
    it(`${id} has manufacturer + productName`, () => {
      const preset = BUILT_IN_PRESETS[id];
      expect(preset.manufacturer).toBeTruthy();
      expect(preset.productName).toBeTruthy();
    });
  }
});
