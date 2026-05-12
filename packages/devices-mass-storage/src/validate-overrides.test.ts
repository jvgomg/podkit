/**
 * Tests for validateCapabilityOverrides()
 */

import { describe, expect, it } from 'bun:test';
import { validateCapabilityOverrides } from './validate-overrides.js';
import type { DeviceCapabilities } from '@podkit/device-types';

// =============================================================================
// Empty / all-valid overrides
// =============================================================================

describe('validateCapabilityOverrides — empty / all-valid overrides', () => {
  it('returns ok for empty overrides', () => {
    const result = validateCapabilityOverrides({});
    expect(result.ok).toBe(true);
  });

  it('returns ok for all valid overrides', () => {
    const result = validateCapabilityOverrides({
      artworkMaxResolution: 500,
      artworkSources: ['database', 'embedded'],
      supportedAudioCodecs: ['aac', 'mp3', 'flac'],
      supportsVideo: false,
      audioNormalization: 'replaygain',
      supportsAlbumArtistBrowsing: true,
    });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// artworkMaxResolution
// =============================================================================

describe('validateCapabilityOverrides — artworkMaxResolution', () => {
  it('accepts null (valid "clear" value)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: null });
    expect(result.ok).toBe(true);
  });

  it('accepts 1 (lower boundary)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: 1 });
    expect(result.ok).toBe(true);
  });

  it('accepts 10000 (upper boundary)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: 10000 });
    expect(result.ok).toBe(true);
  });

  it('rejects 0 (below range)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err?.field).toBe('artworkMaxResolution');
      expect(err?.code).toBe('INVALID_ARTWORK_RESOLUTION');
      expect(err?.message).toContain('"0"');
    }
  });

  it('rejects 10001 (above range)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: 10001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [err] = result.errors;
      expect(err?.message).toContain('"10001"');
      expect(err?.message).toContain('1 and 10000');
    }
  });

  it('rejects 1.5 (non-integer)', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [err] = result.errors;
      expect(err?.code).toBe('INVALID_ARTWORK_RESOLUTION');
    }
  });

  it('rejects NaN', () => {
    const result = validateCapabilityOverrides({ artworkMaxResolution: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [err] = result.errors;
      expect(err?.code).toBe('INVALID_ARTWORK_RESOLUTION');
    }
  });
});

// =============================================================================
// artworkSources
// =============================================================================

describe('validateCapabilityOverrides — artworkSources', () => {
  it('accepts all valid sources', () => {
    const result = validateCapabilityOverrides({
      artworkSources: ['database', 'embedded', 'sidecar'],
    });
    expect(result.ok).toBe(true);
  });

  it('reports only the invalid source, not valid ones', () => {
    // Cast via unknown to simulate a caller passing an unvalidated string
    const result = validateCapabilityOverrides({
      artworkSources: [
        'database',
        'invalid-source' as unknown as DeviceCapabilities['artworkSources'][number],
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err?.field).toBe('artworkSources');
      expect(err?.code).toBe('INVALID_ARTWORK_SOURCE');
      expect(err?.message).toContain('"invalid-source"');
      expect(err?.message).toContain('database, embedded, sidecar');
    }
  });

  it('reports multiple invalid sources as separate errors', () => {
    const result = validateCapabilityOverrides({
      artworkSources: ['bad1', 'bad2'] as unknown as DeviceCapabilities['artworkSources'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
    }
  });
});

// =============================================================================
// supportedAudioCodecs
// =============================================================================

describe('validateCapabilityOverrides — supportedAudioCodecs', () => {
  it('accepts all valid codecs', () => {
    const result = validateCapabilityOverrides({
      supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'opus', 'wav', 'aiff'],
    });
    expect(result.ok).toBe(true);
  });

  it('reports only the invalid codec, not valid ones', () => {
    const result = validateCapabilityOverrides({
      supportedAudioCodecs: [
        'aac',
        'mp3',
        'wma' as unknown as DeviceCapabilities['supportedAudioCodecs'][number],
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err?.field).toBe('supportedAudioCodecs');
      expect(err?.code).toBe('INVALID_AUDIO_CODEC');
      expect(err?.message).toContain('"wma"');
      expect(err?.message).toContain('aac, alac, mp3');
    }
  });
});

// =============================================================================
// Multiple invalid fields — all errors returned, not first-fail
// =============================================================================

describe('validateCapabilityOverrides — multiple invalid fields', () => {
  it('returns ALL errors when multiple fields are invalid', () => {
    const result = validateCapabilityOverrides({
      artworkMaxResolution: 99999,
      artworkSources: ['bad-source' as unknown as DeviceCapabilities['artworkSources'][number]],
      supportedAudioCodecs: [
        'wma' as unknown as DeviceCapabilities['supportedAudioCodecs'][number],
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('INVALID_ARTWORK_RESOLUTION');
      expect(codes).toContain('INVALID_ARTWORK_SOURCE');
      expect(codes).toContain('INVALID_AUDIO_CODEC');
    }
  });
});
