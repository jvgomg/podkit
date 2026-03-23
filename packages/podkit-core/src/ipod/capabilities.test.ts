/**
 * Tests for device capabilities
 */

import { describe, expect, it } from 'bun:test';
import { getDeviceCapabilities } from './capabilities.js';
import { isValidTransferMode } from '../transcode/types.js';

describe('getDeviceCapabilities', () => {
  describe('ALAC-capable device (classic_3)', () => {
    const caps = getDeviceCapabilities('classic_3');

    it('includes alac in supported audio codecs', () => {
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('includes wav and aiff for ALAC-capable devices', () => {
      expect(caps.supportedAudioCodecs).toContain('wav');
      expect(caps.supportedAudioCodecs).toContain('aiff');
    });

    it('includes base codecs aac and mp3', () => {
      expect(caps.supportedAudioCodecs).toContain('aac');
      expect(caps.supportedAudioCodecs).toContain('mp3');
    });

    it('supports video', () => {
      expect(caps.supportsVideo).toBe(true);
    });

    it('has database artwork source', () => {
      expect(caps.artworkSources).toEqual(['database']);
    });

    it('has 320px artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(320);
    });
  });

  describe('non-ALAC device (nano_2)', () => {
    const caps = getDeviceCapabilities('nano_2');

    it('only supports aac and mp3', () => {
      expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    });

    it('does not include alac', () => {
      expect(caps.supportedAudioCodecs).not.toContain('alac');
    });

    it('does not support video', () => {
      expect(caps.supportsVideo).toBe(false);
    });

    it('has 176px artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(176);
    });

    it('has database artwork source', () => {
      expect(caps.artworkSources).toEqual(['database']);
    });
  });

  describe('shuffle (shuffle_3)', () => {
    const caps = getDeviceCapabilities('shuffle_3');

    it('only supports aac and mp3', () => {
      expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    });

    it('does not support video', () => {
      expect(caps.supportsVideo).toBe(false);
    });

    it('has no artwork sources (no screen)', () => {
      expect(caps.artworkSources).toEqual([]);
    });

    it('has 0 artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(0);
    });
  });

  describe('video-capable device (video_1)', () => {
    const caps = getDeviceCapabilities('video_1');

    it('supports video', () => {
      expect(caps.supportsVideo).toBe(true);
    });

    it('includes alac (video iPods support ALAC)', () => {
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('has 320px artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(320);
    });
  });

  describe('unknown generation', () => {
    const caps = getDeviceCapabilities('unknown');

    it('only supports base codecs', () => {
      expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    });

    it('does not support video', () => {
      expect(caps.supportsVideo).toBe(false);
    });

    it('has 0 artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(0);
    });

    it('has no artwork sources', () => {
      expect(caps.artworkSources).toEqual([]);
    });
  });

  describe('nano with color screen but no ALAC (nano_1)', () => {
    const caps = getDeviceCapabilities('nano_1');

    it('has 176px artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(176);
    });

    it('has database artwork source', () => {
      expect(caps.artworkSources).toEqual(['database']);
    });

    it('does not include alac', () => {
      expect(caps.supportedAudioCodecs).not.toContain('alac');
    });
  });

  describe('touch device (touch_1)', () => {
    const caps = getDeviceCapabilities('touch_1');

    it('has 320px artwork resolution', () => {
      expect(caps.artworkMaxResolution).toBe(320);
    });

    it('has database artwork source', () => {
      expect(caps.artworkSources).toEqual(['database']);
    });
  });

  it('accepts string generation values', () => {
    // Ensure the string overload works without type errors
    const gen: string = 'classic_3';
    const caps = getDeviceCapabilities(gen);
    expect(caps.supportedAudioCodecs).toContain('alac');
  });

  it('handles unrecognized generation string gracefully', () => {
    const caps = getDeviceCapabilities('nonexistent_device');
    expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    expect(caps.supportsVideo).toBe(false);
    expect(caps.artworkMaxResolution).toBe(0);
    expect(caps.artworkSources).toEqual([]);
  });
});

describe('isValidTransferMode', () => {
  it('returns true for valid transfer modes', () => {
    expect(isValidTransferMode('fast')).toBe(true);
    expect(isValidTransferMode('optimized')).toBe(true);
    expect(isValidTransferMode('portable')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isValidTransferMode('invalid')).toBe(false);
    expect(isValidTransferMode('')).toBe(false);
    expect(isValidTransferMode('optimised')).toBe(false);
  });

  it('returns false for old FileMode values not in TransferMode', () => {
    // 'optimized' and 'portable' are shared, but 'fast' is new to TransferMode
    // There are no FileMode-only values that aren't in TransferMode
    expect(isValidTransferMode('fast')).toBe(true);
  });
});
