/**
 * Tests for the provenance-aware `getCapabilitiesResolved` variant.
 * Locks in the per-layer resolution order: device-config →
 * device-defaults → preset.
 *
 * The legacy `getCapabilities` bare-values function shares the same
 * merge under the hood (it's a wrapper) and continues to be covered by
 * `capabilities.test.ts`; this file pins the resolved shape that
 * `device info` and other provenance consumers depend on.
 */
import { describe, it, expect } from 'bun:test';
import type { MassStorageIdentity } from '@podkit/device-types';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import { getCapabilitiesResolved } from './capabilities.js';

const ECHO_IDENTITY: MassStorageIdentity = {
  kind: 'mass-storage',
  presetId: 'echo-mini',
};

describe('getCapabilitiesResolved — resolution order', () => {
  it('every field reports source=preset when no overrides are supplied', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, { presets: BUILT_IN_PRESETS });
    expect(r.artworkSources.source).toBe('preset');
    expect(r.artworkMaxResolution.source).toBe('preset');
    expect(r.supportedAudioCodecs.source).toBe('preset');
    expect(r.supportsVideo.source).toBe('preset');
    expect(r.audioNormalization.source).toBe('preset');
    expect(r.supportsAlbumArtistBrowsing.source).toBe('preset');
  });

  it('device-config wins over preset for a single field', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      deviceConfigOverrides: { artworkMaxResolution: 96 },
    });
    expect(r.artworkMaxResolution).toEqual({ value: 96, source: 'device-config' });
    expect(r.artworkSources.source).toBe('preset');
    expect(r.artworkSources.value).toEqual([...BUILT_IN_PRESETS['echo-mini'].artworkSources]);
  });

  it('device-defaults wins over preset when device-config is absent', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      deviceDefaultsOverrides: { artworkMaxResolution: 64 },
    });
    expect(r.artworkMaxResolution).toEqual({ value: 64, source: 'device-defaults' });
  });

  it('device-config wins over device-defaults', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      deviceConfigOverrides: { artworkMaxResolution: 96 },
      deviceDefaultsOverrides: { artworkMaxResolution: 64 },
    });
    expect(r.artworkMaxResolution).toEqual({ value: 96, source: 'device-config' });
  });

  it('per-field source attribution is independent', () => {
    // Mix: device-config sets one field, device-defaults sets another,
    // preset supplies the rest. Each field's source must reflect the
    // actual layer that supplied it, not the highest-priority layer
    // that happened to have ANY override.
    const r = getCapabilitiesResolved(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      deviceConfigOverrides: { artworkMaxResolution: 96 },
      deviceDefaultsOverrides: { supportsVideo: true },
    });
    expect(r.artworkMaxResolution.source).toBe('device-config');
    expect(r.supportsVideo.source).toBe('device-defaults');
    expect(r.audioNormalization.source).toBe('preset');
  });

  it('honours a user-defined presetId registered in opts.presets', () => {
    const customPreset = {
      ...BUILT_IN_PRESETS['echo-mini'],
      manufacturer: 'Acme',
      productName: 'TunesBox',
    };
    const identity: MassStorageIdentity = {
      kind: 'mass-storage',
      presetId: 'my-custom',
    };
    const r = getCapabilitiesResolved(identity, {
      presets: { 'my-custom': customPreset },
    });
    expect(r.audioNormalization.source).toBe('preset');
  });

  it('falls back to "generic" when identity has no presetId', () => {
    const identity: MassStorageIdentity = { kind: 'mass-storage' };
    const r = getCapabilitiesResolved(identity, { presets: BUILT_IN_PRESETS });
    expect(r.artworkSources.value).toEqual([...BUILT_IN_PRESETS['generic'].artworkSources]);
  });

  it('throws on a presetId that is not registered anywhere', () => {
    const identity: MassStorageIdentity = {
      kind: 'mass-storage',
      presetId: 'does-not-exist',
    };
    expect(() => getCapabilitiesResolved(identity, { presets: {} })).toThrow(/no preset found/);
  });
});

describe('getCapabilities (bare wrapper) parity vs getCapabilitiesResolved', () => {
  // The bare `getCapabilities` is now a projection over
  // `getCapabilitiesResolved`. Lock in that the projected values are
  // bit-for-bit equal across the cases the legacy API supports — a
  // future refactor of the resolved variant must not silently change
  // the bare-wrapper output.
  const { getCapabilities } = require('./capabilities.js');

  const cases: Array<{ label: string; overrides?: Partial<unknown> }> = [
    { label: 'no overrides', overrides: undefined },
    { label: 'artworkMaxResolution override', overrides: { artworkMaxResolution: 64 } },
    {
      label: 'supportedAudioCodecs override',
      overrides: { supportedAudioCodecs: ['aac', 'mp3'] as const },
    },
    { label: 'multiple overrides', overrides: { artworkMaxResolution: 64, supportsVideo: true } },
  ];

  for (const c of cases) {
    it(`${c.label} — bare values equal resolved.values`, () => {
      const bare = getCapabilities(ECHO_IDENTITY, {
        presets: BUILT_IN_PRESETS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        overrides: c.overrides as any,
      });
      const resolved = getCapabilitiesResolved(ECHO_IDENTITY, {
        presets: BUILT_IN_PRESETS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deviceConfigOverrides: c.overrides as any,
      });
      expect(bare.artworkSources).toEqual([...resolved.artworkSources.value]);
      expect(bare.artworkMaxResolution).toBe(resolved.artworkMaxResolution.value);
      expect(bare.supportedAudioCodecs).toEqual([...resolved.supportedAudioCodecs.value]);
      expect(bare.supportsVideo).toBe(resolved.supportsVideo.value);
      expect(bare.audioNormalization).toBe(resolved.audioNormalization.value);
      expect(bare.supportsAlbumArtistBrowsing).toBe(resolved.supportsAlbumArtistBrowsing.value);
    });
  }

  it('containerConstraints projection — bare wrapper omits when no layer supplies it', () => {
    const bare = getCapabilities(ECHO_IDENTITY, { presets: BUILT_IN_PRESETS });
    expect(bare.containerConstraints).toBeUndefined();
  });

  it('containerConstraints projection — bare wrapper includes when override supplies it', () => {
    const bare = getCapabilities(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      overrides: { containerConstraints: { aac: ['mp4'] } },
    });
    expect(bare.containerConstraints).toEqual({ aac: ['mp4'] });
  });
});

describe('getCapabilitiesResolved — containerConstraints (sparse)', () => {
  it('omits the field entirely when no layer supplies constraints', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, { presets: BUILT_IN_PRESETS });
    expect(r.containerConstraints).toBeUndefined();
  });

  it('includes the field when any layer supplies constraints', () => {
    const r = getCapabilitiesResolved(ECHO_IDENTITY, {
      presets: BUILT_IN_PRESETS,
      deviceConfigOverrides: { containerConstraints: { aac: ['mp4'] } },
    });
    expect(r.containerConstraints).toBeDefined();
    expect(r.containerConstraints!.source).toBe('device-config');
    expect(r.containerConstraints!.value).toEqual({ aac: ['mp4'] });
  });
});
