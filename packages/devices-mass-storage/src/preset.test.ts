/**
 * Tests for definePreset()
 */

import { describe, expect, it } from 'bun:test';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import { definePreset } from './preset.js';

// =============================================================================
// Basic construction
// =============================================================================

describe('definePreset — pure construction', () => {
  it('constructs a preset with explicit capabilities (no extends)', () => {
    const preset = definePreset({
      id: 'my-dap',
      capabilities: {
        artworkSources: ['embedded'],
        artworkMaxResolution: 200,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: false,
        audioNormalization: 'none',
        supportsAlbumArtistBrowsing: false,
      },
      contentPaths: { musicDir: 'Music', moviesDir: 'Movies', tvShowsDir: 'TV' },
    });

    expect(preset.artworkMaxResolution).toBe(200);
    expect(preset.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    expect(preset.contentPaths.musicDir).toBe('Music');
  });

  it('uses generic as implicit base when no extends given', () => {
    const generic = BUILT_IN_PRESETS['generic'];
    const preset = definePreset({ id: 'my-dap' });
    // Should have generic defaults since nothing overridden
    expect(preset.artworkSources).toEqual(generic.artworkSources);
    expect(preset.artworkMaxResolution).toBe(generic.artworkMaxResolution);
  });

  it('returns a new object (no shared state)', () => {
    const a = definePreset({ id: 'a', capabilities: { artworkMaxResolution: 100 } });
    const b = definePreset({ id: 'b', capabilities: { artworkMaxResolution: 200 } });
    expect(a.artworkMaxResolution).toBe(100);
    expect(b.artworkMaxResolution).toBe(200);
    // Mutating one should not affect the other
    (a as { artworkMaxResolution: number }).artworkMaxResolution = 999;
    expect(b.artworkMaxResolution).toBe(200);
  });
});

// =============================================================================
// Validation
// =============================================================================

describe('definePreset — validation', () => {
  it('throws on empty id', () => {
    expect(() => definePreset({ id: '' })).toThrow('id must be a non-empty string');
  });

  it('throws on whitespace-only id', () => {
    expect(() => definePreset({ id: '   ' })).toThrow('id must be a non-empty string');
  });

  it('throws on dangling extends (built-in table)', () => {
    expect(() => definePreset({ id: 'x', extends: 'nonexistent-preset' })).toThrow(
      'extends unknown preset id "nonexistent-preset"'
    );
  });

  it('throws on dangling extends (custom available)', () => {
    expect(() => definePreset({ id: 'x', extends: 'missing' }, { available: {} })).toThrow(
      'extends unknown preset id "missing"'
    );
  });
});

// =============================================================================
// Extends resolution from built-ins
// =============================================================================

describe('definePreset — extends from built-ins', () => {
  it('inherits all fields from echo-mini', () => {
    const echoMini = BUILT_IN_PRESETS['echo-mini'];
    const preset = definePreset({ id: 'my-echo', extends: 'echo-mini' });
    expect(preset.artworkMaxResolution).toBe(echoMini.artworkMaxResolution);
    expect(preset.supportedAudioCodecs).toEqual(echoMini.supportedAudioCodecs);
    expect(preset.contentPaths).toEqual(echoMini.contentPaths);
  });

  it('overrides artworkMaxResolution while inheriting other fields', () => {
    const echoMini = BUILT_IN_PRESETS['echo-mini'];
    const preset = definePreset({
      id: 'my-echo',
      extends: 'echo-mini',
      capabilities: { artworkMaxResolution: 64 },
    });
    expect(preset.artworkMaxResolution).toBe(64);
    expect(preset.supportedAudioCodecs).toEqual(echoMini.supportedAudioCodecs);
  });

  it('overrides contentPaths partially while inheriting rest', () => {
    const preset = definePreset({
      id: 'my-rockbox',
      extends: 'rockbox',
      contentPaths: { musicDir: 'MUSIC' },
    });
    const rockbox = BUILT_IN_PRESETS['rockbox'];
    expect(preset.contentPaths.musicDir).toBe('MUSIC');
    expect(preset.contentPaths.moviesDir).toBe(rockbox.contentPaths.moviesDir);
    expect(preset.contentPaths.tvShowsDir).toBe(rockbox.contentPaths.tvShowsDir);
  });

  it('extends generic preset explicitly', () => {
    const generic = BUILT_IN_PRESETS['generic'];
    const preset = definePreset({ id: 'my-generic', extends: 'generic' });
    expect(preset.artworkSources).toEqual(generic.artworkSources);
    expect(preset.audioNormalization).toBe(generic.audioNormalization);
  });
});

// =============================================================================
// Extends resolution from custom presets
// =============================================================================

describe('definePreset — extends from custom presets (opts.available)', () => {
  it('inherits from a custom preset in opts.available', () => {
    const custom = definePreset({
      id: 'custom-base',
      capabilities: {
        artworkSources: ['sidecar'],
        artworkMaxResolution: 256,
        supportedAudioCodecs: ['flac', 'mp3'],
        supportsVideo: true,
        audioNormalization: 'replaygain',
        supportsAlbumArtistBrowsing: true,
      },
      contentPaths: { musicDir: 'Audio', moviesDir: 'Films', tvShowsDir: 'Series' },
    });

    const derived = definePreset(
      {
        id: 'custom-derived',
        extends: 'custom-base',
        capabilities: { artworkMaxResolution: 128 },
      },
      { available: { 'custom-base': custom } }
    );

    expect(derived.artworkSources).toEqual(['sidecar']);
    expect(derived.artworkMaxResolution).toBe(128);
    expect(derived.supportedAudioCodecs).toEqual(['flac', 'mp3']);
    expect(derived.supportsVideo).toBe(true);
    expect(derived.contentPaths.musicDir).toBe('Audio');
  });

  it('built-ins take precedence over available when ids collide', () => {
    // If someone puts an 'echo-mini' key in available, the built-in wins
    const fakeMini = definePreset({
      id: 'echo-mini',
      capabilities: { artworkMaxResolution: 9999 },
    });
    const preset = definePreset(
      { id: 'test', extends: 'echo-mini' },
      { available: { 'echo-mini': fakeMini } }
    );
    // Built-in echo-mini should be used, not the fake one
    expect(preset.artworkMaxResolution).toBe(BUILT_IN_PRESETS['echo-mini'].artworkMaxResolution);
  });
});

// =============================================================================
// Capabilities merge semantics
// =============================================================================

describe('definePreset — capabilities merge semantics', () => {
  it('arrays replace (not concatenate) when overriding supportedAudioCodecs', () => {
    const preset = definePreset({
      id: 'codec-test',
      extends: 'rockbox', // rockbox has many codecs
      capabilities: { supportedAudioCodecs: ['mp3'] },
    });
    // Should be exactly ['mp3'], not rockbox's full list + ['mp3']
    expect(preset.supportedAudioCodecs).toEqual(['mp3']);
  });

  it('arrays replace (not concatenate) when overriding artworkSources', () => {
    const preset = definePreset({
      id: 'artwork-test',
      extends: 'rockbox', // rockbox has ['sidecar', 'embedded']
      capabilities: { artworkSources: ['database'] },
    });
    expect(preset.artworkSources).toEqual(['database']);
  });

  it('scalar fields overwrite individually', () => {
    const preset = definePreset({
      id: 'scalar-test',
      extends: 'generic',
      capabilities: {
        supportsVideo: true,
        audioNormalization: 'replaygain',
      },
    });
    const generic = BUILT_IN_PRESETS['generic'];
    expect(preset.supportsVideo).toBe(true);
    expect(preset.audioNormalization).toBe('replaygain');
    // Other fields inherit from generic
    expect(preset.artworkMaxResolution).toBe(generic.artworkMaxResolution);
    expect(preset.supportedAudioCodecs).toEqual(generic.supportedAudioCodecs);
  });
});

// =============================================================================
// Cycle detection
// =============================================================================

describe('definePreset — cycle detection', () => {
  it('throws on direct self-reference via available', () => {
    // Build a preset that extends itself (pathological case via available map)
    const selfRef = definePreset({ id: 'self', capabilities: { artworkMaxResolution: 1 } });
    // Inject it into available under the same id it is trying to extend
    expect(() =>
      definePreset({ id: 'self', extends: 'self' }, { available: { self: selfRef } })
    ).toThrow('circular extends detected');
  });
});
