/**
 * Tests for transcoding types and presets
 *
 * @see ADR-010 for preset redesign context
 */

import { describe, expect, it } from 'bun:test';
import {
  AAC_PRESETS,
  ALAC_PRESET,
  QUALITY_PRESETS,
  getPresetBitrate,
  isMaxPreset,
  isValidQualityPreset,
  isVbrEncoding,
} from './types.js';

describe('QualityPreset', () => {
  it('has exactly 4 presets', () => {
    expect(QUALITY_PRESETS).toHaveLength(4);
  });

  it('includes max, high, medium, low', () => {
    expect(QUALITY_PRESETS).toContain('max');
    expect(QUALITY_PRESETS).toContain('high');
    expect(QUALITY_PRESETS).toContain('medium');
    expect(QUALITY_PRESETS).toContain('low');
  });

  it('only includes valid preset names', () => {
    expect(QUALITY_PRESETS).not.toContain('lossless');
    expect(QUALITY_PRESETS).not.toContain('max-cbr');
    expect(QUALITY_PRESETS).not.toContain('high-cbr');
    expect(QUALITY_PRESETS).not.toContain('medium-cbr');
    expect(QUALITY_PRESETS).not.toContain('low-cbr');
  });
});

describe('isValidQualityPreset', () => {
  it('accepts valid preset names', () => {
    expect(isValidQualityPreset('max')).toBe(true);
    expect(isValidQualityPreset('high')).toBe(true);
    expect(isValidQualityPreset('medium')).toBe(true);
    expect(isValidQualityPreset('low')).toBe(true);
  });

  it('rejects invalid preset names', () => {
    expect(isValidQualityPreset('lossless')).toBe(false);
    expect(isValidQualityPreset('max-cbr')).toBe(false);
    expect(isValidQualityPreset('high-cbr')).toBe(false);
    expect(isValidQualityPreset('medium-cbr')).toBe(false);
    expect(isValidQualityPreset('low-cbr')).toBe(false);
  });

  it('rejects arbitrary strings', () => {
    expect(isValidQualityPreset('invalid')).toBe(false);
    expect(isValidQualityPreset('')).toBe(false);
    expect(isValidQualityPreset('MAX')).toBe(false);
  });
});

describe('AAC_PRESETS', () => {
  it('has 3 presets (high, medium, low)', () => {
    expect(Object.keys(AAC_PRESETS)).toHaveLength(3);
    expect(AAC_PRESETS.high).toBeDefined();
    expect(AAC_PRESETS.medium).toBeDefined();
    expect(AAC_PRESETS.low).toBeDefined();
  });

  it('does not include max', () => {
    expect('max' in AAC_PRESETS).toBe(false);
  });

  it('high preset has correct values', () => {
    expect(AAC_PRESETS.high.mode).toBe('vbr');
    expect(AAC_PRESETS.high.quality).toBe(5);
    expect(AAC_PRESETS.high.targetKbps).toBe(256);
  });

  it('medium preset has correct values', () => {
    expect(AAC_PRESETS.medium.mode).toBe('vbr');
    expect(AAC_PRESETS.medium.quality).toBe(4);
    expect(AAC_PRESETS.medium.targetKbps).toBe(192);
  });

  it('low preset has correct values', () => {
    expect(AAC_PRESETS.low.mode).toBe('vbr');
    expect(AAC_PRESETS.low.quality).toBe(2);
    expect(AAC_PRESETS.low.targetKbps).toBe(128);
  });
});

describe('ALAC_PRESET', () => {
  it('has alac codec and m4a container', () => {
    expect(ALAC_PRESET.codec).toBe('alac');
    expect(ALAC_PRESET.container).toBe('m4a');
  });
});

describe('getPresetBitrate', () => {
  it('returns 256 for max (same as high)', () => {
    expect(getPresetBitrate('max')).toBe(256);
  });

  it('returns 256 for high', () => {
    expect(getPresetBitrate('high')).toBe(256);
  });

  it('returns 192 for medium', () => {
    expect(getPresetBitrate('medium')).toBe(192);
  });

  it('returns 128 for low', () => {
    expect(getPresetBitrate('low')).toBe(128);
  });

  it('returns customBitrate when provided', () => {
    expect(getPresetBitrate('high', 320)).toBe(320);
    expect(getPresetBitrate('low', 64)).toBe(64);
    expect(getPresetBitrate('max', 192)).toBe(192);
  });

  it('customBitrate overrides preset default', () => {
    expect(getPresetBitrate('high', 128)).toBe(128);
  });

  it('returns 900 for lossless (ALAC estimate)', () => {
    expect(getPresetBitrate('lossless')).toBe(900);
  });
});

describe('isMaxPreset', () => {
  it('returns true for max', () => {
    expect(isMaxPreset('max')).toBe(true);
  });

  it('returns false for other presets', () => {
    expect(isMaxPreset('high')).toBe(false);
    expect(isMaxPreset('medium')).toBe(false);
    expect(isMaxPreset('low')).toBe(false);
  });
});

describe('isVbrEncoding', () => {
  it('returns true for vbr', () => {
    expect(isVbrEncoding('vbr')).toBe(true);
  });

  it('returns false for cbr', () => {
    expect(isVbrEncoding('cbr')).toBe(false);
  });

  it('returns true for undefined (default is vbr)', () => {
    expect(isVbrEncoding(undefined)).toBe(true);
  });
});
