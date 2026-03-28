/**
 * Tests for per-codec quality mapping
 *
 * Verifies that quality presets deliver correct bitrates for each codec
 * and that lossless codecs are handled appropriately.
 */

import { describe, expect, it } from 'bun:test';
import {
  AAC_PRESETS,
  ALAC_ESTIMATED_KBPS,
  FLAC_ESTIMATED_KBPS,
  MP3_PRESETS,
  OPUS_PRESETS,
  getCodecPresetBitrate,
  getCodecVbrQuality,
  getLosslessEstimatedKbps,
} from './types.js';
import type { QualityPreset } from './types.js';
import type { TranscodeTargetCodec } from './codecs.js';

const LOSSY_PRESETS: Exclude<QualityPreset, 'max'>[] = ['high', 'medium', 'low'];

describe('OPUS_PRESETS', () => {
  it('has correct bitrates', () => {
    expect(OPUS_PRESETS.high.targetKbps).toBe(160);
    expect(OPUS_PRESETS.medium.targetKbps).toBe(128);
    expect(OPUS_PRESETS.low.targetKbps).toBe(96);
  });

  it('has no vbrQuality (Opus uses -b:a directly)', () => {
    expect(OPUS_PRESETS.high.vbrQuality).toBeUndefined();
    expect(OPUS_PRESETS.medium.vbrQuality).toBeUndefined();
    expect(OPUS_PRESETS.low.vbrQuality).toBeUndefined();
  });
});

describe('MP3_PRESETS', () => {
  it('has correct bitrates', () => {
    expect(MP3_PRESETS.high.targetKbps).toBe(256);
    expect(MP3_PRESETS.medium.targetKbps).toBe(192);
    expect(MP3_PRESETS.low.targetKbps).toBe(128);
  });

  it('has correct vbrQuality values', () => {
    expect(MP3_PRESETS.high.vbrQuality).toBe(0);
    expect(MP3_PRESETS.medium.vbrQuality).toBe(2);
    expect(MP3_PRESETS.low.vbrQuality).toBe(4);
  });
});

describe('getCodecPresetBitrate', () => {
  it('returns correct bitrates for AAC', () => {
    expect(getCodecPresetBitrate('aac', 'high')).toBe(256);
    expect(getCodecPresetBitrate('aac', 'medium')).toBe(192);
    expect(getCodecPresetBitrate('aac', 'low')).toBe(128);
  });

  it('returns correct bitrates for Opus', () => {
    expect(getCodecPresetBitrate('opus', 'high')).toBe(160);
    expect(getCodecPresetBitrate('opus', 'medium')).toBe(128);
    expect(getCodecPresetBitrate('opus', 'low')).toBe(96);
  });

  it('returns correct bitrates for MP3', () => {
    expect(getCodecPresetBitrate('mp3', 'high')).toBe(256);
    expect(getCodecPresetBitrate('mp3', 'medium')).toBe(192);
    expect(getCodecPresetBitrate('mp3', 'low')).toBe(128);
  });

  it('returns undefined for lossless codecs', () => {
    for (const preset of LOSSY_PRESETS) {
      expect(getCodecPresetBitrate('flac', preset)).toBeUndefined();
      expect(getCodecPresetBitrate('alac', preset)).toBeUndefined();
    }
  });

  it('customBitrate overrides preset for all codecs', () => {
    const codecs: TranscodeTargetCodec[] = ['aac', 'opus', 'mp3', 'flac', 'alac'];
    for (const codec of codecs) {
      expect(getCodecPresetBitrate(codec, 'high', 320)).toBe(320);
      expect(getCodecPresetBitrate(codec, 'low', 64)).toBe(64);
    }
  });
});

describe('getCodecVbrQuality', () => {
  it('returns correct AAC VBR quality values', () => {
    expect(getCodecVbrQuality('aac', 'high')).toBe(AAC_PRESETS.high.quality);
    expect(getCodecVbrQuality('aac', 'medium')).toBe(AAC_PRESETS.medium.quality);
    expect(getCodecVbrQuality('aac', 'low')).toBe(AAC_PRESETS.low.quality);
  });

  it('returns correct MP3 VBR quality values', () => {
    expect(getCodecVbrQuality('mp3', 'high')).toBe(0);
    expect(getCodecVbrQuality('mp3', 'medium')).toBe(2);
    expect(getCodecVbrQuality('mp3', 'low')).toBe(4);
  });

  it('returns undefined for Opus (uses -b:a directly)', () => {
    for (const preset of LOSSY_PRESETS) {
      expect(getCodecVbrQuality('opus', preset)).toBeUndefined();
    }
  });

  it('returns undefined for lossless codecs', () => {
    for (const preset of LOSSY_PRESETS) {
      expect(getCodecVbrQuality('flac', preset)).toBeUndefined();
      expect(getCodecVbrQuality('alac', preset)).toBeUndefined();
    }
  });
});

describe('getLosslessEstimatedKbps', () => {
  it('returns 700 for FLAC', () => {
    expect(getLosslessEstimatedKbps('flac')).toBe(700);
  });

  it('returns 900 for ALAC', () => {
    expect(getLosslessEstimatedKbps('alac')).toBe(900);
  });

  it('throws for non-lossless codecs', () => {
    expect(() => getLosslessEstimatedKbps('aac')).toThrow('Not a lossless codec: aac');
    expect(() => getLosslessEstimatedKbps('opus')).toThrow('Not a lossless codec: opus');
    expect(() => getLosslessEstimatedKbps('mp3')).toThrow('Not a lossless codec: mp3');
  });
});

describe('lossless estimation constants', () => {
  it('FLAC_ESTIMATED_KBPS is 700', () => {
    expect(FLAC_ESTIMATED_KBPS).toBe(700);
  });

  it('ALAC_ESTIMATED_KBPS is 900', () => {
    expect(ALAC_ESTIMATED_KBPS).toBe(900);
  });
});
