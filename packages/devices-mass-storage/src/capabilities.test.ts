/**
 * Tests for getCapabilities()
 */

import { describe, expect, it } from 'bun:test';
import { getCapabilities } from './capabilities.js';
import { definePreset } from './preset.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import type { MassStorageIdentity } from '@podkit/device-types';

// =============================================================================
// Helpers
// =============================================================================

function makeIdentity(presetId?: string): MassStorageIdentity {
  return { kind: 'mass-storage', presetId };
}

// =============================================================================
// Built-in preset resolution
// =============================================================================

describe('getCapabilities — built-in preset resolution', () => {
  it('resolves echo-mini capabilities', () => {
    const identity = makeIdentity('echo-mini');
    const caps = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    const expected = BUILT_IN_PRESETS['echo-mini'];
    expect(caps.artworkMaxResolution).toBe(expected.artworkMaxResolution);
    expect(caps.supportedAudioCodecs).toEqual(expected.supportedAudioCodecs);
    expect(caps.artworkSources).toEqual(expected.artworkSources);
    expect(caps.supportsVideo).toBe(expected.supportsVideo);
  });

  it('resolves rockbox capabilities', () => {
    const identity = makeIdentity('rockbox');
    const caps = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    expect(caps.audioNormalization).toBe('replaygain');
    expect(caps.supportedAudioCodecs).toContain('opus');
  });

  it('resolves generic capabilities', () => {
    const identity = makeIdentity('generic');
    const caps = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    expect(caps.artworkMaxResolution).toBe(500);
  });

  it('falls back to generic when presetId is absent', () => {
    const identity = makeIdentity(); // no presetId
    const caps = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    const generic = BUILT_IN_PRESETS['generic'];
    expect(caps.artworkMaxResolution).toBe(generic.artworkMaxResolution);
  });

  it('resolves via BUILT_IN_PRESETS fallback even when opts.presets is empty', () => {
    const identity = makeIdentity('echo-mini');
    // opts.presets is empty but built-in fallback should apply
    const caps = getCapabilities(identity, { presets: {} });
    expect(caps.artworkMaxResolution).toBe(BUILT_IN_PRESETS['echo-mini'].artworkMaxResolution);
  });

  it('throws when preset id is unknown and not in built-ins', () => {
    const identity = makeIdentity('mystery-player');
    expect(() => getCapabilities(identity, { presets: {} })).toThrow(
      'no preset found for id "mystery-player"'
    );
  });
});

// =============================================================================
// Overrides applied last
// =============================================================================

describe('getCapabilities — overrides applied last', () => {
  it('applies artworkMaxResolution override', () => {
    const identity = makeIdentity('echo-mini');
    const caps = getCapabilities(identity, {
      presets: BUILT_IN_PRESETS,
      overrides: { artworkMaxResolution: 64 },
    });
    expect(caps.artworkMaxResolution).toBe(64);
  });

  it('overrides arrays entirely (not merged)', () => {
    const identity = makeIdentity('rockbox');
    const caps = getCapabilities(identity, {
      presets: BUILT_IN_PRESETS,
      overrides: { supportedAudioCodecs: ['mp3'] },
    });
    expect(caps.supportedAudioCodecs).toEqual(['mp3']);
  });

  it('overrides artworkSources entirely', () => {
    const identity = makeIdentity('rockbox'); // rockbox: ['sidecar', 'embedded']
    const caps = getCapabilities(identity, {
      presets: BUILT_IN_PRESETS,
      overrides: { artworkSources: ['database'] },
    });
    expect(caps.artworkSources).toEqual(['database']);
  });

  it('overrides supportsVideo', () => {
    const identity = makeIdentity('generic');
    const caps = getCapabilities(identity, {
      presets: BUILT_IN_PRESETS,
      overrides: { supportsVideo: true },
    });
    expect(caps.supportsVideo).toBe(true);
  });

  it('non-overridden fields keep preset values', () => {
    const identity = makeIdentity('echo-mini');
    const caps = getCapabilities(identity, {
      presets: BUILT_IN_PRESETS,
      overrides: { artworkMaxResolution: 64 },
    });
    // Everything else from echo-mini should be unchanged
    const echoMini = BUILT_IN_PRESETS['echo-mini'];
    expect(caps.supportedAudioCodecs).toEqual(echoMini.supportedAudioCodecs);
    expect(caps.audioNormalization).toBe(echoMini.audioNormalization);
    expect(caps.artworkSources).toEqual(echoMini.artworkSources);
  });
});

// =============================================================================
// No shared mutable state — two devices, different configs
// =============================================================================

describe('getCapabilities — no shared state between calls', () => {
  it('two Echo Minis with different overrides yield distinct capabilities', () => {
    const identity1 = makeIdentity('echo-mini');
    const identity2 = makeIdentity('echo-mini');

    const caps1 = getCapabilities(identity1, {
      presets: BUILT_IN_PRESETS,
      overrides: { artworkMaxResolution: 64 },
    });
    const caps2 = getCapabilities(identity2, {
      presets: BUILT_IN_PRESETS,
      overrides: { artworkMaxResolution: 320 },
    });

    expect(caps1.artworkMaxResolution).toBe(64);
    expect(caps2.artworkMaxResolution).toBe(320);
  });

  it('mutating a returned object does not affect subsequent calls', () => {
    const identity = makeIdentity('rockbox');
    const caps1 = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    // Mutate the returned object
    (caps1 as { artworkMaxResolution: number }).artworkMaxResolution = 9999;

    const caps2 = getCapabilities(identity, { presets: BUILT_IN_PRESETS });
    expect(caps2.artworkMaxResolution).toBe(BUILT_IN_PRESETS['rockbox'].artworkMaxResolution);
  });

  it('different presetIds yield different results (no cross-contamination)', () => {
    const echo = getCapabilities(makeIdentity('echo-mini'), { presets: BUILT_IN_PRESETS });
    const rockbox = getCapabilities(makeIdentity('rockbox'), { presets: BUILT_IN_PRESETS });

    expect(echo.artworkMaxResolution).not.toBe(rockbox.artworkMaxResolution);
    expect(echo.audioNormalization).not.toBe(rockbox.audioNormalization);
  });
});

// =============================================================================
// Custom presets in opts.presets
// =============================================================================

describe('getCapabilities — custom presets in opts.presets', () => {
  it('resolves a user-defined preset passed via opts.presets', () => {
    const myPreset = definePreset({
      id: 'my-walkman',
      capabilities: {
        artworkSources: ['sidecar'],
        artworkMaxResolution: 400,
        supportedAudioCodecs: ['flac', 'mp3'],
        supportsVideo: false,
        audioNormalization: 'replaygain',
        supportsAlbumArtistBrowsing: true,
      },
      contentPaths: { musicDir: 'MUSIC', moviesDir: 'VIDEO', tvShowsDir: 'TV' },
    });

    const identity = makeIdentity('my-walkman');
    const caps = getCapabilities(identity, { presets: { 'my-walkman': myPreset } });
    expect(caps.artworkMaxResolution).toBe(400);
    expect(caps.audioNormalization).toBe('replaygain');
    expect(caps.supportedAudioCodecs).toEqual(['flac', 'mp3']);
  });
});
